export type MarketplaceId = 'adobe-stock' | 'shutterstock' | 'vecteezy'
export type SocialShortcutId = 'facebook' | 'x'
export type DraftGenerationMode = 'auto' | 'openai' | 'offline'

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

export interface SocialShortcutDefinition {
  id: SocialShortcutId
  name: string
  description: string
  openUrl: string
}

export type AssetSubmissionStatus = 'draft' | 'ready' | 'reviewing' | 'submitted'

export interface AssetMetadata {
  title: string
  description: string
  keywords: string[]
  categories: Record<MarketplaceId, string>
  editorial: boolean
  mature: boolean
  notes: string
}

export interface SocialPlatformDraft {
  caption: string
  hashtags: string[]
  altText: string
  cta: string
}

export interface XPollDraft {
  question: string
  options: string[]
  durationHours: number
}

export interface XSocialDraft extends SocialPlatformDraft {
  poll: XPollDraft | null
}

export interface AssetSocialDrafts {
  facebook: SocialPlatformDraft
  x: XSocialDraft
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
  socialDrafts: AssetSocialDrafts
  submissionStatus: Record<MarketplaceId, AssetSubmissionStatus>
}

export interface AppState {
  assets: Asset[]
}

export interface AppSettings {
  draftGenerationMode: DraftGenerationMode
  openAIApiKey: string
}

export interface PublicAppSettings {
  draftGenerationMode: DraftGenerationMode
  openAIApiKeyConfigured: boolean
  openAIApiKeyPreview: string | null
}

export interface AssetDraft {
  title: string
  description: string
  keywords: string[]
  editorial: boolean
  mature: boolean
}
