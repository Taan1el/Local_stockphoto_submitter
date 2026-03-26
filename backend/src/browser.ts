import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { getProfilesRoot } from './storage.js'
import type { MarketplaceDefinition } from './types.js'

const activeContexts = new Map<string, BrowserContext>()

async function getOrCreateContext(marketplaceId: string): Promise<BrowserContext> {
  const existing = activeContexts.get(marketplaceId)

  if (existing) {
    return existing
  }

  const profileDir = path.join(getProfilesRoot(), marketplaceId)
  await fs.mkdir(profileDir, { recursive: true })

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
  target: 'dashboard' | 'upload',
): Promise<{ url: string }> {
  const context = await getOrCreateContext(marketplace.id)
  const url = target === 'dashboard' ? marketplace.dashboardUrl : marketplace.uploadUrl

  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await bringPageToFront(page)

  return { url }
}
