// The pair arm's automatic-retire lifecycle (debt #278). After the body-verb
// simplification (owner 2026-09-01) the arm carries no ``kind`` — it is always
// the Join arm.
//
// The load-bearing pin is SA1, the review BLOCKER: once the pick reaches more than
// one axis, an arm that survived an axis switch would commit a cross-axis pick
// against the wrong model (backend 422 → phantom "Failed to …"). So the arm must
// drop on ANY axis change — including geotech → litho.
//
// SA1  arm on geotech → switch to litho → arm cleared (no stale pick possible).
// SA1b a re-render that does NOT change the axis keeps the arm.
// SA2  correlate mode taking over clears the arm.
// SA3  the arm drops when its anchor layer vanishes, and survives while it lasts.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePairArm } from './usePairArm'

const ARM = { bodyId: 'gb-0', anchorLayerId: 'L1', label: 'ZAND #2' }
const JOIN_ARM = { bodyId: 'gb-1', anchorLayerId: 'L3', label: 'ZAND #5' }
const MAP = new Map<string, string | null>([['L1', 'gb-0'], ['L3', 'gb-1']])

describe('usePairArm — the arm retires on axis / correlate / stale anchor', () => {
  it('SA1 — an arm set on the geotech axis is cleared by a switch to litho', () => {
    const { result, rerender } = renderHook(
      ({ axisMode }: { axisMode: 'geotechnical' | 'lithostratigraphic' }) =>
        usePairArm({ axisMode, correlateMode: false, armBodyIdByLayerId: MAP }),
      { initialProps: { axisMode: 'geotechnical' as 'geotechnical' | 'lithostratigraphic' } },
    )
    act(() => result.current.setPairArm({ ...ARM }))
    expect(result.current.pairArm).not.toBeNull()

    rerender({ axisMode: 'lithostratigraphic' })
    // No stale cross-axis pick can commit: the arm is gone.
    expect(result.current.pairArm).toBeNull()
  })

  it('SA1b — a re-render that does not change the axis keeps the arm', () => {
    const { result, rerender } = renderHook(
      ({ axisMode }: { axisMode: 'geotechnical' | 'lithostratigraphic' }) =>
        usePairArm({ axisMode, correlateMode: false, armBodyIdByLayerId: MAP }),
      { initialProps: { axisMode: 'geotechnical' as 'geotechnical' | 'lithostratigraphic' } },
    )
    act(() => result.current.setPairArm({ ...JOIN_ARM }))
    rerender({ axisMode: 'geotechnical' })
    expect(result.current.pairArm).not.toBeNull()
  })

  it('SA2 — correlate mode taking over clears the arm', () => {
    const { result, rerender } = renderHook(
      ({ correlateMode }: { correlateMode: boolean }) =>
        usePairArm({ axisMode: 'geotechnical', correlateMode, armBodyIdByLayerId: MAP }),
      { initialProps: { correlateMode: false } },
    )
    act(() => result.current.setPairArm({ ...ARM }))
    expect(result.current.pairArm).not.toBeNull()

    rerender({ correlateMode: true })
    expect(result.current.pairArm).toBeNull()
  })

  it('SA3 — the arm survives while its anchor lasts and drops when it vanishes', () => {
    const { result, rerender } = renderHook(
      ({ armBodyIdByLayerId }: { armBodyIdByLayerId: ReadonlyMap<string, string | null> }) =>
        usePairArm({ axisMode: 'geotechnical', correlateMode: false, armBodyIdByLayerId }),
      { initialProps: { armBodyIdByLayerId: MAP as ReadonlyMap<string, string | null> } },
    )
    act(() => result.current.setPairArm({ ...ARM }))

    // A new map that STILL carries the anchor keeps a live arm (ordinary refetch).
    rerender({ armBodyIdByLayerId: new Map([['L1', 'gb-0'], ['L9', 'gb-2']]) })
    expect(result.current.pairArm).not.toBeNull()

    // A map without the anchor layer drops the now-stale arm.
    rerender({ armBodyIdByLayerId: new Map([['L2', 'gb-1']]) })
    expect(result.current.pairArm).toBeNull()
  })

  it('SA4 — arming a new body replaces a live arm (one arm at a time)', () => {
    const { result } = renderHook(() =>
      usePairArm({ axisMode: 'geotechnical', correlateMode: false, armBodyIdByLayerId: MAP }),
    )
    act(() => result.current.setPairArm({ ...ARM }))
    expect(result.current.pairArm?.bodyId).toBe('gb-0')

    // Arming a second body supersedes the first — only one arm ever lives.
    act(() => result.current.setPairArm({ ...JOIN_ARM }))
    expect(result.current.pairArm?.bodyId).toBe('gb-1')
  })
})
