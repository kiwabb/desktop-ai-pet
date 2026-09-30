import { describe, expect, it } from 'vitest'

import type { Memo } from './agent'
import { groupMemos } from './memo-sort'

let sequence = 0
function memo(overrides: Partial<Memo> = {}): Memo {
  sequence += 1
  return {
    id: `memo-${sequence}`,
    kind: 'note',
    title: `备忘${sequence}`,
    content: null,
    status: 'active',
    review_at: null,
    created_at: `2026-09-0${(sequence % 9) + 1}T00:00:00Z`,
    ...overrides,
  }
}

describe('groupMemos', () => {
  it('separates active goals, active notes and archived rows', () => {
    const goal = memo({ kind: 'goal' })
    const note = memo({ kind: 'note' })
    const archivedGoal = memo({ kind: 'goal', status: 'archived' })
    const groups = groupMemos([archivedGoal, note, goal])
    expect(groups.goals.map(item => item.id)).toEqual([goal.id])
    expect(groups.notes.map(item => item.id)).toEqual([note.id])
    expect(groups.archived.map(item => item.id)).toEqual([archivedGoal.id])
  })

  it('orders scheduled reviews first by time, then review-less rows by creation', () => {
    const noReviewOld = memo({ created_at: '2026-09-01T00:00:00Z' })
    const later = memo({ review_at: '2026-10-02T08:00:00Z' })
    const sooner = memo({ review_at: '2026-10-01T08:00:00Z' })
    const noReviewNew = memo({ created_at: '2026-09-09T00:00:00Z' })
    const groups = groupMemos([noReviewNew, later, noReviewOld, sooner])
    expect(groups.notes.map(item => item.id)).toEqual([sooner.id, later.id, noReviewOld.id, noReviewNew.id])
  })

  it('breaks review-time ties by creation order and id for stability', () => {
    const reviewAt = '2026-10-01T08:00:00Z'
    const older = memo({ review_at: reviewAt, created_at: '2026-09-01T00:00:00Z', id: 'b' })
    const newer = memo({ review_at: reviewAt, created_at: '2026-09-02T00:00:00Z', id: 'a' })
    expect(groupMemos([newer, older]).notes.map(item => item.id)).toEqual(['b', 'a'])
    const sameCreated = memo({ review_at: reviewAt, created_at: '2026-09-01T00:00:00Z', id: 'a' })
    expect(groupMemos([older, sameCreated]).notes.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('orders archived rows newest first and ignores their cleared review times', () => {
    const old = memo({ status: 'archived', created_at: '2026-09-01T00:00:00Z' })
    const recent = memo({ status: 'archived', created_at: '2026-09-05T00:00:00Z' })
    const groups = groupMemos([old, recent])
    expect(groups.archived.map(item => item.id)).toEqual([recent.id, old.id])
    expect(groups.goals).toEqual([])
    expect(groups.notes).toEqual([])
  })

  it('treats an unparseable review time as absent rather than crashing', () => {
    const broken = memo({ review_at: 'not-a-date' })
    const scheduled = memo({ review_at: '2026-10-01T08:00:00Z' })
    const groups = groupMemos([broken, scheduled])
    expect(groups.notes.map(item => item.id)).toEqual([scheduled.id, broken.id])
  })

  it('handles an empty list', () => {
    expect(groupMemos([])).toEqual({ goals: [], notes: [], archived: [] })
  })
})
