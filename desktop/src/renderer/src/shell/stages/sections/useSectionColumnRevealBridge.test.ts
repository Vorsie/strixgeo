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
 * CB5  a GAP is named by its two columns, and both travel — the panel then
 *      centres on the midpoint of the span it already computes. No column
 *      pulse: the finding is the ground BETWEEN the two, so marking either end
 *      would point at the wrong thing (owner dogfeed 2026-08-28, the build
 *      report's "Show me")
 * CB6  a pair that the panel is not drawing comes back named, not silently
 *      half-honoured
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

    sectionsRevealColumnCallback.current?.(['B12'])

    expect(seen).toEqual([{ investigationIds: ['B12'], flashColumnId: 'B12' }])
    expect(seen[0].flashEdgeId).toBeUndefined()
  })

  it('CB2 — the panel decides whether it was revealed, and that answer is passed straight up', () => {
    const reveal: SectionColumnRevealFn = () => ({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
    renderHook(() => useSectionColumnRevealBridge({ current: reveal }))

    expect(sectionsRevealColumnCallback.current?.(['B12'])).toEqual({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
  })

  it('CB3 — with no section panel mounted the visit reports it could not land', () => {
    renderHook(() => useSectionColumnRevealBridge({ current: null }))

    expect(sectionsRevealColumnCallback.current?.(['B12'])).toEqual({
      revealed: false,
      missingInvestigationIds: ['B12'],
    })
  })

  it('CB5 — a gap travels as its two columns, and gets no single-column pulse', () => {
    const seen: SectionColumnRevealRequest[] = []
    const reveal: SectionColumnRevealFn = req => {
      seen.push(req)
      return { revealed: true, missingInvestigationIds: [] }
    }
    renderHook(() => useSectionColumnRevealBridge({ current: reveal }))

    sectionsRevealColumnCallback.current?.(['S4', 'B6'])

    // Both ends go over, so ``resolveColumnReveal`` centres on the midpoint of
    // their span — which IS the gap between them. Neither end is flashed: the
    // finding is the ground between the two columns, not either column.
    expect(seen).toEqual([{ investigationIds: ['S4', 'B6'] }])
    expect(seen[0].flashColumnId).toBeUndefined()
    expect(seen[0].flashEdgeId).toBeUndefined()
  })

  it('CB6 — a pair the panel is not drawing comes back named', () => {
    const reveal: SectionColumnRevealFn = () => ({
      revealed: false,
      missingInvestigationIds: ['B6'],
    })
    renderHook(() => useSectionColumnRevealBridge({ current: reveal }))

    expect(sectionsRevealColumnCallback.current?.(['S4', 'B6'])).toEqual({
      revealed: false,
      missingInvestigationIds: ['B6'],
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
