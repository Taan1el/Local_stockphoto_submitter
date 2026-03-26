import fs from 'node:fs/promises'
import path from 'node:path'
import type { Asset, AssetDraft } from './types.js'

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

export type DraftGenerationMode = 'vision' | 'filename'

export interface GeneratedDraftResult {
  draft: AssetDraft
  mode: DraftGenerationMode
  model: string | null
}

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

function openAIApiKey(): string | null {
  return process.env.STOCK_HUB_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null
}

function encodeImageAsDataUrl(imagePath: string, bytes: Buffer): string {
  const extension = path.extname(imagePath).toLowerCase()
  const mimeType = extension === '.jpeg' || extension === '.jpg' ? 'image/jpeg' : 'application/octet-stream'
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

async function requestVisionDraft(imagePath: string): Promise<GeneratedDraftResult> {
  const apiKey = openAIApiKey()

  if (!apiKey) {
    return {
      draft: buildAssetDraft(path.basename(imagePath)),
      mode: 'filename',
      model: null,
    }
  }

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
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((item): item is string => typeof item === 'string') : [],
      editorial: Boolean(parsed.editorial),
      mature: Boolean(parsed.mature),
    }),
    mode: 'vision',
    model: defaultVisionModel,
  }
}

export async function generateAssetDraft(imagePath: string, filename: string): Promise<GeneratedDraftResult> {
  try {
    return await requestVisionDraft(imagePath)
  } catch (error) {
    if (!openAIApiKey()) {
      return {
        draft: buildAssetDraft(filename),
        mode: 'filename',
        model: null,
      }
    }

    throw error
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
