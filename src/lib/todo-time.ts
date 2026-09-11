/**
 * Friendly relative time formatting for todo rows. Pure functions so the
 * boundary buckets can be checked without mounting the component.
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const pad = (value: number) => String(value).padStart(2, '0')

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function timePart(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Format a reminder timestamp relative to `now` (both local time):
 * - overdue (before `now`): `已逾期`
 * - today: `今天 20:00`
 * - tomorrow: `明天 09:00`
 * - the day after tomorrow: `后天 09:00`
 * - later within 7 days: `周五 20:00` (Chinese weekday)
 * - later in the same year: `9月12日 20:00`
 * - another year: `2027年1月5日 20:00`
 * Seconds and timezone are never shown; unparseable input falls back to a
 * short ISO date slice.
 */
export function formatReminderTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10) || '时间不可用'
  if (date.getTime() < now.getTime()) return '已逾期'
  // Day buckets compare local midnights; rounding absorbs DST day-length skew.
  const dayDiff = Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / 86_400_000)
  if (dayDiff === 0) return `今天 ${timePart(date)}`
  if (dayDiff === 1) return `明天 ${timePart(date)}`
  if (dayDiff === 2) return `后天 ${timePart(date)}`
  if (dayDiff < 7) return `${WEEKDAYS[date.getDay()]} ${timePart(date)}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${timePart(date)}`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timePart(date)}`
}

/** Whether a reminder timestamp is already past; drives the red styling. */
export function isReminderOverdue(iso: string, now: Date = new Date()): boolean {
  const date = new Date(iso)
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime()
}

/**
 * Short absolute timestamp (`9月8日 14:30`, year prefixed only when it differs
 * from `now`), used for tooltips such as the creation time on the row title.
 */
export function formatCreatedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间不可用'
  const day = `${date.getMonth() + 1}月${date.getDate()}日`
  const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  return `${prefix}${day} ${timePart(date)}`
}

/**
 * Split a formatted reminder label into its relative/day part and its time
 * part so compact layouts can hide the day and keep only `HH:MM`.
 */
export function splitReminderLabel(label: string): { day: string; time: string } {
  const index = label.lastIndexOf(' ')
  if (index < 0) return { day: '', time: label }
  return { day: label.slice(0, index), time: label.slice(index + 1) }
}
