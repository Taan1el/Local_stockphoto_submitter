import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { getProfilesRoot } from './storage.js'
import type { MarketplaceDefinition } from './types.js'

const activeContexts = new Map<string, BrowserContext>()
const defaultChromeProfile = process.env.STOCK_HUB_CHROME_PROFILE ?? 'Profile 4'

type MarketplacePageTarget = 'dashboard' | 'upload'
type OpenMode = 'chrome-profile' | 'playwright' | 'custom' | 'system-browser'
type MarketplacePageResult = { url: string; mode: OpenMode }
type MarketplacePageOpener = (
  marketplace: MarketplaceDefinition,
  target: MarketplacePageTarget,
) => Promise<MarketplacePageResult>

let customMarketplacePageOpener: MarketplacePageOpener | null = null

export function setMarketplacePageOpener(opener: MarketplacePageOpener | null): void {
  customMarketplacePageOpener = opener
}

function getChromeUserDataDir(): string | null {
  if (process.env.STOCK_HUB_CHROME_USER_DATA_DIR) {
    return path.resolve(process.env.STOCK_HUB_CHROME_USER_DATA_DIR)
  }

  if (!process.env.LOCALAPPDATA) {
    return null
  }

  return path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
}

function getChromeExecutableCandidates(): string[] {
  const candidates = [
    process.env.STOCK_HUB_CHROME_PATH,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ]

  return candidates.filter((candidate): candidate is string => Boolean(candidate))
}

async function findExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next candidate path.
    }
  }

  return null
}

async function tryOpenInChromeProfile(url: string): Promise<boolean> {
  const chromeUserDataDir = getChromeUserDataDir()

  if (!chromeUserDataDir) {
    return false
  }

  const chromeExecutable = await findExistingPath(getChromeExecutableCandidates())

  if (!chromeExecutable) {
    return false
  }

  const profilePath = path.join(chromeUserDataDir, defaultChromeProfile)

  try {
    await fs.access(profilePath)
  } catch {
    return false
  }

  const chromeProcess = spawn(
    chromeExecutable,
    [
      `--user-data-dir=${chromeUserDataDir}`,
      `--profile-directory=${defaultChromeProfile}`,
      '--new-tab',
      url,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  )

  chromeProcess.unref()
  return true
}

async function openInSystemBrowser(url: string): Promise<boolean> {
  try {
    const browserProcess = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    browserProcess.unref()
    return true
  } catch {
    return false
  }
}

async function getOrCreateContext(marketplaceId: string): Promise<BrowserContext> {
  const existing = activeContexts.get(marketplaceId)

  if (existing) {
    return existing
  }

  const profileDir = path.join(getProfilesRoot(), marketplaceId)
  await fs.mkdir(profileDir, { recursive: true })

  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
  })

  context.on('close', () => {
    activeContexts.delete(marketplaceId)
  })

  activeContexts.set(marketplaceId, context)
  return context
}

async function bringPageToFront(page: Page): Promise<void> {
  try {
    await page.bringToFront()
  } catch {
    // Ignore focus failures and still return the page to the caller.
  }
}

export async function openMarketplacePage(
  marketplace: MarketplaceDefinition,
  target: MarketplacePageTarget,
): Promise<MarketplacePageResult> {
  const url = target === 'dashboard' ? marketplace.dashboardUrl : marketplace.uploadUrl

  if (await tryOpenInChromeProfile(url)) {
    return { url, mode: 'chrome-profile' }
  }

  if (customMarketplacePageOpener) {
    const opened = await customMarketplacePageOpener(marketplace, target)
    return {
      ...opened,
      mode: opened.mode ?? 'custom',
    }
  }

  const context = await getOrCreateContext(marketplace.id)
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await bringPageToFront(page)

  return { url, mode: 'playwright' }
}

export async function openExternalPage(url: string): Promise<MarketplacePageResult> {
  if (await tryOpenInChromeProfile(url)) {
    return { url, mode: 'chrome-profile' }
  }

  if (await openInSystemBrowser(url)) {
    return { url, mode: 'system-browser' }
  }

  throw new Error('Unable to open the requested page in Chrome or the default browser.')
}
