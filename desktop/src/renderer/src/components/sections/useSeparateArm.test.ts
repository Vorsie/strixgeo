// The Separate arm's automatic-retire lifecycle (debt #278 R5).
//
// The load-bearing pin is SA1, the review BLOCKER: once the body menu (and thus
// ``onSeparatePick``) reaches BOTH the litho and geotech axes (piece B), an arm
// that survived an axis switch would commit a cross-axis pick against the wrong
// model (backend 422 → phantom "Failed to separate"). So the arm must drop on
// ANY axis change — including geotech → litho, which the old
// ``axisMode !== 'lithostratigraphic'`` guard did NOT clear.
//
// SA1  arm on geotech → switch to litho → arm cleared (no stale pick possible).
// SA1b a re-render that does NOT change the axis keeps the arm.
// SA2  correlate mode taking over clears the arm.
// SA3  the arm drops when its anchor layer vanishes, and survives while it lasts.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useSeparateArm } from './useSeparateArm'

const ARM = { bodyId: 'gb-0', anchorLayerId: 'L1', label: 'ZAND #2' } as const
const MAP = new Map<string, string | null>([['L1', 'gb-0']])

describe('useSeparateArm — the arm retires on axis / correlate / stale anchor', () => {
  it('SA1 — an arm set on the geotech axis is cleared by a switch to litho', () => {
    const { result, rerender } = renderHook(
      ({ axisMode }: { axisMode: 'geotechnical' | 'lithostratigraphic' }) =>
        useSeparateArm({ axisMode, correlateMode: false, armBodyIdByLayerId: MAP }),
      { initialProps: { axisMode: 'geotechnical' as 'geotechnical' | 'lithostratigraphic' } },
    )
    act(() => result.current.setSeparateArm({ ...ARM }))
    expect(result.current.separateArm).not.toBeNull()

    rerender({ axisMode: 'lithostratigraphic' })
    // No stale cross-axis pick can commit: the arm is gone.
    expect(result.current.separateArm).toBeNull()
  })

  it('SA1b — a re-render that does not change the axis keeps the arm', () => {
    const { result, rerender } = renderHook(
      ({ axisMode }: { axisMode: 'geotechnical' | 'lithostratigraphic' }) =>
        useSeparateArm({ axisMode, correlateMode: false, armBodyIdByLayerId: MAP }),
      { initialProps: { axisMode: 'geotechnical' as 'geotechnical' | 'lithostratigraphic' } },
    )
    act(() => result.current.setSeparateArm({ ...ARM }))
    rerender({ axisMode: 'geotechnical' })
    expect(result.current.separateArm).not.toBeNull()
  })

  it('SA2 — correlate mode taking over clears the arm', () => {
    const { result, rerender } = renderHook(
      ({ correlateMode }: { correlateMode: boolean }) =>
        useSeparateArm({ axisMode: 'geotechnical', correlateMode, armBodyIdByLayerId: MAP }),
      { initialProps: { correlateMode: false } },
    )
    act(() => result.current.setSeparateArm({ ...ARM }))
    expect(result.current.separateArm).not.toBeNull()

    rerender({ correlateMode: true })
    expect(result.current.separateArm).toBeNull()
  })

  it('SA3 — the arm survives while its anchor lasts and drops when it vanishes', () => {
    const { result, rerender } = renderHook(
      ({ armBodyIdByLayerId }: { armBodyIdByLayerId: ReadonlyMap<string, string | null> }) =>
        useSeparateArm({ axisMode: 'geotechnical', correlateMode: false, armBodyIdByLayerId }),
      { initialProps: { armBodyIdByLayerId: MAP as ReadonlyMap<string, string | null> } },
    )
    act(() => result.current.setSeparateArm({ ...ARM }))

    // A new map that STILL carries the anchor keeps a live arm (ordinary refetch).
    rerender({ armBodyIdByLayerId: new Map([['L1', 'gb-0'], ['L3', 'gb-2']]) })
    expect(result.current.separateArm).not.toBeNull()

    // A map without the anchor layer drops the now-stale arm.
    rerender({ armBodyIdByLayerId: new Map([['L2', 'gb-1']]) })
    expect(result.current.separateArm).toBeNull()
  })
})
