import type {
  AppSettings,
  Asset,
  AssetSocialDrafts,
  AssetSubmissionStatus,
  DraftGenerationMode,
  MarketplaceDefinition,
  MarketplaceId,
  SocialShortcutDefinition,
  SocialShortcutId,
} from './types'

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(error?.error ?? `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export async function fetchAssets(): Promise<Asset[]> {
  const response = await fetch('/api/assets')
  const data = await parseJson<{ assets: Asset[] }>(response)
  return data.assets
}

export async function fetchMarketplaces(): Promise<MarketplaceDefinition[]> {
  const response = await fetch('/api/marketplaces')
  const data = await parseJson<{ marketplaces: MarketplaceDefinition[] }>(response)
  return data.marketplaces
}

export async function fetchSettings(): Promise<AppSettings> {
  const response = await fetch('/api/settings')
  const data = await parseJson<{ settings: AppSettings }>(response)
  return data.settings
}

export async function fetchSocialShortcuts(): Promise<SocialShortcutDefinition[]> {
  const response = await fetch('/api/social-shortcuts')
  const data = await parseJson<{ shortcuts: SocialShortcutDefinition[] }>(response)
  return data.shortcuts
}

export async function importAssets(files: FileList | File[]): Promise<Asset[]> {
  const formData = new FormData()

  Array.from(files).forEach((file) => {
    formData.append('files', file)
  })

  const response = await fetch('/api/assets/import', {
    method: 'POST',
    body: formData,
  })
  const data = await parseJson<{ assets: Asset[] }>(response)
  return data.assets
}

export async function updateAsset(payload: {
  assetId: string
  metadata?: Partial<Asset['metadata']> & { keywords?: string[] | string }
  socialDrafts?: Partial<AssetSocialDrafts>
  submissionStatus?: Partial<Record<MarketplaceId, AssetSubmissionStatus>>
}): Promise<Asset> {
  const response = await fetch(`/api/assets/${payload.assetId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      metadata: payload.metadata,
      socialDrafts: payload.socialDrafts,
      submissionStatus: payload.submissionStatus,
    }),
  })
  const data = await parseJson<{ asset: Asset }>(response)
  return data.asset
}

export async function generateDraft(assetId: string): Promise<{
  asset: Asset
  message: string
  mode: 'openai' | 'offline' | 'filename'
}> {
  const response = await fetch(`/api/assets/${assetId}/generate-draft`, {
    method: 'POST',
  })
  return parseJson<{
    asset: Asset
    message: string
    mode: 'openai' | 'offline' | 'filename'
  }>(response)
}

export async function generateSocialDrafts(assetId: string): Promise<{
  asset: Asset
  message: string
  mode: 'openai' | 'offline'
}> {
  const response = await fetch(`/api/assets/${assetId}/generate-social-drafts`, {
    method: 'POST',
  })
  return parseJson<{
    asset: Asset
    message: string
    mode: 'openai' | 'offline'
  }>(response)
}

export async function removeAsset(assetId: string): Promise<void> {
  const response = await fetch(`/api/assets/${assetId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(error?.error ?? 'Failed to delete asset.')
  }
}

export async function openMarketplacePage(
  marketplaceId: MarketplaceId,
  target: 'dashboard' | 'upload',
): Promise<string> {
  const response = await fetch(`/api/marketplaces/${marketplaceId}/open`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target }),
  })
  const data = await parseJson<{ message: string }>(response)
  return data.message
}

export async function openSocialShortcut(shortcutId: SocialShortcutId): Promise<string> {
  const response = await fetch(`/api/social-shortcuts/${shortcutId}/open`, {
    method: 'POST',
  })
  const data = await parseJson<{ message: string }>(response)
  return data.message
}

export async function saveSettings(payload: {
  draftGenerationMode: DraftGenerationMode
  openAIApiKey?: string
  clearOpenAIApiKey?: boolean
}): Promise<AppSettings> {
  const response = await fetch('/api/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJson<{ settings: AppSettings }>(response)
  return data.settings
}

export async function exportCsv(
  marketplaceId: MarketplaceId,
  assetIds: string[],
): Promise<{ filename: string; blob: Blob }> {
  const response = await fetch(`/api/exports/${marketplaceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assetIds }),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(error?.error ?? 'CSV export failed.')
  }

  const contentDisposition = response.headers.get('Content-Disposition') ?? ''
  const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
  const blob = await response.blob()

  return {
    filename: filenameMatch?.[1] ?? `${marketplaceId}.csv`,
    blob,
  }
}
