import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  exportCsv,
  fetchAssets,
  fetchMarketplaces,
  fetchSettings,
  fetchSocialShortcuts,
  generateDraft,
  importAssets,
  openMarketplacePage,
  openSocialShortcut,
  removeAsset,
  saveSettings,
  updateAsset,
} from './api'
import type {
  AppSettings,
  Asset,
  AssetSubmissionStatus,
  DraftGenerationMode,
  MarketplaceDefinition,
  MarketplaceId,
  SocialShortcutDefinition,
  SocialShortcutId,
} from './types'

type Notice = {
  kind: 'success' | 'error'
  text: string
}

type DragDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

const STATUS_OPTIONS: AssetSubmissionStatus[] = ['draft', 'ready', 'reviewing', 'submitted']
const DRAFT_MODE_OPTIONS: Array<{ value: DraftGenerationMode; label: string; help: string }> = [
  {
    value: 'auto',
    label: 'Auto',
    help: 'Use OpenAI when a key is saved, otherwise use the local offline model.',
  },
  {
    value: 'offline',
    label: 'Offline',
    help: 'Run local metadata generation on this PC. The first run downloads local models once.',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    help: 'Always use your OpenAI API key for image-aware metadata generation.',
  },
]

const CATEGORY_LABELS: Record<MarketplaceId, string> = {
  'adobe-stock': 'Adobe category',
  shutterstock: 'Shutterstock category',
  vecteezy: 'Vecteezy category',
}

const IMAGE_FILE_PATTERN = /\.(jpe?g)$/i

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function isImportableImage(file: File): boolean {
  return IMAGE_FILE_PATTERN.test(file.name)
}

function readDroppedFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader()
    const collected: FileSystemEntry[] = []

    function readNextBatch(): void {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(collected)
            return
          }

          collected.push(...entries)
          readNextBatch()
        },
        (error) => reject(error),
      )
    }

    readNextBatch()
  })
}

async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [await readDroppedFile(entry as FileSystemFileEntry)]
  }

  if (!entry.isDirectory) {
    return []
  }

  const childEntries = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
  const nestedFiles = await Promise.all(childEntries.map((childEntry) => collectFilesFromEntry(childEntry)))
  return nestedFiles.flat()
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []) as DragDataTransferItem[]
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (entries.length > 0) {
    const files = await Promise.all(entries.map((entry) => collectFilesFromEntry(entry)))
    return files.flat()
  }

  return Array.from(dataTransfer.files ?? [])
}

function App() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [marketplaces, setMarketplaces] = useState<MarketplaceDefinition[]>([])
  const [socialShortcuts, setSocialShortcuts] = useState<SocialShortcutDefinition[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsDraftMode, setSettingsDraftMode] = useState<DraftGenerationMode>('auto')
  const [settingsApiKey, setSettingsApiKey] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [workingMarketplaceId, setWorkingMarketplaceId] = useState<MarketplaceId | null>(null)
  const [workingSocialShortcutId, setWorkingSocialShortcutId] = useState<SocialShortcutId | null>(
    null,
  )
  const [notice, setNotice] = useState<Notice | null>(null)
  const [draftForm, setDraftForm] = useState<Asset['metadata'] | null>(null)
  const [draftStatuses, setDraftStatuses] = useState<Record<MarketplaceId, AssetSubmissionStatus> | null>(
    null,
  )
  const [isDragActive, setIsDragActive] = useState(false)
  const [showAdvancedFields, setShowAdvancedFields] = useState(false)
  const dragDepthRef = useRef(0)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [loadedAssets, loadedMarketplaces, loadedShortcuts, loadedSettings] = await Promise.all([
          fetchAssets(),
          fetchMarketplaces(),
          fetchSocialShortcuts(),
          fetchSettings(),
        ])
        setAssets(loadedAssets)
        setMarketplaces(loadedMarketplaces)
        setSocialShortcuts(loadedShortcuts)
        setSettings(loadedSettings)
        setSettingsDraftMode(loadedSettings.draftGenerationMode)
        setSelectedAssetId(loadedAssets[0]?.id ?? null)
      } catch (error) {
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Failed to load the local app.',
        })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    const folderInput = folderInputRef.current

    if (!folderInput) {
      return
    }

    folderInput.setAttribute('webkitdirectory', '')
    folderInput.setAttribute('directory', '')
  }, [])

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )

  useEffect(() => {
    if (!selectedAsset) {
      setDraftForm(null)
      setDraftStatuses(null)
      setShowAdvancedFields(false)
      return
    }

    setDraftForm(selectedAsset.metadata)
    setDraftStatuses(selectedAsset.submissionStatus)
    setShowAdvancedFields(
      Object.values(selectedAsset.metadata.categories).some((value) => value.trim().length > 0) ||
        Object.values(selectedAsset.submissionStatus).some((status) => status !== 'draft'),
    )
  }, [selectedAsset])

  function replaceAsset(updatedAsset: Asset): void {
    setAssets((currentAssets) =>
      currentAssets.map((asset) => (asset.id === updatedAsset.id ? updatedAsset : asset)),
    )
  }

  async function handleImport(fileList: FileList | File[] | null): Promise<void> {
    const providedFiles = fileList ? Array.from(fileList) : []

    if (providedFiles.length === 0) {
      return
    }

    const importableFiles = providedFiles.filter((file) => isImportableImage(file))
    const skippedCount = providedFiles.length - importableFiles.length

    if (importableFiles.length === 0) {
      setNotice({
        kind: 'error',
        text:
          skippedCount > 0
            ? `No JPG images found. Skipped ${skippedCount} unsupported item${skippedCount === 1 ? '' : 's'}.`
            : 'No JPG images found to import.',
      })
      return
    }

    setUploading(true)
    setNotice(null)

    try {
      const imported = await importAssets(importableFiles)

      if (imported.length === 0) {
        setNotice({
          kind: 'error',
          text: 'No images were imported. Please try again.',
        })
        return
      }

      setAssets((currentAssets) => [...imported, ...currentAssets])
      setSelectedAssetId(imported[0]?.id ?? selectedAssetId)
      setNotice({
        kind: 'success',
        text:
          skippedCount > 0
            ? `Imported ${imported.length} JPG photo${imported.length === 1 ? '' : 's'} and skipped ${skippedCount} unsupported item${skippedCount === 1 ? '' : 's'}.`
            : `Imported ${imported.length} photo${imported.length === 1 ? '' : 's'} into your local library.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Import failed.',
      })
    } finally {
      setUploading(false)
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()

    if (uploading) {
      return
    }

    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()

    if (uploading) {
      return
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault()
    event.stopPropagation()

    dragDepthRef.current = 0
    setIsDragActive(false)

    if (uploading) {
      return
    }

    try {
      const droppedFiles = await collectDroppedFiles(event.dataTransfer)
      await handleImport(droppedFiles)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to read the dropped files.',
      })
    }
  }

  async function handleSave(): Promise<void> {
    if (!selectedAsset || !draftForm || !draftStatuses) {
      return
    }

    setSaving(true)
    setNotice(null)

    try {
      const updated = await updateAsset({
        assetId: selectedAsset.id,
        metadata: draftForm,
        submissionStatus: draftStatuses,
      })
      replaceAsset(updated)
      setNotice({
        kind: 'success',
        text: 'Metadata and marketplace status saved locally.',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Save failed.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateDraft(): Promise<void> {
    if (!selectedAsset) {
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      const result = await generateDraft(selectedAsset.id)
      replaceAsset(result.asset)
      setNotice({
        kind: 'success',
        text: result.message,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Draft generation failed.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSettings(): Promise<void> {
    setSavingSettings(true)
    setNotice(null)

    try {
      const updatedSettings = await saveSettings({
        draftGenerationMode: settingsDraftMode,
        openAIApiKey: settingsApiKey.trim() || undefined,
      })
      setSettings(updatedSettings)
      setSettingsApiKey('')
      setNotice({
        kind: 'success',
        text:
          settingsDraftMode === 'offline'
            ? 'Draft settings saved. Offline mode is enabled.'
            : updatedSettings.openAIApiKeyConfigured
              ? 'Draft settings saved. Your OpenAI key is stored locally for this app.'
              : 'Draft settings saved.',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to save draft settings.',
      })
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleClearSavedApiKey(): Promise<void> {
    setSavingSettings(true)
    setNotice(null)

    try {
      const updatedSettings = await saveSettings({
        draftGenerationMode: settingsDraftMode,
        clearOpenAIApiKey: true,
      })
      setSettings(updatedSettings)
      setSettingsApiKey('')
      setNotice({
        kind: 'success',
        text: 'The saved OpenAI API key was removed from this app.',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to clear the saved API key.',
      })
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleSocialShortcut(shortcutId: SocialShortcutId): Promise<void> {
    setWorkingSocialShortcutId(shortcutId)
    setNotice(null)

    try {
      const message = await openSocialShortcut(shortcutId)
      setNotice({
        kind: 'success',
        text: message,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to open the social shortcut.',
      })
    } finally {
      setWorkingSocialShortcutId(null)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedAsset) {
      return
    }

    const confirmed = window.confirm(`Remove ${selectedAsset.originalFilename} from the local library?`)

    if (!confirmed) {
      return
    }

    try {
      await removeAsset(selectedAsset.id)
      const nextAssets = assets.filter((asset) => asset.id !== selectedAsset.id)
      setAssets(nextAssets)
      setSelectedForExport((current) => current.filter((assetId) => assetId !== selectedAsset.id))
      setSelectedAssetId(nextAssets[0]?.id ?? null)
      setNotice({
        kind: 'success',
        text: 'Asset removed from the local library.',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Delete failed.',
      })
    }
  }

  async function handleMarketplaceAction(marketplaceId: MarketplaceId): Promise<void> {
    setWorkingMarketplaceId(marketplaceId)
    setNotice(null)

    try {
      const message = await openMarketplacePage(marketplaceId, 'upload')
      setNotice({
        kind: 'success',
        text: message,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to open the marketplace.',
      })
    } finally {
      setWorkingMarketplaceId(null)
    }
  }

  async function handleExport(marketplaceId: MarketplaceId): Promise<void> {
    setWorkingMarketplaceId(marketplaceId)
    setNotice(null)

    try {
      const { filename, blob } = await exportCsv(marketplaceId, selectedForExport)
      downloadBlob(blob, filename)
      setNotice({
        kind: 'success',
        text:
          selectedForExport.length > 0
            ? `Exported ${selectedForExport.length} selected asset${selectedForExport.length === 1 ? '' : 's'} for ${marketplaceId}.`
            : `Exported all ${assets.length} assets for ${marketplaceId}.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'CSV export failed.',
      })
    } finally {
      setWorkingMarketplaceId(null)
    }
  }

  function toggleSelectedForExport(assetId: string): void {
    setSelectedForExport((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    )
  }

  const readyCount = assets.filter((asset) =>
    Object.values(asset.submissionStatus).some((status) => status === 'ready'),
  ).length

  const editorDisabled = !selectedAsset || !draftForm || !draftStatuses
  const generateButtonLabel =
    settingsDraftMode === 'offline'
      ? 'Generate offline draft'
      : settingsDraftMode === 'openai'
        ? 'Generate OpenAI draft'
        : 'Generate draft'

  if (loading) {
    return (
      <main className="shell loading-shell">
        <div className="loading-card">
          <p>Loading your local stock hub...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Local stock submission hub</p>
          <h1>Prepare once, review everywhere.</h1>
          <p className="hero-copy">
            This MVP keeps your contributor sessions on your PC, lets you prep photo metadata in one
            place, exports marketplace-ready CSV files for Adobe Stock, Shutterstock, and Vecteezy,
            and gives you quick Chrome shortcuts for social posting.
          </p>
        </div>
        <div className="hero-stats">
          <article>
            <span>{assets.length}</span>
            <p>Photos in local library</p>
          </article>
          <article>
            <span>{readyCount}</span>
            <p>Marked ready for at least one marketplace</p>
          </article>
          <article>
            <span>{selectedForExport.length || assets.length}</span>
            <p>{selectedForExport.length > 0 ? 'Selected for CSV export' : 'Current export batch size'}</p>
          </article>
        </div>
      </section>

      {notice ? <div className={`notice ${notice.kind}`}>{notice.text}</div> : null}

      {settings ? (
        <section className="settings-panel">
          <div className="section-head">
            <div>
              <p className="panel-kicker">Draft settings</p>
              <h2>Metadata generation mode</h2>
            </div>
            <p className="section-copy">
              Offline mode uses a pretrained local model. You do not need to train it first. If
              you want better quality later, we can improve prompts or switch to a stronger local
              model.
            </p>
          </div>
          <div className="settings-grid">
            <label>
              Draft generation mode
              <select
                value={settingsDraftMode}
                onChange={(event) => setSettingsDraftMode(event.target.value as DraftGenerationMode)}
              >
                {DRAFT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              OpenAI API key
              <input
                placeholder={
                  settings.openAIApiKeyConfigured
                    ? `Saved locally (${settings.openAIApiKeyPreview ?? 'configured'})`
                    : 'Paste your OpenAI API key here'
                }
                type="password"
                value={settingsApiKey}
                onChange={(event) => setSettingsApiKey(event.target.value)}
              />
            </label>
          </div>
          <div className="settings-help">
            <span className="method-chip">
              {
                DRAFT_MODE_OPTIONS.find((option) => option.value === settingsDraftMode)?.help
              }
            </span>
            {settings.openAIApiKeyConfigured ? (
              <span className="method-chip">Saved key: {settings.openAIApiKeyPreview}</span>
            ) : (
              <span className="method-chip">No OpenAI key saved yet</span>
            )}
          </div>
          <div className="market-actions">
            <button
              className="primary-button"
              disabled={savingSettings}
              onClick={() => void handleSaveSettings()}
            >
              {savingSettings ? 'Saving...' : 'Save draft settings'}
            </button>
            {settings.openAIApiKeyConfigured ? (
              <button
                className="secondary-button"
                disabled={savingSettings}
                onClick={() => void handleClearSavedApiKey()}
              >
                Clear saved key
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="market-grid">
        {marketplaces.map((marketplace) => (
          <article className="market-card" key={marketplace.id}>
            <div className="market-card-head">
              <div>
                <h2>{marketplace.name}</h2>
                <p>{marketplace.description}</p>
              </div>
              <span className="pill">Chrome Profile 4</span>
            </div>
            <div className="market-meta">
              {marketplace.uploadMethods.map((method) => (
                <span className="method-chip" key={method}>
                  {method}
                </span>
              ))}
            </div>
            <div className="market-actions">
              <button
                className="secondary-button"
                disabled={workingMarketplaceId === marketplace.id}
                onClick={() => void handleMarketplaceAction(marketplace.id)}
              >
                Open in Chrome
              </button>
              <button
                className="primary-button"
                disabled={workingMarketplaceId === marketplace.id || assets.length === 0}
                onClick={() => void handleExport(marketplace.id)}
              >
                Export CSV
              </button>
            </div>
          </article>
        ))}
      </section>

      {socialShortcuts.length > 0 ? (
        <section className="social-section">
          <div className="section-head">
            <div>
              <p className="panel-kicker">Social</p>
              <h2>Posting shortcuts</h2>
            </div>
            <p className="section-copy">
              These buttons open your logged-in Chrome Profile 4 pages. You will still attach the
              image manually on the site.
            </p>
          </div>
          <div className="market-grid social-grid">
            {socialShortcuts.map((shortcut) => (
              <article className="market-card" key={shortcut.id}>
                <div className="market-card-head">
                  <div>
                    <h2>{shortcut.name}</h2>
                    <p>{shortcut.description}</p>
                  </div>
                  <span className="pill">Chrome Profile 4</span>
                </div>
                <div className="market-actions">
                  <button
                    className="secondary-button"
                    disabled={workingSocialShortcutId === shortcut.id}
                    onClick={() => void handleSocialShortcut(shortcut.id)}
                  >
                    Open in Chrome
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="workspace">
        <aside className="library-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Library</p>
              <h2>Imported photos</h2>
            </div>
            <div className="upload-actions">
              <label className="upload-button">
                {uploading ? 'Importing...' : 'Import photos'}
                <input
                  accept=".jpg,.jpeg"
                  disabled={uploading}
                  multiple
                  type="file"
                  onChange={(event) => {
                    void handleImport(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              <label className="upload-button secondary-upload">
                Import folder
                <input
                  ref={folderInputRef}
                  accept=".jpg,.jpeg"
                  disabled={uploading}
                  multiple
                  type="file"
                  onChange={(event) => {
                    void handleImport(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            </div>
          </div>
          <p className="panel-copy">
            Import JPG photos into a managed local library so your CSV filenames stay consistent.
          </p>
          <div
            className={`dropzone ${isDragActive ? 'drag-active' : ''} ${uploading ? 'disabled' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(event) => {
              void handleDrop(event)
            }}
          >
            <strong>Drop a JPG or a whole folder here</strong>
            <span>Nested folders are supported. Non-JPG files will be skipped.</span>
          </div>
          <div className="asset-list">
            {assets.length === 0 ? (
              <div className="empty-state">
                <p>No photos yet.</p>
                <span>Start by importing the JPG files you want to prepare for upload.</span>
              </div>
            ) : null}
            {assets.map((asset) => {
              const exportSelected = selectedForExport.includes(asset.id)
              return (
                <button
                  className={`asset-row ${selectedAssetId === asset.id ? 'selected' : ''}`}
                  key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  type="button"
                >
                  <img alt={asset.originalFilename} src={asset.previewUrl} />
                  <div className="asset-row-copy">
                    <strong>{asset.originalFilename}</strong>
                    <span>
                      {asset.width && asset.height ? `${asset.width} x ${asset.height}` : 'Unknown size'} ·{' '}
                      {formatBytes(asset.fileSizeBytes)}
                    </span>
                    <span className="status-line">
                      {Object.entries(asset.submissionStatus)
                        .filter(([, status]) => status !== 'draft')
                        .map(([marketplaceId, status]) => `${marketplaceId}: ${status}`)
                        .join(' · ') || 'No marketplace status set yet'}
                    </span>
                  </div>
                  <label
                    className="export-toggle"
                    onClick={(event) => {
                      event.stopPropagation()
                    }}
                  >
                    <input
                      checked={exportSelected}
                      type="checkbox"
                      onChange={() => toggleSelectedForExport(asset.id)}
                    />
                    <span>Batch</span>
                  </label>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="editor-panel">
          {!selectedAsset || !draftForm || !draftStatuses ? (
            <div className="editor-empty">
              <p>Select a photo to edit metadata and marketplace status.</p>
            </div>
          ) : (
            <>
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Metadata</p>
                  <h2>{selectedAsset.originalFilename}</h2>
                </div>
                <div className="editor-actions">
                  <button className="secondary-button" disabled={saving} onClick={() => void handleGenerateDraft()}>
                    {generateButtonLabel}
                  </button>
                  <button className="ghost-button" onClick={() => void handleDelete()}>
                    Remove
                  </button>
                </div>
              </div>

              <div className="editor-grid">
                <div className="preview-panel">
                  <img alt={selectedAsset.originalFilename} src={selectedAsset.previewUrl} />
                  <dl>
                    <div>
                      <dt>Captured</dt>
                      <dd>{selectedAsset.capturedAt ? new Date(selectedAsset.capturedAt).toLocaleString() : 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{new Date(selectedAsset.updatedAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Managed size</dt>
                      <dd>{formatBytes(selectedAsset.fileSizeBytes)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="form-panel">
                  <label>
                    Title
                    <input
                      type="text"
                      value={draftForm.title}
                      onChange={(event) =>
                        setDraftForm((current) => (current ? { ...current, title: event.target.value } : current))
                      }
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      rows={4}
                      value={draftForm.description}
                      onChange={(event) =>
                        setDraftForm((current) =>
                          current ? { ...current, description: event.target.value } : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    Keywords
                    <textarea
                      rows={4}
                      value={draftForm.keywords.join(', ')}
                      onChange={(event) =>
                        setDraftForm((current) =>
                          current
                            ? {
                                ...current,
                                keywords: event.target.value
                                  .split(',')
                                  .map((keyword) => keyword.trim())
                                  .filter(Boolean),
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                  <div className="form-checks">
                    <label className="checkbox-row">
                      <input
                        checked={draftForm.editorial}
                        type="checkbox"
                        onChange={(event) =>
                          setDraftForm((current) =>
                            current ? { ...current, editorial: event.target.checked } : current,
                          )
                        }
                      />
                      <span>Editorial content</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        checked={draftForm.mature}
                        type="checkbox"
                        onChange={(event) =>
                          setDraftForm((current) =>
                            current ? { ...current, mature: event.target.checked } : current,
                          )
                        }
                      />
                      <span>Mature content</span>
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea
                      rows={3}
                      value={draftForm.notes}
                      onChange={(event) =>
                        setDraftForm((current) => (current ? { ...current, notes: event.target.value } : current))
                      }
                    />
                  </label>
                </div>
              </div>

              <section className="advanced-section">
                <div className="advanced-head">
                  <div>
                    <p className="panel-kicker">Advanced</p>
                    <h3>Advanced export fields</h3>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setShowAdvancedFields((current) => !current)}
                  >
                    {showAdvancedFields ? 'Hide fields' : 'Show fields'}
                  </button>
                </div>
                <p className="advanced-copy">
                  This section is only for marketplace category codes and your own stock-site status
                  tracking for CSV export. If you just want fast Chrome uploads, you can ignore it.
                </p>
                {showAdvancedFields ? (
                  <div className="marketplace-editor">
                    {(['adobe-stock', 'shutterstock', 'vecteezy'] as MarketplaceId[]).map((marketplaceId) => (
                      <article className="marketplace-fieldset" key={marketplaceId}>
                        <h3>{CATEGORY_LABELS[marketplaceId]}</h3>
                        <label>
                          Category or category code
                          <input
                            type="text"
                            value={draftForm.categories[marketplaceId]}
                            onChange={(event) =>
                              setDraftForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      categories: {
                                        ...current.categories,
                                        [marketplaceId]: event.target.value,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <label>
                          Submission status
                          <select
                            value={draftStatuses[marketplaceId]}
                            onChange={(event) =>
                              setDraftStatuses((current) =>
                                current
                                  ? {
                                      ...current,
                                      [marketplaceId]: event.target.value as AssetSubmissionStatus,
                                    }
                                  : current,
                              )
                            }
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <div className="footer-actions">
                <button
                  className="primary-button"
                  disabled={editorDisabled || saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? 'Saving...' : 'Save metadata'}
                </button>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
