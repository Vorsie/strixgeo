/**
 * useSessionReviewFlagDismissals — a dismissal belongs to the section it was made on.
 *
 * "Keep separate" is the engineer saying: leave THESE two neighbours uncorrelated, on
 * THIS section. Flag ids are ``layerId|gapIndex|side``, and sections share
 * investigations, so the very same id names a real, undecided flag on another section.
 * Carrying a dismissal across the switch would hide a flag the engineer never saw and
 * would write the first section's decisions into the second section's saved project.
 */

import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useSessionReviewFlagDismissals } from './useSessionReviewFlagDismissals'

describe('useSessionReviewFlagDismissals', () => {
  // The whole reason the session set exists: the section row only catches up after
  // its PATCH returns, so a second click inside one round-trip must still see the first.
  it('keeps both dismissals when the second click beats the first PATCH home', () => {
    const { result } = renderHook(() => useSessionReviewFlagDismissals('sec-A', null))

    act(() => {
      result.current.dismiss('L1|0|left')
    })
    let second = new Set<string>()
    act(() => {
      // The row has NOT caught up — viewState is still null.
      second = result.current.dismiss('L2|1|right')
    })

    expect([...second].sort()).toEqual(['L1|0|left', 'L2|1|right'])
    expect([...result.current.dismissed].sort()).toEqual(['L1|0|left', 'L2|1|right'])
  })

  it('a dismissal made on one section is not carried onto the next section', () => {
    const { result, rerender } = renderHook(
      ({ id, vs }: { id: string; vs: Record<string, unknown> | null }) =>
        useSessionReviewFlagDismissals(id, vs),
      { initialProps: { id: 'sec-A', vs: null as Record<string, unknown> | null } },
    )

    act(() => {
      result.current.dismiss('L1|0|left')
    })
    expect([...result.current.dismissed]).toEqual(['L1|0|left'])

    // The engineer switches to another section. It shares the investigation, so the
    // same flag id can name a real, undecided flag here — it must be offered again.
    rerender({ id: 'sec-B', vs: null })

    expect([...result.current.dismissed]).toEqual([])
  })

  it('a dismissal on the next section does not persist the previous section decisions', () => {
    const { result, rerender } = renderHook(
      ({ id, vs }: { id: string; vs: Record<string, unknown> | null }) =>
        useSessionReviewFlagDismissals(id, vs),
      { initialProps: { id: 'sec-A', vs: null as Record<string, unknown> | null } },
    )

    act(() => {
      result.current.dismiss('L1|0|left')
    })
    rerender({ id: 'sec-B', vs: null })

    let patched = new Set<string>()
    act(() => {
      patched = result.current.dismiss('L9|3|right')
    })

    // What gets written to section B's view_state — B's decision only.
    expect([...patched]).toEqual(['L9|3|right'])
  })

  it('coming back to a section reads its own persisted set', () => {
    const secA = { review_flags: { dismissed: ['L1|0|left'] } }
    const { result, rerender } = renderHook(
      ({ id, vs }: { id: string; vs: Record<string, unknown> | null }) =>
        useSessionReviewFlagDismissals(id, vs),
      { initialProps: { id: 'sec-B', vs: null as Record<string, unknown> | null } },
    )

    act(() => {
      result.current.dismiss('L9|3|right')
    })
    rerender({ id: 'sec-A', vs: secA })

    expect([...result.current.dismissed]).toEqual(['L1|0|left'])
  })
})
