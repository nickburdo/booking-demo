// Kyiv calendar helpers for the booking UI. Booking dates are Kyiv dates (docs/cafe.md),
// whatever the visitor's own time zone is.

const HORIZON_DAYS = 30

/** Today's date in Kyiv as YYYY-MM-DD. */
export function kyivToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Bookable date range: today … today + 30 (Kyiv). */
export function bookableRange(now: Date = new Date()): { min: string, max: string } {
  const min = kyivToday(now)
  return { min, max: addDays(min, HORIZON_DAYS) }
}

/** Current Kyiv time as HH:MM. */
export function kyivTimeNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

/**
 * Kyiv wall clock as "YYYY-MM-DD HH:MM", refreshed every 30 s while the component is mounted,
 * so "has it started?" checks follow the clock on a page left open (v4 R2.2). Compare it with
 * `${date} ${time}` of a reservation.
 */
export function useKyivClock() {
  const stamp = () => `${kyivToday()} ${kyivTimeNow()}`
  const now = ref(stamp())
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    now.value = stamp()
    timer = setInterval(() => (now.value = stamp()), 30_000)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return now
}

/** "Sat, 5 December" in the page language; the date is a calendar date (no time zone shift). */
export function useFormatDate() {
  const { locale, locales } = useI18n()
  return (date: string, month: 'long' | 'short' = 'long'): string => {
    const tag = (locales.value as Array<{ code: string, language?: string }>).find((l) => l.code === locale.value)?.language
    return new Intl.DateTimeFormat(tag ?? 'en-US', {
      weekday: 'short',
      day: 'numeric',
      month,
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`))
  }
}
