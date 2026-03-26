#!/usr/bin/env node

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')

const PORT = Number(process.env.PORT || 4242)
const APP_URL = `http://127.0.0.1:${PORT}`
const HEALTH_URL = `${APP_URL}/api/health`
const IS_PACKAGED = typeof process.pkg !== 'undefined'
const APP_ROOT = IS_PACKAGED ? path.dirname(process.execPath) : path.resolve(__dirname, '..')
const LOG_DIR = path.join(APP_ROOT, 'launcher')
const BACKEND_LOG_PATH = path.join(LOG_DIR, 'backend.log')

function log(message) {
  console.log(`[Stock Hub Launcher] ${message}`)
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(APP_ROOT, relativePath))
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function getNodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get(HEALTH_URL, (response) => {
      const ok = response.statusCode === 200
      response.resume()
      resolve(ok)
    })

    request.on('error', () => resolve(false))
    request.setTimeout(1500, () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function waitForHealth(timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkHealth()) {
      return true
    }

    await delay(500)
  }

  return false
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    log(label)

    const child = spawn(command, args, {
      cwd: APP_ROOT,
      stdio: 'inherit',
      windowsHide: false,
    })

    child.on('error', (error) => reject(error))
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

async function ensureDependencies() {
  if (fileExists('node_modules')) {
    return
  }

  await runCommand(getNpmCommand(), ['install'], 'Installing app dependencies...')
}

async function ensureBuild() {
  if (fileExists(path.join('frontend', 'dist', 'index.html')) && fileExists(path.join('backend', 'dist', 'index.js'))) {
    return
  }

  await runCommand(getNpmCommand(), ['run', 'build'], 'Building the app for first launch...')
}

function startBackend() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logFd = fs.openSync(BACKEND_LOG_PATH, 'a')

  const child = spawn(getNodeCommand(), [path.join(APP_ROOT, 'backend', 'dist', 'index.js')], {
    cwd: APP_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
  })

  child.unref()
}

function openBrowser() {
  if (process.platform === 'win32') {
    execFile(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', APP_URL], {
      cwd: APP_ROOT,
      windowsHide: true,
    })
    return
  }

  if (process.platform === 'darwin') {
    execFile('open', [APP_URL], { cwd: APP_ROOT })
    return
  }

  execFile('xdg-open', [APP_URL], { cwd: APP_ROOT })
}

async function main() {
  log(`Using app root ${APP_ROOT}`)

  if (await checkHealth()) {
    log('App is already running. Opening it in your browser...')
    openBrowser()
    return
  }

  await ensureDependencies()
  await ensureBuild()

  log('Starting Stock Hub in the background...')
  startBackend()

  const healthy = await waitForHealth(20000)

  if (!healthy) {
    throw new Error(`Stock Hub did not respond in time. Check ${BACKEND_LOG_PATH} for details.`)
  }

  log('Opening Stock Hub...')
  openBrowser()
}

main().catch((error) => {
  console.error(`[Stock Hub Launcher] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
