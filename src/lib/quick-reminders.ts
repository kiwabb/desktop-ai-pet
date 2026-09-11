/**
 * Quick reminder presets for the todo reminder editor. Pure functions so the
 * future-time guarantee can be checked without mounting the component.
 */

export type QuickReminderKey = 'tonight-20' | 'tomorrow-09' | 'tomorrow-20' | 'next-monday-09'

export interface QuickReminderOption {
  key: QuickReminderKey
  label: string
}

export const QUICK_REMINDER_OPTIONS: QuickReminderOption[] = [
  { key: 'tonight-20', label: '今晚 20:00' },
  { key: 'tomorrow-09', label: '明天 09:00' },
  { key: 'tomorrow-20', label: '明天 20:00' },
  { key: 'next-monday-09', label: '下周一 09:00' },
]

function atLocalTime(now: Date, daysLater: number, hour: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLater, hour, 0, 0, 0)
}

/**
 * Resolve a preset to an absolute local time strictly after `now`; a
 * computed time that already passed rolls forward to the next candidate day
 * (or week for the Monday preset).
 */
export function resolveQuickReminder(key: QuickReminderKey, now: Date = new Date()): Date {
  let target: Date
  let stepDays: number
  switch (key) {
    case 'tonight-20':
      target = atLocalTime(now, 0, 20)
      stepDays = 1
      break
    case 'tomorrow-09':
      target = atLocalTime(now, 1, 9)
      stepDays = 1
      break
    case 'tomorrow-20':
      target = atLocalTime(now, 1, 20)
      stepDays = 1
      break
    case 'next-monday-09': {
      // getDay: Sunday = 0 … Saturday = 6. Monday of the FOLLOWING week: a
      // Monday today resolves 7 days out, a Sunday resolves to tomorrow.
      const daysLater = (8 - now.getDay()) % 7 || 7
      target = atLocalTime(now, daysLater, 9)
      stepDays = 7
      break
    }
  }
  while (target.getTime() <= now.getTime()) {
    target = new Date(target.getFullYear(), target.getMonth(), target.getDate() + stepDays, target.getHours(), 0, 0, 0)
  }
  return target
}

/** Format a Date as a `datetime-local` input value in the local timezone. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
