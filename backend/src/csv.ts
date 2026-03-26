import type { Asset, MarketplaceId } from './types.js'

function escapeCsvValue(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim()
  return `"${normalized.replace(/"/g, '""')}"`
}

function keywordsCsv(asset: Asset): string {
  return asset.metadata.keywords.join(', ')
}

function categoryValue(asset: Asset, marketplace: MarketplaceId): string {
  return asset.metadata.categories[marketplace] || ''
}

function assetFilename(asset: Asset): string {
  return asset.originalFilename
}

export function buildCsv(assetList: Asset[], marketplace: MarketplaceId): string {
  if (marketplace === 'vecteezy') {
    const header = ['Filename', 'Title', 'Description', 'Keywords']
    const rows = assetList.map((asset) => [
      assetFilename(asset),
      asset.metadata.title,
      asset.metadata.description,
      keywordsCsv(asset),
    ])

    return [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\n')
  }

  if (marketplace === 'adobe-stock') {
    const header = ['Filename', 'Title', 'Keywords', 'Category', 'Releases']
    const rows = assetList.map((asset) => [
      assetFilename(asset),
      asset.metadata.title,
      keywordsCsv(asset),
      categoryValue(asset, marketplace),
      '',
    ])

    return [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\n')
  }

  const header = [
    'Filename',
    'Description',
    'Keywords',
    'Categories',
    'Illustration',
    'Mature Content',
    'Editorial',
  ]
  const rows = assetList.map((asset) => [
    assetFilename(asset),
    asset.metadata.description || asset.metadata.title,
    keywordsCsv(asset),
    categoryValue(asset, marketplace),
    'No',
    asset.metadata.mature ? 'Yes' : 'No',
    asset.metadata.editorial ? 'Yes' : 'No',
  ])

  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\n')
}
