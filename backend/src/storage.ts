import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AppSettings,
  AppState,
  Asset,
  AssetMetadata,
  AssetSocialDrafts,
  MarketplaceId,
  PublicAppSettings,
  SocialPlatformDraft,
  XSocialDraft,
} from './types.js'
import { allMarketplaceIds } from './marketplaces.js'

const backendRoot = path.resolve(import.meta.dirname, '..')
const defaultDataRoot = path.join(backendRoot, 'data')

function resolveDataRoot(): string {
  const configuredRoot = process.env.STOCK_HUB_DATA_ROOT
  return configuredRoot ? path.resolve(configuredRoot) : defaultDataRoot
}

function getStatePath(): string {
  return path.join(resolveDataRoot(), 'state.json')
}

function getSettingsPath(): string {
  return path.join(resolveDataRoot(), 'settings.json')
}

function emptyMetadata(): AssetMetadata {
  return {
    title: '',
    description: '',
    keywords: [],
    categories: {
      'adobe-stock': '',
      shutterstock: '',
      vecteezy: '',
    },
    editorial: false,
    mature: false,
    notes: '',
  }
}

function emptySocialPlatformDraft(): SocialPlatformDraft {
  return {
    caption: '',
    hashtags: [],
    altText: '',
    cta: '',
  }
}

function emptyXSocialDraft(): XSocialDraft {
  return {
    ...emptySocialPlatformDraft(),
    poll: null,
  }
}

function emptySocialDrafts(): AssetSocialDrafts {
  return {
    facebook: emptySocialPlatformDraft(),
    x: emptyXSocialDraft(),
  }
}

function emptySubmissionStatus(): Record<MarketplaceId, Asset['submissionStatus'][MarketplaceId]> {
  return {
    'adobe-stock': 'draft',
    shutterstock: 'draft',
    vecteezy: 'draft',
  }
}

function defaultSettings(): AppSettings {
  return {
    draftGenerationMode: 'auto',
    openAIApiKey: '',
  }
}

function normalizeSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  const defaults = defaultSettings()

  return {
    draftGenerationMode:
      settings?.draftGenerationMode === 'openai' || settings?.draftGenerationMode === 'offline'
        ? settings.draftGenerationMode
        : defaults.draftGenerationMode,
    openAIApiKey: typeof settings?.openAIApiKey === 'string' ? settings.openAIApiKey.trim() : '',
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
}

function normalizeMetadata(metadata: Partial<AssetMetadata> | null | undefined): AssetMetadata {
  const defaults = emptyMetadata()

  return {
    title: typeof metadata?.title === 'string' ? metadata.title : defaults.title,
    description: typeof metadata?.description === 'string' ? metadata.description : defaults.description,
    keywords: normalizeStringArray(metadata?.keywords),
    categories: {
      'adobe-stock':
        typeof metadata?.categories?.['adobe-stock'] === 'string'
          ? metadata.categories['adobe-stock']
          : defaults.categories['adobe-stock'],
      shutterstock:
        typeof metadata?.categories?.shutterstock === 'string'
          ? metadata.categories.shutterstock
          : defaults.categories.shutterstock,
      vecteezy:
        typeof metadata?.categories?.vecteezy === 'string'
          ? metadata.categories.vecteezy
          : defaults.categories.vecteezy,
    },
    editorial: Boolean(metadata?.editorial),
    mature: Boolean(metadata?.mature),
    notes: typeof metadata?.notes === 'string' ? metadata.notes : defaults.notes,
  }
}

function normalizeSocialPlatformDraft(
  draft: Partial<SocialPlatformDraft> | null | undefined,
): SocialPlatformDraft {
  const defaults = emptySocialPlatformDraft()

  return {
    caption: typeof draft?.caption === 'string' ? draft.caption : defaults.caption,
    hashtags: normalizeStringArray(draft?.hashtags),
    altText: typeof draft?.altText === 'string' ? draft.altText : defaults.altText,
    cta: typeof draft?.cta === 'string' ? draft.cta : defaults.cta,
  }
}

function normalizeXSocialDraft(draft: Partial<XSocialDraft> | null | undefined): XSocialDraft {
  const defaults = emptyXSocialDraft()
  const normalizedBase = normalizeSocialPlatformDraft(draft)
  const poll =
    draft?.poll &&
    typeof draft.poll.question === 'string' &&
    Array.isArray(draft.poll.options) &&
    typeof draft.poll.durationHours === 'number'
      ? {
          question: draft.poll.question,
          options: draft.poll.options
            .filter((option): option is string => typeof option === 'string')
            .map((option) => option.trim())
            .filter(Boolean)
            .slice(0, 4),
          durationHours: Math.max(1, Math.min(168, Math.round(draft.poll.durationHours))),
        }
      : defaults.poll

  return {
    ...normalizedBase,
    poll,
  }
}

function normalizeSocialDrafts(drafts: Partial<AssetSocialDrafts> | null | undefined): AssetSocialDrafts {
  return {
    facebook: normalizeSocialPlatformDraft(drafts?.facebook),
    x: normalizeXSocialDraft(drafts?.x),
  }
}

function normalizeSubmissionStatus(
  submissionStatus: Partial<Record<MarketplaceId, Asset['submissionStatus'][MarketplaceId]>> | null | undefined,
): Record<MarketplaceId, Asset['submissionStatus'][MarketplaceId]> {
  const defaults = emptySubmissionStatus()
  const isValidStatus = (value: unknown): value is Asset['submissionStatus'][MarketplaceId] =>
    value === 'draft' || value === 'ready' || value === 'reviewing' || value === 'submitted'

  return {
    'adobe-stock': isValidStatus(submissionStatus?.['adobe-stock'])
      ? submissionStatus['adobe-stock']
      : defaults['adobe-stock'],
    shutterstock: isValidStatus(submissionStatus?.shutterstock)
      ? submissionStatus.shutterstock
      : defaults.shutterstock,
    vecteezy: isValidStatus(submissionStatus?.vecteezy)
      ? submissionStatus.vecteezy
      : defaults.vecteezy,
  }
}

function normalizeAsset(asset: Partial<Asset>): Asset {
  const now = new Date().toISOString()

  return {
    id: typeof asset.id === 'string' ? asset.id : crypto.randomUUID(),
    originalFilename: typeof asset.originalFilename === 'string' ? asset.originalFilename : 'Untitled.jpg',
    libraryRelativePath:
      typeof asset.libraryRelativePath === 'string' ? asset.libraryRelativePath : '',
    createdAt: typeof asset.createdAt === 'string' ? asset.createdAt : now,
    updatedAt: typeof asset.updatedAt === 'string' ? asset.updatedAt : now,
    fileSizeBytes: typeof asset.fileSizeBytes === 'number' ? asset.fileSizeBytes : 0,
    width: typeof asset.width === 'number' ? asset.width : null,
    height: typeof asset.height === 'number' ? asset.height : null,
    capturedAt: typeof asset.capturedAt === 'string' ? asset.capturedAt : null,
    metadata: normalizeMetadata(asset.metadata),
    socialDrafts: normalizeSocialDrafts(asset.socialDrafts),
    submissionStatus: normalizeSubmissionStatus(asset.submissionStatus),
  }
}

export async function ensureDataDirs(): Promise<void> {
  const dataRoot = resolveDataRoot()
  const libraryRoot = getLibraryRoot()
  const tempRoot = getTempRoot()
  const profilesRoot = getProfilesRoot()
  const exportsRoot = getExportsRoot()
  const statePath = getStatePath()
  const settingsPath = getSettingsPath()

  await Promise.all([
    fs.mkdir(dataRoot, { recursive: true }),
    fs.mkdir(libraryRoot, { recursive: true }),
    fs.mkdir(tempRoot, { recursive: true }),
    fs.mkdir(profilesRoot, { recursive: true }),
    fs.mkdir(exportsRoot, { recursive: true }),
    fs.mkdir(getModelCacheRoot(), { recursive: true }),
  ])

  try {
    await fs.access(statePath)
  } catch {
    const initialState: AppState = { assets: [] }
    await fs.writeFile(statePath, JSON.stringify(initialState, null, 2), 'utf8')
  }

  try {
    await fs.access(settingsPath)
  } catch {
    await fs.writeFile(settingsPath, JSON.stringify(defaultSettings(), null, 2), 'utf8')
  }
}

export async function loadState(): Promise<AppState> {
  await ensureDataDirs()
  const raw = await fs.readFile(getStatePath(), 'utf8')
  const parsed = JSON.parse(raw) as Partial<AppState>
  return {
    assets: Array.isArray(parsed.assets)
      ? parsed.assets.map((asset) => normalizeAsset(asset as Partial<Asset>))
      : [],
  }
}

export async function saveState(state: AppState): Promise<void> {
  await fs.writeFile(getStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

export async function loadSettings(): Promise<AppSettings> {
  await ensureDataDirs()
  const raw = await fs.readFile(getSettingsPath(), 'utf8')
  const parsed = JSON.parse(raw) as Partial<AppSettings>
  return normalizeSettings(parsed)
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(getSettingsPath(), JSON.stringify(normalizeSettings(settings), null, 2), 'utf8')
}

export function toPublicSettings(settings: AppSettings): PublicAppSettings {
  const normalized = normalizeSettings(settings)
  const key = normalized.openAIApiKey
  const preview =
    key.length >= 8 ? `${key.slice(0, 3)}...${key.slice(-4)}` : key.length > 0 ? 'Saved' : null

  return {
    draftGenerationMode: normalized.draftGenerationMode,
    openAIApiKeyConfigured: key.length > 0,
    openAIApiKeyPreview: preview,
  }
}

export function getDataRoot(): string {
  return resolveDataRoot()
}

export function getTempRoot(): string {
  return path.join(resolveDataRoot(), 'temp')
}

export function getLibraryRoot(): string {
  return path.join(resolveDataRoot(), 'library')
}

export function getProfilesRoot(): string {
  return path.join(resolveDataRoot(), 'profiles')
}

export function getExportsRoot(): string {
  return path.join(resolveDataRoot(), 'exports')
}

export function getModelCacheRoot(): string {
  return path.join(resolveDataRoot(), 'models-cache')
}

export function toPublicLibraryPath(asset: Asset): string {
  const normalized = asset.libraryRelativePath.replace(/\\/g, '/')
  return `/library/${normalized}`
}

export async function createAssetFromImportedFile(input: {
  originalFilename: string
  tempFilePath: string
  fileSizeBytes: number
  width: number | null
  height: number | null
  capturedAt: string | null
}): Promise<Asset> {
  const id = crypto.randomUUID()
  const safeFilename = path.basename(input.originalFilename)
  const libraryRoot = getLibraryRoot()
  const assetFolder = path.join(libraryRoot, id)
  const libraryRelativePath = path.join(id, safeFilename)
  const finalPath = path.join(libraryRoot, libraryRelativePath)
  const now = new Date().toISOString()

  await fs.mkdir(assetFolder, { recursive: true })
  await fs.rename(input.tempFilePath, finalPath)

  return {
    id,
    originalFilename: safeFilename,
    libraryRelativePath,
    createdAt: now,
    updatedAt: now,
    fileSizeBytes: input.fileSizeBytes,
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt,
    metadata: emptyMetadata(),
    socialDrafts: emptySocialDrafts(),
    submissionStatus: emptySubmissionStatus(),
  }
}

export async function updateAsset(
  assetId: string,
  updater: (asset: Asset) => Asset,
): Promise<Asset | null> {
  const state = await loadState()
  const index = state.assets.findIndex((asset) => asset.id === assetId)

  if (index === -1) {
    return null
  }

  const updated = {
    ...updater(state.assets[index]),
    updatedAt: new Date().toISOString(),
  }
  state.assets[index] = updated
  await saveState(state)
  return updated
}

export async function deleteAsset(assetId: string): Promise<boolean> {
  const state = await loadState()
  const asset = state.assets.find((item) => item.id === assetId)

  if (!asset) {
    return false
  }

  state.assets = state.assets.filter((item) => item.id !== assetId)
  await saveState(state)
  await fs.rm(path.join(getLibraryRoot(), asset.id), { recursive: true, force: true })
  return true
}

export function findAssetOrThrow(state: AppState, assetId: string): Asset {
  const asset = state.assets.find((item) => item.id === assetId)

  if (!asset) {
    throw new Error(`Asset not found: ${assetId}`)
  }

  return asset
}

export function validateImageFilename(filename: string): boolean {
  return /\.(jpe?g)$/i.test(filename)
}

export function defaultAssetSort(a: Asset, b: Asset): number {
  return b.createdAt.localeCompare(a.createdAt)
}

export function knownMarketplaceIds(): MarketplaceId[] {
  return allMarketplaceIds()
}
