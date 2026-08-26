/**
 * The one-click visit, at the boundary it crosses.
 *
 * CB1  the bridge asks the panel for the named test, and for a COLUMN pulse —
 *      a deep-link from the Build pre-flight is about a test to subdivide, not
 *      about a tie, so flashing an edge would mark the wrong thing
 * CB2  the panel's own verdict is handed back untouched (the panel owns
 *      *whether*; the caller owns *why*)
 * CB3  no panel mounted → the visit reports "not revealed", it never throws
 * CB4  unmount clears the slot, so a stale canvas cannot answer for a live one
 */

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSectionColumnRevealBridge } from './useSectionColumnRevealBridge'
import { sectionsRevealColumnCallback } from './sectionColumnRevealBridge'
import type {
  SectionColumnRevealFn,
  SectionColumnRevealRequest,
} from '../../../components/sections/sectionColumnReveal'

afterEach(() => {
  sectionsRevealColumnCallback.current = null
  vi.clearAllMocks()
})

describe('useSectionColumnRevealBridge', () => {
  it('CB1 — the visit asks for the test itself, marked with a column pulse', () => {
    const seen: SectionColumnRevealRequest[] = []
    const reveal: SectionColumnRevealFn = req => {
      seen.push(req)
      return { revealed: true, missingInvestigationIds: [] }
    }
    renderHook(() => useSectionColumnRevealBridge({ current: reveal }))

    sectionsRevealColumnCallback.current?.('B12')

    expect(seen).toEqual([{ investigationIds: ['B12'], flashColumnId: 'B12' }])
    expect(seen[0].flashEdgeId).toBeUndefined()
  })

  it('CB2 — the panel decides whether it was revealed, and that answer is passed straight up', () => {
    const reveal: SectionColumnRevealFn = () => ({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
    renderHook(() => useSectionColumnRevealBridge({ current: reveal }))

    expect(sectionsRevealColumnCallback.current?.('B12')).toEqual({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
  })

  it('CB3 — with no section panel mounted the visit reports it could not land', () => {
    renderHook(() => useSectionColumnRevealBridge({ current: null }))

    expect(sectionsRevealColumnCallback.current?.('B12')).toEqual({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
  })

  it('CB4 — unmounting clears the slot', () => {
    const reveal: SectionColumnRevealFn = () => ({
      revealed: true,
      missingInvestigationIds: [],
    })
    const { unmount } = renderHook(() => useSectionColumnRevealBridge({ current: reveal }))
    expect(sectionsRevealColumnCallback.current).not.toBeNull()

    unmount()

    expect(sectionsRevealColumnCallback.current).toBeNull()
  })
})
