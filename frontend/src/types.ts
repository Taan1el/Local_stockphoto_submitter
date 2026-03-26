export type MarketplaceId = 'adobe-stock' | 'shutterstock' | 'vecteezy'

export type AssetSubmissionStatus = 'draft' | 'ready' | 'reviewing' | 'submitted'

export interface MarketplaceDefinition {
  id: MarketplaceId
  name: string
  description: string
  sessionStoredLocally: boolean
  uploadMethods: string[]
  csvSupported: boolean
  dashboardUrl: string
  uploadUrl: string
}

export interface AssetMetadata {
  title: string
  description: string
  keywords: string[]
  categories: Record<MarketplaceId, string>
  editorial: boolean
  mature: boolean
  notes: string
}

export interface Asset {
  id: string
  originalFilename: string
  libraryRelativePath: string
  createdAt: string
  updatedAt: string
  fileSizeBytes: number
  width: number | null
  height: number | null
  capturedAt: string | null
  metadata: AssetMetadata
  submissionStatus: Record<MarketplaceId, AssetSubmissionStatus>
  previewUrl: string
}
