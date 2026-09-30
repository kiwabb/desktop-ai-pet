/**
 * Goal/note grouping and ordering for the memo list. Pure functions so the
 * ordering contract stays checkable outside the component.
 */
import type { Memo } from './agent'

export interface MemoGroups {
  goals: Memo[]
  notes: Memo[]
  archived: Memo[]
}

function instant(value: string | null): number {
  if (!value) return Number.NaN
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

function byCreatedAsc(a: Memo, b: Memo): number {
  return instant(a.created_at) - instant(b.created_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/**
 * Active memos: scheduled reviews ascending first, then review-less rows by
 * creation time ascending. Archived rows sort by creation time descending.
 */
export function groupMemos(items: Memo[]): MemoGroups {
  const active = items.filter(item => item.status === 'active')
  const archived = items.filter(item => item.status === 'archived')
  active.sort((a, b) => {
    const aReview = instant(a.review_at)
    const bReview = instant(b.review_at)
    if (!Number.isNaN(aReview) && !Number.isNaN(bReview)) return aReview - bReview || byCreatedAsc(a, b)
    if (!Number.isNaN(aReview)) return -1
    if (!Number.isNaN(bReview)) return 1
    return byCreatedAsc(a, b)
  })
  archived.sort((a, b) => -byCreatedAsc(a, b))
  return {
    goals: active.filter(item => item.kind === 'goal'),
    notes: active.filter(item => item.kind === 'note'),
    archived,
  }
}
