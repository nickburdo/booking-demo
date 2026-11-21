import type { LocaleCode, Localized } from '~/data/cafe'

// Picks the current-language variant of a Localized text from app/data/cafe.ts.
export function useLocalized() {
  const { locale } = useI18n()
  return (text: Localized): string => text[locale.value as LocaleCode]
}
