import { describe, expect, it } from 'vitest'
import { quickReminderOptions, resolveQuickReminder, toLocalInputValue } from './quick-reminders'
import { formatReminderTime, isReminderOverdue } from './todo-time'

// Isolated clock inputs; these tests do not create application records.
describe('quick reminder calendar boundaries', () => {
  it('offers tonight only while 20:00 remains in the future', () => {
    expect(quickReminderOptions(new Date(2026, 8, 14, 19, 59, 59)).map(option => option.key)).toContain('tonight-20')
    expect(quickReminderOptions(new Date(2026, 8, 14, 20)).map(option => option.key)).not.toContain('tonight-20')
    expect(quickReminderOptions(new Date(2026, 8, 14, 23, 59)).map(option => option.label)).toEqual(['明天 09:00', '明天 20:00', '下周一 09:00'])
  })

  it('resolves all offered options to future dates without duplicate targets', () => {
    for (const now of [new Date(2026, 8, 14, 19), new Date(2026, 8, 14, 21)]) {
      const targets = quickReminderOptions(now).map(option => resolveQuickReminder(option.key, now))
      expect(targets.every(target => target.getTime() > now.getTime())).toBe(true)
      expect(new Set(targets.map(target => target.getTime())).size).toBe(targets.length)
    }
  })

  it('keeps next Monday relative to the following week', () => {
    expect(toLocalInputValue(resolveQuickReminder('next-monday-09', new Date(2026, 8, 14, 8)))).toBe('2026-09-21T09:00')
    expect(toLocalInputValue(resolveQuickReminder('next-monday-09', new Date(2026, 8, 20, 22)))).toBe('2026-09-21T09:00')
  })

  it('crosses year boundaries with local calendar dates', () => {
    const now = new Date(2026, 11, 31, 23, 59)
    const target = resolveQuickReminder('tomorrow-09', now)
    expect(toLocalInputValue(target)).toBe('2027-01-01T09:00')
    expect(formatReminderTime(target.toISOString(), now)).toBe('明天 09:00')
    expect(isReminderOverdue(target.toISOString(), now)).toBe(false)
  })
})
