/**
 * Pending/completed grouping and ordering for the todo list. Pure functions
 * so the ordering contract stays checkable outside the component.
 */
import type { Todo } from './agent'

export interface TodoGroups {
  pending: Todo[]
  completed: Todo[]
}

function instant(value: string | null): number {
  if (!value) return Number.NaN
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

function byCreatedAsc(a: Todo, b: Todo): number {
  return instant(a.created_at) - instant(b.created_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/**
 * Pending first: reminders ascending, then reminder-less rows by creation
 * time ascending. Completed rows sort by creation time descending.
 */
export function groupTodos(items: Todo[]): TodoGroups {
  const pending = items.filter(item => item.status === 'pending')
  const completed = items.filter(item => item.status === 'completed')
  pending.sort((a, b) => {
    const aReminder = instant(a.remind_at)
    const bReminder = instant(b.remind_at)
    if (!Number.isNaN(aReminder) && !Number.isNaN(bReminder)) return aReminder - bReminder || byCreatedAsc(a, b)
    if (!Number.isNaN(aReminder)) return -1
    if (!Number.isNaN(bReminder)) return 1
    return byCreatedAsc(a, b)
  })
  completed.sort((a, b) => -byCreatedAsc(a, b))
  return { pending, completed }
}
