import type { SocialShortcutDefinition, SocialShortcutId } from './types.js'

export const SOCIAL_SHORTCUTS: SocialShortcutDefinition[] = [
  {
    id: 'facebook',
    name: 'Facebook',
    description:
      'Open Facebook in your logged-in Chrome profile so you can start a new post and attach the selected photo manually.',
    openUrl: 'https://www.facebook.com/',
  },
  {
    id: 'x',
    name: 'X',
    description:
      'Open the X post composer in your logged-in Chrome profile so you can attach the selected photo manually.',
    openUrl: 'https://x.com/compose/post',
  },
]

export function getSocialShortcut(id: string): SocialShortcutDefinition | undefined {
  return SOCIAL_SHORTCUTS.find((shortcut) => shortcut.id === id)
}

export function getTypedSocialShortcut(id: string): SocialShortcutDefinition {
  const shortcut = getSocialShortcut(id)

  if (!shortcut) {
    throw new Error(`Unsupported social shortcut: ${id}`)
  }

  return shortcut
}

export function allSocialShortcutIds(): SocialShortcutId[] {
  return SOCIAL_SHORTCUTS.map((shortcut) => shortcut.id)
}
