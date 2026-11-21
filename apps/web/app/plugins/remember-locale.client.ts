// Remembers the language chosen with the switcher and restores it
// when the visitor lands on the English (unprefixed) URL. See ADR-006.

const STORAGE_KEY = 'locale'
const RESTORABLE_LOCALES = ['ru', 'uk'] as const

type RestorableLocale = (typeof RESTORABLE_LOCALES)[number]

function isRestorable(value: string | null): value is RestorableLocale {
  return value !== null && (RESTORABLE_LOCALES as readonly string[]).includes(value)
}

// localStorage can be unavailable (private mode, blocked storage): treat as "nothing saved".
function readSavedLocale(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function saveLocale(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Ignore: the choice simply won't be remembered.
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const switchLocalePath = useSwitchLocalePath()

  // Save only user-initiated switches; the initial setup on page load is not a choice.
  nuxtApp.hook('i18n:beforeLocaleSwitch', ({ newLocale, initialSetup }) => {
    if (!initialSetup) {
      saveLocale(newLocale)
    }
  })

  // After hydration: restore the saved language, but only on the English URL,
  // so direct /ru and /uk links are never overridden.
  nuxtApp.hook('app:mounted', async () => {
    if (nuxtApp.$i18n.locale.value !== 'en') {
      return
    }
    const saved = readSavedLocale()
    if (!isRestorable(saved)) {
      return
    }
    // Unknown URLs (the 404 page) have no localized twin: switchLocalePath returns ''
    // and navigateTo('') would land on '/'. Keep the 404 page instead (plan revision R7.1).
    const target = switchLocalePath(saved)
    if (target) {
      await navigateTo(target, { replace: true })
    }
  })
})
