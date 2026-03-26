const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog } = require('electron')

const APP_HOST = '127.0.0.1'
const DEFAULT_WINDOW_SIZE = {
  width: 1460,
  height: 940,
}

let mainWindow = null
let serverHandle = null
let isQuitting = false
const marketplaceWindows = new Map()

function resolveAppRoot() {
  return path.resolve(__dirname, '..')
}

function configureUserDataRoot() {
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  const userDataRoot = portableRoot
    ? path.join(portableRoot, 'StockHubLocalData')
    : app.getPath('userData')

  app.setPath('userData', userDataRoot)
  process.env.STOCK_HUB_DATA_ROOT = path.join(userDataRoot, 'data')
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
}

function getMarketplaceWindow(marketplaceId) {
  const existingWindow = marketplaceWindows.get(marketplaceId)

  if (existingWindow && !existingWindow.isDestroyed()) {
    return existingWindow
  }

  const marketplaceWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f7f1e8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `persist:marketplace-${marketplaceId}`,
      sandbox: true,
    },
  })

  marketplaceWindow.webContents.setWindowOpenHandler(({ url }) => {
    const childWindow = new BrowserWindow({
      width: 1180,
      height: 840,
      autoHideMenuBar: true,
      parent: marketplaceWindow,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: `persist:marketplace-${marketplaceId}`,
        sandbox: true,
      },
    })

    childWindow.once('ready-to-show', () => {
      childWindow.show()
    })

    void childWindow.loadURL(url)

    return { action: 'deny' }
  })

  marketplaceWindow.once('ready-to-show', () => {
    marketplaceWindow.show()
  })

  marketplaceWindow.on('closed', () => {
    marketplaceWindows.delete(marketplaceId)
  })

  marketplaceWindows.set(marketplaceId, marketplaceWindow)
  return marketplaceWindow
}

async function openMarketplaceWindow(marketplace, target) {
  const url = target === 'upload' ? marketplace.uploadUrl : marketplace.dashboardUrl
  const marketplaceWindow = getMarketplaceWindow(marketplace.id)

  await marketplaceWindow.loadURL(url)
  marketplaceWindow.show()
  marketplaceWindow.focus()

  return { url }
}

function createMainWindow(appUrl) {
  const window = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f2ebe1',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.loadURL(appUrl)
  return window
}

async function importBackendModule(relativePath) {
  const appRoot = resolveAppRoot()
  const moduleUrl = pathToFileURL(path.join(appRoot, relativePath)).href
  return import(moduleUrl)
}

async function startDesktopApp() {
  const browserModule = await importBackendModule(path.join('backend', 'dist', 'browser.js'))
  browserModule.setMarketplacePageOpener(openMarketplaceWindow)

  const serverModule = await importBackendModule(path.join('backend', 'dist', 'index.js'))
  serverHandle = await serverModule.startServer({
    host: APP_HOST,
    port: 0,
  })

  mainWindow = createMainWindow(`http://${APP_HOST}:${serverHandle.port}`)
}

async function stopDesktopApp() {
  if (!serverHandle) {
    return
  }

  await serverHandle.close()
  serverHandle = null
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  configureUserDataRoot()
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.setAppUserModelId('com.stockhub.local')

  app.whenReady().then(async () => {
    try {
      await startDesktopApp()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('Stock Hub Local', `Failed to start the desktop app.\n\n${message}`)
      app.quit()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
        mainWindow = createMainWindow(`http://${APP_HOST}:${serverHandle.port}`)
        return
      }

      focusMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  if (isQuitting) {
    return
  }

  isQuitting = true
  event.preventDefault()

  void stopDesktopApp()
    .catch(() => {
      // Best effort shutdown to avoid blocking app exit.
    })
    .finally(() => {
      app.quit()
    })
})
