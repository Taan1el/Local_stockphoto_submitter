import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import exifr from 'exifr'
import express from 'express'
import { imageSizeFromFile } from 'image-size/fromFile'
import multer from 'multer'
import { openExternalPage, openMarketplacePage } from './browser.js'
import { buildCsv } from './csv.js'
import { applyDraftToAsset, generateAssetDraft, replaceAssetDraft } from './metadata.js'
import { getTypedMarketplace, MARKETPLACES } from './marketplaces.js'
import { getTypedSocialShortcut, SOCIAL_SHORTCUTS } from './socialShortcuts.js'
import {
  createAssetFromImportedFile,
  defaultAssetSort,
  deleteAsset,
  ensureDataDirs,
  getExportsRoot,
  getLibraryRoot,
  getTempRoot,
  loadState,
  saveState,
  toPublicLibraryPath,
  updateAsset,
  validateImageFilename,
} from './storage.js'
import type { Asset, AssetMetadata, AssetSubmissionStatus, MarketplaceId } from './types.js'

const defaultPort = Number(process.env.PORT ?? 4242)
const frontendDist = path.resolve(import.meta.dirname, '..', '..', 'frontend', 'dist')

function serializeAsset(asset: Asset): Asset & { previewUrl: string } {
  return {
    ...asset,
    previewUrl: toPublicLibraryPath(asset),
  }
}

function normalizeKeywords(input: string[] | string): string[] {
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => item.split(','))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function createStockHubApp(): Promise<express.Express> {
  await ensureDataDirs()

  const app = express()
  const upload = multer({
    dest: getTempRoot(),
    limits: {
      files: 100,
      fileSize: 150 * 1024 * 1024,
    },
  })

  app.use(cors())
  app.use(express.json({ limit: '5mb' }))
  app.use('/library', express.static(getLibraryRoot()))
  app.use(express.static(frontendDist))

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.get('/api/marketplaces', (_request, response) => {
    response.json({ marketplaces: MARKETPLACES })
  })

  app.get('/api/social-shortcuts', (_request, response) => {
    response.json({ shortcuts: SOCIAL_SHORTCUTS })
  })

  app.get('/api/assets', async (_request, response, next) => {
    try {
      const state = await loadState()
      response.json({
        assets: [...state.assets].sort(defaultAssetSort).map(serializeAsset),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/assets/import', upload.array('files', 100), async (request, response, next) => {
    const files = request.files

    if (!Array.isArray(files) || files.length === 0) {
      response.status(400).json({ error: 'No files uploaded.' })
      return
    }

    try {
      const state = await loadState()
      const importedAssets: Asset[] = []

      for (const file of files) {
        if (!validateImageFilename(file.originalname)) {
          await fs.rm(file.path, { force: true })
          continue
        }

        const dimensions = await imageSizeFromFile(file.path)
        const metadata = await exifr.parse(file.path).catch(() => null)
        const capturedAt =
          metadata?.DateTimeOriginal instanceof Date
            ? metadata.DateTimeOriginal.toISOString()
            : metadata?.CreateDate instanceof Date
              ? metadata.CreateDate.toISOString()
              : null

        const asset = await createAssetFromImportedFile({
          originalFilename: file.originalname,
          tempFilePath: file.path,
          fileSizeBytes: file.size,
          width: dimensions.width ?? null,
          height: dimensions.height ?? null,
          capturedAt,
        })

        const drafted = applyDraftToAsset(asset)
        importedAssets.push(drafted)
        state.assets.push(drafted)
      }

      await saveState(state)

      response.status(201).json({
        assets: importedAssets.sort(defaultAssetSort).map(serializeAsset),
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/assets/:assetId', async (request, response, next) => {
    try {
      const asset = await updateAsset(request.params.assetId, (currentAsset) => {
        const payload = request.body as Partial<{
          metadata: Partial<AssetMetadata & { keywords: string[] | string }>
          submissionStatus: Partial<Record<MarketplaceId, AssetSubmissionStatus>>
        }>

        const metadataPatch = payload.metadata ?? {}
        const submissionPatch = payload.submissionStatus ?? {}

        return {
          ...currentAsset,
          metadata: {
            ...currentAsset.metadata,
            ...metadataPatch,
            keywords:
              metadataPatch.keywords !== undefined
                ? normalizeKeywords(metadataPatch.keywords)
                : currentAsset.metadata.keywords,
            categories: {
              ...currentAsset.metadata.categories,
              ...(metadataPatch.categories ?? {}),
            },
          },
          submissionStatus: {
            ...currentAsset.submissionStatus,
            ...submissionPatch,
          },
        }
      })

      if (!asset) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }

      response.json({ asset: serializeAsset(asset) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/assets/:assetId/generate-draft', async (request, response, next) => {
    try {
      const state = await loadState()
      const assetIndex = state.assets.findIndex((asset) => asset.id === request.params.assetId)

      if (assetIndex === -1) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }

      const currentAsset = state.assets[assetIndex]
      const imagePath = path.join(getLibraryRoot(), currentAsset.libraryRelativePath)
      const generated = await generateAssetDraft(imagePath, currentAsset.originalFilename)
      const updatedAsset = {
        ...replaceAssetDraft(currentAsset, generated.draft),
        updatedAt: new Date().toISOString(),
      }

      state.assets[assetIndex] = updatedAsset
      await saveState(state)

      response.json({
        asset: serializeAsset(updatedAsset),
        mode: generated.mode,
        message:
          generated.mode === 'vision'
            ? `Generated draft metadata from the actual image using ${generated.model}.`
            : 'OpenAI is not configured yet, so the app used a simple filename draft instead of image analysis.',
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/assets/:assetId', async (request, response, next) => {
    try {
      const removed = await deleteAsset(request.params.assetId)

      if (!removed) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }

      response.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/marketplaces/:marketplaceId/open', async (request, response, next) => {
    try {
      const marketplace = getTypedMarketplace(request.params.marketplaceId)
      const target = request.body?.target === 'upload' ? 'upload' : 'dashboard'
      const opened = await openMarketplacePage(marketplace, target)
      const destinationLabel =
        opened.mode === 'chrome-profile'
          ? 'your Chrome Profile 4 session'
          : opened.mode === 'system-browser'
            ? 'your default browser'
            : 'the app window'

      response.json({
        marketplace: marketplace.name,
        message: `Opened ${marketplace.name} ${target} page in ${destinationLabel}.`,
        url: opened.url,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/social-shortcuts/:shortcutId/open', async (request, response, next) => {
    try {
      const shortcut = getTypedSocialShortcut(request.params.shortcutId)
      const opened = await openExternalPage(shortcut.openUrl)
      const destinationLabel =
        opened.mode === 'chrome-profile' ? 'your Chrome Profile 4 session' : 'your default browser'

      response.json({
        shortcut: shortcut.name,
        message: `Opened ${shortcut.name} in ${destinationLabel}.`,
        url: opened.url,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/exports/:marketplaceId', async (request, response, next) => {
    try {
      const marketplace = getTypedMarketplace(request.params.marketplaceId)
      const state = await loadState()
      const requestedIds = Array.isArray(request.body?.assetIds)
        ? (request.body.assetIds as string[])
        : []

      const selectedAssets =
        requestedIds.length > 0
          ? state.assets.filter((asset) => requestedIds.includes(asset.id))
          : state.assets

      if (selectedAssets.length === 0) {
        response.status(400).json({ error: 'No assets selected for export.' })
        return
      }

      const csv = buildCsv(selectedAssets, marketplace.id)
      const filename = `${marketplace.id}-${new Date().toISOString().slice(0, 10)}.csv`
      const exportPath = path.join(getExportsRoot(), filename)
      await fs.writeFile(exportPath, csv, 'utf8')

      response.setHeader('Content-Type', 'text/csv; charset=utf-8')
      response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      response.send(csv)
    } catch (error) {
      next(error)
    }
  })

  app.get(/^(?!\/api\/|\/library\/).*/, async (_request, response, next) => {
    try {
      response.sendFile(path.join(frontendDist, 'index.html'))
    } catch (error) {
      next(error)
    }
  })

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const message =
        error instanceof Error ? error.message : 'Something went wrong while processing the request.'
      response.status(500).json({ error: message })
    },
  )

  return app
}

export async function startServer(options?: {
  host?: string
  port?: number
}): Promise<{
  app: express.Express
  close: () => Promise<void>
  port: number
  server: http.Server
}> {
  const app = await createStockHubApp()
  const host = options?.host
  const port = options?.port ?? defaultPort

  const server = await new Promise<http.Server>((resolve, reject) => {
    const startedServer =
      host === undefined
        ? app.listen(port, () => {
            resolve(startedServer)
          })
        : app.listen(port, host, () => {
            resolve(startedServer)
          })

    startedServer.on('error', reject)
  })

  const address = server.address()
  const resolvedPort = typeof address === 'object' && address ? address.port : port

  return {
    app,
    server,
    port: resolvedPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun) {
  try {
    const { port } = await startServer()
    console.log(`Stock Hub Local backend listening on http://localhost:${port}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Failed to start Stock Hub Local backend: ${message}`)
    process.exit(1)
  }
}
