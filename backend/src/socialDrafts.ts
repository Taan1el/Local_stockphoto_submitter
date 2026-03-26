import fs from 'node:fs/promises'
import path from 'node:path'
import { buildAssetDraft, generateAssetDraft } from './metadata.js'
import type {
  AppSettings,
  Asset,
  AssetDraft,
  AssetMetadata,
  AssetSocialDrafts,
  SocialPlatformDraft,
  XPollDraft,
} from './types.js'

const openAIApiUrl = 'https://api.openai.com/v1/chat/completions'
const defaultVisionModel = process.env.STOCK_HUB_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

const genericHashtagStopwords = new Set([
  'and',
  'for',
  'from',
  'into',
  'landscape',
  'outdoors',
  'photo',
  'photography',
  'picture',
  'scenic',
  'stock',
  'travel',
  'view',
  'with',
])

type SocialDraftGenerationMode = 'openai' | 'offline'
type ContentTheme =
  | 'mountain'
  | 'water'
  | 'sky'
  | 'city'
  | 'food'
  | 'wildlife'
  | 'portrait'
  | 'abstract'
  | 'nature'
  | 'default'

export interface GeneratedSocialDraftResult {
  drafts: AssetSocialDrafts
  mode: SocialDraftGenerationMode
  message: string
  model: string | null
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

function toSentenceCase(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function trimSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[.?!]+$/g, '')
}

function assetMetadataToDraft(metadata: AssetMetadata, filename: string): AssetDraft {
  if (metadata.title.trim() || metadata.description.trim() || metadata.keywords.length > 0) {
    return {
      title: metadata.title.trim() || buildAssetDraft(filename).title,
      description: metadata.description.trim(),
      keywords: metadata.keywords.map((keyword) => keyword.trim()).filter(Boolean),
      editorial: metadata.editorial,
      mature: metadata.mature,
    }
  }

  return buildAssetDraft(filename)
}

function hasUsefulMetadata(metadata: AssetMetadata): boolean {
  return (
    metadata.title.trim().length >= 4 &&
    (metadata.description.trim().length >= 24 || metadata.keywords.filter(Boolean).length >= 4)
  )
}

async function resolveSeedDraft(
  asset: Asset,
  imagePath: string,
  settings: AppSettings,
): Promise<AssetDraft> {
  if (hasUsefulMetadata(asset.metadata)) {
    return assetMetadataToDraft(asset.metadata, asset.originalFilename)
  }

  const generated = await generateAssetDraft(imagePath, asset.originalFilename, settings)
  return generated.draft
}

function normalizeHashtagFragment(input: string): string {
  return input
    .replace(/^#+/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

function buildHashtags(keywords: string[], theme: ContentTheme): string[] {
  const baseTags = keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length >= 3)
    .filter((keyword) => !genericHashtagStopwords.has(keyword.toLowerCase()))
    .map((keyword) => normalizeHashtagFragment(keyword))
    .filter((keyword) => keyword.length >= 3 && keyword.length <= 22)

  const themeTags: Record<ContentTheme, string[]> = {
    mountain: ['MountainView', 'AlpineLight', 'CloudBreak'],
    water: ['WaterMood', 'NatureFrame', 'OutdoorEscape'],
    sky: ['SkyMood', 'Cloudscape', 'BlueHour'],
    city: ['CityFrame', 'UrbanLight', 'StreetScene'],
    food: ['FoodPhoto', 'FreshBite', 'TableStory'],
    wildlife: ['WildlifeShot', 'NatureMoment', 'OutdoorFrame'],
    portrait: ['PortraitMood', 'HumanMoment', 'StoryFrame'],
    abstract: ['VisualTexture', 'CreativeFrame', 'ColorMood'],
    nature: ['NatureFrame', 'ScenicMoment', 'OutdoorEscape'],
    default: ['VisualStory', 'PhotoOfTheDay', 'CreativePost'],
  }

  return Array.from(new Set([...baseTags, ...themeTags[theme]])).slice(0, 6).map((tag) => `#${tag}`)
}

function detectTheme(seed: AssetDraft): ContentTheme {
  const haystack = `${seed.title} ${seed.description} ${seed.keywords.join(' ')}`.toLowerCase()

  if (/(mountain|snow|alpine|peak|ridge|glacier|summit)/.test(haystack)) {
    return 'mountain'
  }

  if (/(ocean|sea|beach|wave|river|lake|water|waterfall)/.test(haystack)) {
    return 'water'
  }

  if (/(sky|cloud|sunrise|sunset|storm|mist|fog)/.test(haystack)) {
    return 'sky'
  }

  if (/(city|urban|street|architecture|skyline|building)/.test(haystack)) {
    return 'city'
  }

  if (/(food|drink|meal|dessert|coffee|breakfast|dinner)/.test(haystack)) {
    return 'food'
  }

  if (/(bird|animal|wildlife|deer|fox|dog|cat)/.test(haystack)) {
    return 'wildlife'
  }

  if (/(portrait|person|people|face|model|smile)/.test(haystack)) {
    return 'portrait'
  }

  if (/(abstract|texture|pattern|background|minimal)/.test(haystack)) {
    return 'abstract'
  }

  if (/(nature|forest|landscape|outdoor|scenic|wilderness)/.test(haystack)) {
    return 'nature'
  }

  return 'default'
}

function buildAltText(seed: AssetDraft): string {
  const description = trimSentence(seed.description)

  if (description) {
    return `${toSentenceCase(description)}.`
  }

  const keywords = seed.keywords.slice(0, 4).join(', ')
  const base = trimSentence(seed.title) || 'Photo'
  return keywords ? `${base}. Visible details include ${keywords}.` : `${base}.`
}

function buildFacebookCta(theme: ContentTheme): string {
  switch (theme) {
    case 'mountain':
      return 'Would you wait for the clouds to open or shoot the mystery as it is?'
    case 'water':
      return 'Would you keep this scene calm and minimal or chase the movement?'
    case 'sky':
      return 'Do you lean toward open blue sky or dramatic cloud cover?'
    case 'city':
      return 'Would you post this in daylight or save it for the night crowd?'
    case 'food':
      return 'What would make you stop scrolling faster: the color or the craving?'
    case 'wildlife':
      return 'Would you call this patience, timing, or pure luck?'
    case 'portrait':
      return 'What tells the stronger story here: the mood or the expression?'
    case 'abstract':
      return 'What grabs you first here: shape, color, or texture?'
    case 'nature':
      return 'What pulls you in first: the atmosphere, the color, or the scale?'
    default:
      return 'What is the first detail that catches your eye?'
  }
}

function buildXCta(theme: ContentTheme): string {
  switch (theme) {
    case 'mountain':
      return 'Blue sky or dramatic cloud cover?'
    case 'water':
      return 'Still water or full movement?'
    case 'sky':
      return 'Open light or moody clouds?'
    case 'city':
      return 'Day scene or night glow?'
    case 'food':
      return 'Would you try this right away?'
    case 'wildlife':
      return 'Patience shot or perfect timing?'
    case 'portrait':
      return 'Mood first or detail first?'
    case 'abstract':
      return 'Color first or texture first?'
    case 'nature':
      return 'What pulls you in first here?'
    default:
      return 'What stands out first to you?'
  }
}

function buildPoll(theme: ContentTheme): XPollDraft {
  const polls: Record<ContentTheme, XPollDraft> = {
    mountain: {
      question: 'Which mountain mood wins?',
      options: ['Blue-sky peaks', 'Rolling clouds', 'Fresh snow', 'Hidden trails'],
      durationHours: 24,
    },
    water: {
      question: 'What water mood fits best?',
      options: ['Glass calm', 'Fast movement', 'Misty air', 'Golden light'],
      durationHours: 24,
    },
    sky: {
      question: 'Which sky mood wins?',
      options: ['Bright blue', 'Cloud drama', 'Soft haze', 'Storm build'],
      durationHours: 24,
    },
    city: {
      question: 'What city vibe lands best?',
      options: ['Clean lines', 'Street energy', 'Night lights', 'Quiet corners'],
      durationHours: 24,
    },
    food: {
      question: 'What sells the shot faster?',
      options: ['Texture', 'Color', 'Plating', 'Craving factor'],
      durationHours: 24,
    },
    wildlife: {
      question: 'What makes a wildlife shot?',
      options: ['Timing', 'Patience', 'Light', 'Lucky moment'],
      durationHours: 24,
    },
    portrait: {
      question: 'What carries the portrait?',
      options: ['Expression', 'Lighting', 'Styling', 'Eye contact'],
      durationHours: 24,
    },
    abstract: {
      question: 'What draws you in first?',
      options: ['Color', 'Texture', 'Shape', 'Contrast'],
      durationHours: 24,
    },
    nature: {
      question: 'What makes this scene work?',
      options: ['Light', 'Atmosphere', 'Scale', 'Color'],
      durationHours: 24,
    },
    default: {
      question: 'What catches your eye first?',
      options: ['Color', 'Mood', 'Detail', 'Composition'],
      durationHours: 24,
    },
  }

  return polls[theme]
}

function buildOfflineSocialPlatformDraft(
  seed: AssetDraft,
  theme: ContentTheme,
  platform: 'facebook' | 'x',
): SocialPlatformDraft {
  const description = trimSentence(seed.description)
  const title = trimSentence(seed.title)
  const visualLine =
    description ||
    `${title}${seed.keywords.length > 0 ? ` with ${seed.keywords.slice(0, 3).join(', ')}` : ''}`

  const cta = platform === 'facebook' ? buildFacebookCta(theme) : buildXCta(theme)
  const caption =
    platform === 'facebook'
      ? `${toSentenceCase(visualLine)}. ${cta}`
      : `${toSentenceCase(visualLine)}. ${cta}`

  return {
    caption,
    hashtags: buildHashtags(seed.keywords, theme),
    altText: buildAltText(seed),
    cta,
  }
}

function normalizeSocialPlatformDraft(draft: SocialPlatformDraft): SocialPlatformDraft {
  return {
    caption: draft.caption.replace(/\s+/g, ' ').trim(),
    hashtags: Array.from(new Set(draft.hashtags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 8),
    altText: draft.altText.replace(/\s+/g, ' ').trim(),
    cta: draft.cta.replace(/\s+/g, ' ').trim(),
  }
}

function normalizeSocialDrafts(drafts: AssetSocialDrafts): AssetSocialDrafts {
  return {
    facebook: normalizeSocialPlatformDraft(drafts.facebook),
    x: {
      ...normalizeSocialPlatformDraft(drafts.x),
      poll: drafts.x.poll
        ? {
            question: drafts.x.poll.question.replace(/\s+/g, ' ').trim(),
            options: drafts.x.poll.options
              .map((option) => option.replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .slice(0, 4),
            durationHours: Math.max(1, Math.min(168, Math.round(drafts.x.poll.durationHours))),
          }
        : null,
    },
  }
}

async function requestOpenAISocialDrafts(
  imagePath: string,
  seed: AssetDraft,
  apiKey: string,
): Promise<GeneratedSocialDraftResult> {
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
      max_completion_tokens: 700,
      messages: [
        {
          role: 'system',
          content: [
            'You write concise, image-aware social media drafts.',
            'Keep the tone engaging and human, but safe for general audiences.',
            'Do not use politics, health claims, identity-based controversy, or inflammatory topics.',
            'Return compact JSON only.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Use this image plus the current stock metadata as context.',
                `Current title: ${seed.title || 'None'}`,
                `Current description: ${seed.description || 'None'}`,
                `Current keywords: ${seed.keywords.join(', ') || 'None'}`,
                'Return a JSON object with this exact shape:',
                '{',
                '  "facebook": { "caption": string, "hashtags": string[], "altText": string, "cta": string },',
                '  "x": {',
                '    "caption": string,',
                '    "hashtags": string[],',
                '    "altText": string,',
                '    "cta": string,',
                '    "poll": { "question": string, "options": string[], "durationHours": number }',
                '  }',
                '}',
                'Rules:',
                '- Facebook caption: 1 to 3 short sentences, natural and descriptive, no emoji.',
                '- X caption: short, punchy, and under 220 characters.',
                '- Hashtags: 3 to 6 relevant tags per platform, each starting with #.',
                '- altText: one clear sentence describing the visible image.',
                '- cta: one short question or prompt.',
                '- Poll: 2 to 4 options, each under 25 characters, interesting but safe.',
                '- The poll should be about aesthetic preference, creative choice, or viewer reaction.',
                '- Do not claim current online trends or live news.',
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
    throw new Error('OpenAI returned an empty social drafts response.')
  }

  const parsed = JSON.parse(text) as {
    facebook?: Partial<SocialPlatformDraft>
    x?: Partial<SocialPlatformDraft> & {
      poll?: Partial<XPollDraft> | null
    }
  }

  return {
    drafts: normalizeSocialDrafts({
      facebook: {
        caption: parsed.facebook?.caption ?? '',
        hashtags: Array.isArray(parsed.facebook?.hashtags) ? parsed.facebook.hashtags : [],
        altText: parsed.facebook?.altText ?? '',
        cta: parsed.facebook?.cta ?? '',
      },
      x: {
        caption: parsed.x?.caption ?? '',
        hashtags: Array.isArray(parsed.x?.hashtags) ? parsed.x.hashtags : [],
        altText: parsed.x?.altText ?? '',
        cta: parsed.x?.cta ?? '',
        poll:
          parsed.x?.poll &&
          typeof parsed.x.poll.question === 'string' &&
          Array.isArray(parsed.x.poll.options)
            ? {
                question: parsed.x.poll.question,
                options: parsed.x.poll.options.filter(
                  (option): option is string => typeof option === 'string',
                ),
                durationHours:
                  typeof parsed.x.poll.durationHours === 'number' ? parsed.x.poll.durationHours : 24,
              }
            : null,
      },
    }),
    mode: 'openai',
    message: `Generated Facebook and X drafts from the selected image using ${defaultVisionModel}.`,
    model: defaultVisionModel,
  }
}

async function requestOfflineSocialDrafts(
  asset: Asset,
  imagePath: string,
  settings: AppSettings,
): Promise<GeneratedSocialDraftResult> {
  const seed = await resolveSeedDraft(asset, imagePath, settings)
  const theme = detectTheme(seed)

  return {
    drafts: normalizeSocialDrafts({
      facebook: buildOfflineSocialPlatformDraft(seed, theme, 'facebook'),
      x: {
        ...buildOfflineSocialPlatformDraft(seed, theme, 'x'),
        poll: buildPoll(theme),
      },
    }),
    mode: 'offline',
    message: 'Generated Facebook and X drafts locally, including a safe X poll suggestion.',
    model: null,
  }
}

export async function generateSocialDrafts(
  asset: Asset,
  imagePath: string,
  settings: AppSettings,
): Promise<GeneratedSocialDraftResult> {
  const apiKey = resolveOpenAIApiKey(settings)
  const seed = assetMetadataToDraft(asset.metadata, asset.originalFilename)

  if (settings.draftGenerationMode === 'openai') {
    if (!apiKey) {
      throw new Error('Add an OpenAI API key in Settings before using OpenAI social drafts.')
    }

    return requestOpenAISocialDrafts(imagePath, seed, apiKey)
  }

  if (settings.draftGenerationMode === 'offline') {
    return requestOfflineSocialDrafts(asset, imagePath, settings)
  }

  if (apiKey) {
    return requestOpenAISocialDrafts(imagePath, seed, apiKey)
  }

  return requestOfflineSocialDrafts(asset, imagePath, settings)
}
