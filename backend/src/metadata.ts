import fs from 'node:fs/promises'
import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import { getModelCacheRoot } from './storage.js'
import type { AppSettings, Asset, AssetDraft } from './types.js'

const COMMON_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

const openAIApiUrl = 'https://api.openai.com/v1/chat/completions'
const defaultVisionModel = process.env.STOCK_HUB_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
const offlineCaptionModel = 'Xenova/vit-gpt2-image-captioning'
const offlineClassifierModel = 'Xenova/clip-vit-base-patch32'
const offlineModelDtype = 'q8'

const offlineCandidateLabels = [
  'mountain',
  'mountain peaks',
  'alpine landscape',
  'snow',
  'snowcapped',
  'clouds',
  'fog',
  'mist',
  'blue sky',
  'dramatic sky',
  'winter',
  'nature',
  'landscape',
  'outdoors',
  'scenic view',
  'panorama',
  'travel',
  'wilderness',
  'forest',
  'lake',
  'river',
  'waterfall',
  'beach',
  'ocean',
  'desert',
  'sunset',
  'sunrise',
  'city skyline',
  'architecture',
  'street scene',
  'flowers',
  'garden',
  'wildlife',
  'birds',
  'portrait',
  'people',
  'food',
  'dog',
  'cat',
  'abstract background',
]

const genericOfflineKeywords = ['stock photo', 'copy space', 'horizontal', 'outdoors']

type DraftGenerationResultMode = 'openai' | 'offline' | 'filename'

type OfflineCaptioner = (imagePath: string) => Promise<Array<{ generated_text?: string }>>
type OfflineClassifier = (
  imagePath: string,
  labels: string[],
) => Promise<Array<{ label?: string; score?: number }>>

export interface GeneratedDraftResult {
  draft: AssetDraft
  mode: DraftGenerationResultMode
  message: string
  model: string | null
}

let offlinePipelinesPromise: Promise<{
  captioner: OfflineCaptioner
  classifier: OfflineClassifier
}> | null = null

function normalizeWords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !COMMON_STOPWORDS.has(word))
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function sentenceCase(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDraft(draft: AssetDraft): AssetDraft {
  const keywords = Array.from(
    new Set(
      draft.keywords
        .map((keyword) => normalizeKeyword(keyword))
        .filter((keyword) => keyword.length >= 2),
    ),
  ).slice(0, 25)

  const title = draft.title.replace(/\s+/g, ' ').trim() || 'Untitled stock photo'
  const description = draft.description.replace(/\s+/g, ' ').trim()
  const fallbackKeywords = Array.from(new Set(normalizeWords(title))).slice(0, 12)

  return {
    title,
    description,
    keywords: keywords.length > 0 ? keywords : fallbackKeywords,
    editorial: Boolean(draft.editorial),
    mature: Boolean(draft.mature),
  }
}

function resolveOpenAIApiKey(settings: AppSettings): string | null {
  const storedKey = settings.openAIApiKey.trim()

  if (storedKey) {
    return storedKey
  }

  return process.env.STOCK_HUB_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null
}

function encodeImageAsDataUrl(imagePath: string, bytes: Buffer): string {
  const extension = path.extname(imagePath).toLowerCase()
  const mimeType = extension === '.jpeg' || extension === '.jpg' ? 'image/jpeg' : 'application/octet-stream'
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function normalizeKeywordList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeKeyword(value)).filter(Boolean)))
}

function clipKeywordCandidates(caption: string, labels: string[]): string[] {
  const captionWords = normalizeWords(caption)
  const multiWordCaptionPhrases = [
    captionWords.slice(0, 2).join(' '),
    captionWords.slice(-2).join(' '),
  ].filter((value) => value.trim().includes(' '))

  const baseKeywords = normalizeKeywordList([
    ...labels,
    ...multiWordCaptionPhrases,
    ...captionWords,
  ])

  return normalizeKeywordList([
    ...baseKeywords,
    ...(baseKeywords.length < 14 ? genericOfflineKeywords : []),
  ]).slice(0, 25)
}

function cleanedCaption(caption: string): string {
  return caption.replace(/^(a|an|the)\s+/i, '').replace(/\s+/g, ' ').trim()
}

function offlineDescription(caption: string, labels: string[]): string {
  const normalizedCaption = cleanedCaption(caption)
  const additions = labels.filter(
    (label) =>
      !normalizedCaption.toLowerCase().includes(label) &&
      !['nature', 'landscape', 'outdoors', 'travel', 'stock photo'].includes(label),
  )

  if (additions.length === 0) {
    return `${sentenceCase(normalizedCaption)}.`
  }

  const appended = additions.slice(0, 2)

  if (appended.length === 1) {
    const joiner = normalizedCaption.toLowerCase().includes(' with ') ? ' and ' : ' with '
    return `${sentenceCase(normalizedCaption)}${joiner}${appended[0]}.`
  }

  return `${sentenceCase(normalizedCaption)}, featuring ${appended[0]} and ${appended[1]}.`
}

function offlineTitle(caption: string): string {
  const words = cleanedCaption(caption)
    .split(/\s+/)
    .filter((word) => word && !['a', 'an', 'the'].includes(word.toLowerCase()))
    .slice(0, 9)
    .join(' ')
  return toTitleCase(words || 'Untitled stock photo')
}

function configureOfflineModels(): void {
  env.allowLocalModels = true
  env.allowRemoteModels = true
  env.cacheDir = getModelCacheRoot()
}

async function getOfflinePipelines() {
  if (!offlinePipelinesPromise) {
    configureOfflineModels()
    offlinePipelinesPromise = Promise.all([
      pipeline('image-to-text', offlineCaptionModel, { dtype: offlineModelDtype }),
      pipeline('zero-shot-image-classification', offlineClassifierModel, { dtype: offlineModelDtype }),
    ]).then(([captioner, classifier]) => ({
      captioner: captioner as OfflineCaptioner,
      classifier: classifier as OfflineClassifier,
    }))
  }

  return offlinePipelinesPromise
}

async function requestOfflineDraft(imagePath: string): Promise<GeneratedDraftResult> {
  const { captioner, classifier } = await getOfflinePipelines()
  const captionOutput = await captioner(imagePath)
  const caption = captionOutput[0]?.generated_text?.trim()

  if (!caption) {
    throw new Error('The offline model could not describe this image.')
  }

  const predictions = await classifier(imagePath, offlineCandidateLabels)
  const strongLabels = predictions
    .filter(
      (prediction) =>
        typeof prediction.label === 'string' &&
        typeof prediction.score === 'number' &&
        prediction.score >= 0.035,
    )
    .map((prediction) => prediction.label as string)
    .slice(0, 8)

  const draft = normalizeDraft({
    title: offlineTitle(caption),
    description: offlineDescription(caption, strongLabels),
    keywords: clipKeywordCandidates(caption, strongLabels),
    editorial: false,
    mature: false,
  })

  return {
    draft,
    mode: 'offline',
    message:
      'Generated draft metadata with the local offline model. The first offline run may download local model files once.',
    model: `${offlineCaptionModel} + ${offlineClassifierModel}`,
  }
}

async function requestOpenAIDraft(imagePath: string, apiKey: string): Promise<GeneratedDraftResult> {
  const imageBytes = await fs.readFile(imagePath)
  const imageDataUrl = encodeImageAsDataUrl(imagePath, imageBytes)
  const response = await fetch(openAIApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: defaultVisionModel,
      response_format: {
        type: 'json_object',
      },
      max_completion_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'You create accurate stock photo metadata for contributor uploads. Return compact JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Look at this photo and describe only what is visually supported.',
                'Return a JSON object with these exact keys: title, description, keywords, editorial, mature.',
                'Rules:',
                '- title: 4 to 10 words, natural stock title, no brand names unless visible.',
                '- description: one natural sentence, 12 to 30 words, no filler like "commercial stock photo".',
                '- keywords: 12 to 25 lowercase keywords or short keyword phrases, ordered most relevant first, no duplicates.',
                '- editorial: true only if the image clearly needs editorial treatment.',
                '- mature: true only if the image clearly contains adult or graphic material.',
                '- Do not guess an exact location, camera settings, or facts that are not visible.',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null

    throw new Error(error?.error?.message ?? `OpenAI request failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{
              type?: string
              text?: string
            }>
      }
    }>
  }

  const messageContent = payload.choices?.[0]?.message?.content
  const text =
    typeof messageContent === 'string'
      ? messageContent
      : Array.isArray(messageContent)
        ? messageContent
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('')
        : ''

  if (!text) {
    throw new Error('OpenAI returned an empty draft response.')
  }

  const parsed = JSON.parse(text) as Partial<AssetDraft>

  return {
    draft: normalizeDraft({
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((item): item is string => typeof item === 'string')
        : [],
      editorial: Boolean(parsed.editorial),
      mature: Boolean(parsed.mature),
    }),
    mode: 'openai',
    message: `Generated draft metadata from the actual image using ${defaultVisionModel}.`,
    model: defaultVisionModel,
  }
}

export function buildAssetDraft(filename: string): AssetDraft {
  const basename = path.parse(filename).name
  const words = normalizeWords(basename)
  const titleWords = words.slice(0, 8)
  const title = titleWords.length > 0 ? toTitleCase(titleWords.join(' ')) : 'Untitled stock photo'
  const keywords = Array.from(new Set(words)).slice(0, 25)

  return {
    title,
    description: '',
    keywords,
    editorial: false,
    mature: false,
  }
}

export async function generateAssetDraft(
  imagePath: string,
  filename: string,
  settings: AppSettings,
): Promise<GeneratedDraftResult> {
  const apiKey = resolveOpenAIApiKey(settings)

  if (settings.draftGenerationMode === 'openai') {
    if (!apiKey) {
      throw new Error('Add an OpenAI API key in Settings before using OpenAI draft generation.')
    }

    return requestOpenAIDraft(imagePath, apiKey)
  }

  if (settings.draftGenerationMode === 'offline') {
    return requestOfflineDraft(imagePath)
  }

  if (apiKey) {
    return requestOpenAIDraft(imagePath, apiKey)
  }

  try {
    return await requestOfflineDraft(imagePath)
  } catch {
    return {
      draft: buildAssetDraft(filename),
      mode: 'filename',
      message:
        'The offline model was not available, so the app fell back to a simple filename-based draft.',
      model: null,
    }
  }
}

export function applyDraftToAsset(asset: Asset): Asset {
  const draft = buildAssetDraft(asset.originalFilename)

  return {
    ...asset,
    metadata: {
      ...asset.metadata,
      title: asset.metadata.title || draft.title,
      description: asset.metadata.description || draft.description,
      keywords: asset.metadata.keywords.length > 0 ? asset.metadata.keywords : draft.keywords,
      editorial: asset.metadata.editorial || draft.editorial,
      mature: asset.metadata.mature || draft.mature,
    },
  }
}

export function replaceAssetDraft(asset: Asset, draft: AssetDraft): Asset {
  const normalizedDraft = normalizeDraft(draft)

  return {
    ...asset,
    metadata: {
      ...asset.metadata,
      title: normalizedDraft.title,
      description: normalizedDraft.description,
      keywords: normalizedDraft.keywords,
      editorial: normalizedDraft.editorial,
      mature: normalizedDraft.mature,
    },
  }
}
