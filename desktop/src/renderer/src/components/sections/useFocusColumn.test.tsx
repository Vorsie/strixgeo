// Contract for focus-mode auto-zoom (the "focus this test is zoom-
// insensitive" fix):
//
//   * The panel derives the vertical visible extent from
//     ``scaleH * vex``; levelMin/levelMax only set the centre. So
//     enterFocus must solve for the VEX that fits the test's metre
//     span onto plotHeight for the focused 40 m window — NOT just
//     set a tight level range and VEX 1.0.
//   * Centre lands on the test's vertical midpoint.
//   * Computed VEX is clamped to [VEX_MIN, VEX_MAX].
//   * No elevation datum → fall back to VEX 1.0, level window
//     unchanged (can't frame a depth we don't know).
//   * exitFocus restores the pre-focus viewport + VEX.

import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useFocusColumn } from './useFocusColumn'
import { VEX_MIN } from './utils'
import type { PlacedColumn, Viewport } from './utils'

const VIEWPORT: Viewport = { xMin: 0, xMax: 200, levelMin: -50, levelMax: 50 }

function cptColumn(
  id: string,
  along: number,
  elevationM: number | null,
  maxDepthM: number | null,
): PlacedColumn {
  // Minimal shape — useFocusColumn only reads kind, proj.along and
  // proj.item.{id,elevation_m,max_depth_m}. Full CptListItem is far
  // larger; the cast keeps the test focused on the zoom maths.
  return {
    kind: 'cpt',
    proj: { along, item: { id, elevation_m: elevationM, max_depth_m: maxDepthM } },
  } as unknown as PlacedColumn
}

describe('useFocusColumn — auto-zoom fits the test depth', () => {
  it('solves VEX so the test span maps onto plotHeight', () => {
    const setViewport = vi.fn()
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, 10, 28)
    const { result } = renderHook(() =>
      // plotWidth 300, plotHeight 900: scaleH = 300/40 = 7.5,
      // vSpan = 28 + 2*2 = 32, scaleV = 900/32 = 28.125,
      // vex = 28.125 / 7.5 = 3.75.
      useFocusColumn([col], VIEWPORT, 1, 300, 900, setViewport, setVex),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })

    expect(setVex).toHaveBeenCalledWith(3.75)
    const vp = setViewport.mock.calls[0][0] as Viewport
    expect(vp.xMin).toBe(60)
    expect(vp.xMax).toBe(100)
    // Centre = (levelMin+levelMax)/2 = elevation - dEff/2 = 10 - 14 = -4.
    expect((vp.levelMin + vp.levelMax) / 2).toBeCloseTo(-4, 6)
    // The fit is exact: plotHeight / (scaleH * vex) == vSpan.
    expect(900 / (7.5 * 3.75)).toBeCloseTo(32, 6)
  })

  it('clamps a too-small computed VEX up to VEX_MIN', () => {
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, 10, 28)
    const { result } = renderHook(() =>
      // plotHeight 50 → scaleV 1.5625, vex 0.208 < VEX_MIN (0.5).
      useFocusColumn([col], VIEWPORT, 1, 300, 50, vi.fn(), setVex),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })

    expect(setVex).toHaveBeenCalledWith(VEX_MIN)
  })

  it('falls back to VEX 1.0 + unchanged level window when elevation is null', () => {
    const setViewport = vi.fn()
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, null, 28)
    const { result } = renderHook(() =>
      useFocusColumn([col], VIEWPORT, 1, 300, 900, setViewport, setVex),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })

    expect(setVex).toHaveBeenCalledWith(1.0)
    const vp = setViewport.mock.calls[0][0] as Viewport
    expect(vp.levelMin).toBe(VIEWPORT.levelMin)
    expect(vp.levelMax).toBe(VIEWPORT.levelMax)
  })

  it('exitFocus restores the pre-focus viewport + VEX', () => {
    const setViewport = vi.fn()
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, 10, 28)
    const { result } = renderHook(() =>
      useFocusColumn([col], VIEWPORT, 2.5, 300, 900, setViewport, setVex),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })
    act(() => {
      result.current.exitFocus()
    })

    // Last setViewport / setVex calls restore the captured snapshot.
    expect(setViewport).toHaveBeenLastCalledWith(VIEWPORT)
    expect(setVex).toHaveBeenLastCalledWith(2.5)
  })
})
