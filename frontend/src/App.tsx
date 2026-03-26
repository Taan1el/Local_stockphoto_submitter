import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  exportCsv,
  fetchAssets,
  fetchMarketplaces,
  generateDraft,
  importAssets,
  openMarketplacePage,
  removeAsset,
  updateAsset,
} from './api'
import type { Asset, AssetSubmissionStatus, MarketplaceDefinition, MarketplaceId } from './types'

type Notice = {
  kind: 'success' | 'error'
  text: string
}

const STATUS_OPTIONS: AssetSubmissionStatus[] = ['draft', 'ready', 'reviewing', 'submitted']

const CATEGORY_LABELS: Record<MarketplaceId, string> = {
  'adobe-stock': 'Adobe category',
  shutterstock: 'Shutterstock category',
  vecteezy: 'Vecteezy category',
}

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

function App() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [marketplaces, setMarketplaces] = useState<MarketplaceDefinition[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [workingMarketplaceId, setWorkingMarketplaceId] = useState<MarketplaceId | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [draftForm, setDraftForm] = useState<Asset['metadata'] | null>(null)
  const [draftStatuses, setDraftStatuses] = useState<Record<MarketplaceId, AssetSubmissionStatus> | null>(
    null,
  )

  useEffect(() => {
    void (async () => {
      try {
        const [loadedAssets, loadedMarketplaces] = await Promise.all([
          fetchAssets(),
          fetchMarketplaces(),
        ])
        setAssets(loadedAssets)
        setMarketplaces(loadedMarketplaces)
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

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )

  useEffect(() => {
    if (!selectedAsset) {
      setDraftForm(null)
      setDraftStatuses(null)
      return
    }

    setDraftForm(selectedAsset.metadata)
    setDraftStatuses(selectedAsset.submissionStatus)
  }, [selectedAsset])

  function replaceAsset(updatedAsset: Asset): void {
    setAssets((currentAssets) =>
      currentAssets.map((asset) => (asset.id === updatedAsset.id ? updatedAsset : asset)),
    )
  }

  async function handleImport(fileList: FileList | null): Promise<void> {
    if (!fileList || fileList.length === 0) {
      return
    }

    setUploading(true)
    setNotice(null)

    try {
      const imported = await importAssets(fileList)
      setAssets((currentAssets) => [...imported, ...currentAssets])
      setSelectedAssetId(imported[0]?.id ?? selectedAssetId)
      setNotice({
        kind: 'success',
        text: `Imported ${imported.length} photo${imported.length === 1 ? '' : 's'} into your local library.`,
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
    try {
      const updated = await generateDraft(selectedAsset.id)
      replaceAsset(updated)
      setNotice({
        kind: 'success',
        text: 'Draft metadata generated from the filename.',
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

  async function handleMarketplaceAction(
    marketplaceId: MarketplaceId,
    target: 'dashboard' | 'upload',
  ): Promise<void> {
    setWorkingMarketplaceId(marketplaceId)
    setNotice(null)

    try {
      const message = await openMarketplacePage(marketplaceId, target)
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
            place, and exports marketplace-ready CSV files for Adobe Stock, Shutterstock, and
            Vecteezy.
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

      <section className="market-grid">
        {marketplaces.map((marketplace) => (
          <article className="market-card" key={marketplace.id}>
            <div className="market-card-head">
              <div>
                <h2>{marketplace.name}</h2>
                <p>{marketplace.description}</p>
              </div>
              <span className="pill">Sessions stay local</span>
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
                onClick={() => void handleMarketplaceAction(marketplace.id, 'dashboard')}
              >
                Open session
              </button>
              <button
                className="secondary-button"
                disabled={workingMarketplaceId === marketplace.id}
                onClick={() => void handleMarketplaceAction(marketplace.id, 'upload')}
              >
                Open upload
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

      <section className="workspace">
        <aside className="library-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Library</p>
              <h2>Imported photos</h2>
            </div>
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
          </div>
          <p className="panel-copy">
            Import JPG photos into a managed local library so your CSV filenames stay consistent.
          </p>
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
                    Generate draft
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
