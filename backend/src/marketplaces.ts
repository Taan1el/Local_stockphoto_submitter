import type { MarketplaceDefinition, MarketplaceId } from './types.js'

export const MARKETPLACES: MarketplaceDefinition[] = [
  {
    id: 'adobe-stock',
    name: 'Adobe Stock',
    description:
      'Prepare files here, then upload images and optionally a CSV from the contributor portal.',
    sessionStoredLocally: true,
    uploadMethods: ['Web dashboard', 'SFTP for eligible accounts', 'CSV metadata import'],
    csvSupported: true,
    dashboardUrl: 'https://contributor.stock.adobe.com/',
    uploadUrl: 'https://contributor.stock.adobe.com/uploads',
  },
  {
    id: 'shutterstock',
    name: 'Shutterstock',
    description:
      'Use the contributor dashboard or FTPS for images, then attach metadata with a CSV on the submit page.',
    sessionStoredLocally: true,
    uploadMethods: ['Web dashboard', 'FTPS', 'CSV metadata import'],
    csvSupported: true,
    dashboardUrl: 'https://submit.shutterstock.com/',
    uploadUrl: 'https://submit.shutterstock.com/dashboard',
  },
  {
    id: 'vecteezy',
    name: 'Vecteezy',
    description:
      'Upload with the contributor dashboard or FTP, then use CSV metadata import on Add Data.',
    sessionStoredLocally: true,
    uploadMethods: ['Web dashboard', 'FTP', 'CSV metadata import'],
    csvSupported: true,
    dashboardUrl: 'https://contributors.vecteezy.com/',
    uploadUrl: 'https://contributors.vecteezy.com/portfolio/upload',
  },
]

export function getMarketplace(id: string): MarketplaceDefinition | undefined {
  return MARKETPLACES.find((marketplace) => marketplace.id === id)
}

export function getTypedMarketplace(id: string): MarketplaceDefinition {
  const marketplace = getMarketplace(id)

  if (!marketplace) {
    throw new Error(`Unsupported marketplace: ${id}`)
  }

  return marketplace
}

export function allMarketplaceIds(): MarketplaceId[] {
  return MARKETPLACES.map((marketplace) => marketplace.id)
}
