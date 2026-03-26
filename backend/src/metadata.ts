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
    description:
      title === 'Untitled stock photo'
        ? ''
        : `${title}. Commercial stock photo prepared for contributor review.`,
    keywords,
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
    },
  }
}
