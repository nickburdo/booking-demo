// Vue I18n runtime options (loaded by @nuxtjs/i18n from i18n/i18n.config.ts).
// Russian and Ukrainian have three plural forms (one / few / many, as for 1, 2 and 5 guests).
// Their messages are written as "one | few | many" (v4: admin counts).

function slavicPlural(choice: number, choicesLength: number): number {
  if (choicesLength < 3) return choice === 1 ? 0 : 1
  const mod10 = choice % 10
  const mod100 = choice % 100
  if (mod10 === 1 && mod100 !== 11) return 0
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1
  return 2
}

export default defineI18nConfig(() => ({
  pluralRules: { ru: slavicPlural, uk: slavicPlural },
}))
