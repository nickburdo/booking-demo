// Site content for the fictional coffee shop. Mirrors docs/cafe.md, which is the
// single source of truth: change the doc first, then this file.
// UI strings (section titles, buttons, day names) live in i18n/locales/*.json instead.

export type LocaleCode = 'en' | 'ru' | 'uk'

/** A text in every site language. */
export type Localized = Record<LocaleCode, string>

/** Day keys; their localized names are the `days.*` translation keys. */
export type DayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** Times are local Kyiv time, 24-hour "HH:MM". */
export interface OpeningHours {
  fromDay: DayCode
  toDay: DayCode
  opens: string
  closes: string
}

export interface MenuItem {
  id: string
  name: Localized
  /** Price in UAH, whole hryvnias. */
  price: number
}

export interface MenuCategory {
  id: string
  name: Localized
  items: MenuItem[]
}

export interface Cafe {
  name: string
  tagline: Localized
  address: Localized
  coordinates: { lat: number; lng: number }
  openingHours: OpeningHours[]
  menu: MenuCategory[]
}

export const cafe: Cafe = {
  name: 'Linden Coffee',
  tagline: {
    en: 'Slow coffee under the lindens',
    uk: 'Повільна кава під липами',
    ru: 'Неспешный кофе под липами',
  },
  address: {
    en: '7 Lypova Alley, Podil, Kyiv',
    uk: 'Липова алея, 7, Поділ, Київ',
    ru: 'Липовая аллея, 7, Подол, Киев',
  },
  coordinates: { lat: 50.4655, lng: 30.515 },
  openingHours: [
    { fromDay: 'mon', toDay: 'fri', opens: '08:00', closes: '21:00' },
    { fromDay: 'sat', toDay: 'sun', opens: '09:00', closes: '22:00' },
  ],
  menu: [
    {
      id: 'coffee',
      name: { en: 'Coffee', uk: 'Кава', ru: 'Кофе' },
      items: [
        { id: 'espresso', name: { en: 'Espresso', uk: 'Еспресо', ru: 'Эспрессо' }, price: 55 },
        { id: 'americano', name: { en: 'Americano', uk: 'Американо', ru: 'Американо' }, price: 60 },
        { id: 'cappuccino', name: { en: 'Cappuccino', uk: 'Капучино', ru: 'Капучино' }, price: 75 },
        { id: 'flat-white', name: { en: 'Flat white', uk: 'Флет вайт', ru: 'Флэт уайт' }, price: 85 },
        { id: 'latte', name: { en: 'Latte', uk: 'Лате', ru: 'Латте' }, price: 80 },
        { id: 'filter', name: { en: 'Filter coffee (V60)', uk: 'Фільтр-кава (V60)', ru: 'Фильтр-кофе (V60)' }, price: 90 },
      ],
    },
    {
      id: 'not-coffee',
      name: { en: 'Not coffee', uk: 'Не кава', ru: 'Не кофе' },
      items: [
        { id: 'linden-tea', name: { en: 'Linden tea', uk: 'Липовий чай', ru: 'Липовый чай' }, price: 60 },
        { id: 'matcha-latte', name: { en: 'Matcha latte', uk: 'Матча лате', ru: 'Матча латте' }, price: 95 },
        { id: 'hot-chocolate', name: { en: 'Hot chocolate', uk: 'Гарячий шоколад', ru: 'Горячий шоколад' }, price: 85 },
      ],
    },
    {
      id: 'breakfast',
      name: { en: 'Breakfast & pastry', uk: 'Сніданки та випічка', ru: 'Завтраки и выпечка' },
      items: [
        { id: 'croissant', name: { en: 'Croissant', uk: 'Круасан', ru: 'Круассан' }, price: 65 },
        { id: 'syrnyky', name: { en: 'Syrnyky with sour cream', uk: 'Сирники зі сметаною', ru: 'Сырники со сметаной' }, price: 150 },
        { id: 'avocado-toast', name: { en: 'Avocado toast', uk: 'Тост з авокадо', ru: 'Тост с авокадо' }, price: 170 },
        { id: 'cheesecake', name: { en: 'Cheesecake', uk: 'Чизкейк', ru: 'Чизкейк' }, price: 120 },
      ],
    },
  ],
}
