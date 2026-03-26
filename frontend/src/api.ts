import type { Asset, AssetSubmissionStatus, MarketplaceDefinition, MarketplaceId } from './types'

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
  submissionStatus?: Partial<Record<MarketplaceId, AssetSubmissionStatus>>
}): Promise<Asset> {
  const response = await fetch(`/api/assets/${payload.assetId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      metadata: payload.metadata,
      submissionStatus: payload.submissionStatus,
    }),
  })
  const data = await parseJson<{ asset: Asset }>(response)
  return data.asset
}

export async function generateDraft(assetId: string): Promise<Asset> {
  const response = await fetch(`/api/assets/${assetId}/generate-draft`, {
    method: 'POST',
  })
  const data = await parseJson<{ asset: Asset }>(response)
  return data.asset
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
