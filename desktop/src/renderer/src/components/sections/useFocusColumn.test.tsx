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
//   * enterFocus centres the horizontal window on the column's
//     RENDERED screen-x (nudgedX converted back to world metres),
//     not on its raw projected along-distance — so columns nudged
//     rightward by the collision-avoidance pass snap correctly.

import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useFocusColumn } from './useFocusColumn'
import { VEX_MIN } from './utils'
import type { PlacedColumn, Viewport } from './utils'

const VIEWPORT: Viewport = { xMin: 0, xMax: 200, levelMin: -50, levelMax: 50 }

// plotLeft=0, scaleH=1.0 → nudgedX == world-x (identity mapping).
// All existing tests use this identity so the numeric expectations are
// unchanged; the conversion path is exercised by the new test at the end.
const PLOT_LEFT = 0
const SCALE_H = 1.0

function cptColumn(
  id: string,
  along: number,
  nudgedX: number,
  elevationM: number | null,
  maxDepthM: number | null,
): PlacedColumn {
  // Minimal shape — useFocusColumn reads kind, proj.along, nudgedX, and
  // proj.item.{id,elevation_m,max_depth_m}. Full CptListItem is far
  // larger; the cast keeps the test focused on the zoom maths.
  return {
    kind: 'cpt',
    nudgedX,
    proj: { along, item: { id, elevation_m: elevationM, max_depth_m: maxDepthM } },
  } as unknown as PlacedColumn
}

describe('useFocusColumn — auto-zoom fits the test depth', () => {
  it('solves VEX so the test span maps onto plotHeight', () => {
    const setViewport = vi.fn()
    const setVex = vi.fn()
    // col at along=80, nudgedX=80, plotLeft=0, scaleH=1 → world-x=80.
    const col = cptColumn('cpt-1', 80, 80, 10, 28)
    const { result } = renderHook(() =>
      // plotWidth 300, plotHeight 900: focusScaleH = 300/40 = 7.5,
      // vSpan = 28 + 2*2 = 32, scaleV = 900/32 = 28.125,
      // vex = 28.125 / 7.5 = 3.75.
      useFocusColumn([col], VIEWPORT, 1, 300, 900, PLOT_LEFT, SCALE_H, setViewport, setVex),
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
    // The fit is exact: plotHeight / (focusScaleH * vex) == vSpan.
    expect(900 / (7.5 * 3.75)).toBeCloseTo(32, 6)
  })

  it('clamps a too-small computed VEX up to VEX_MIN', () => {
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, 80, 10, 28)
    const { result } = renderHook(() =>
      // plotHeight 50 → scaleV 1.5625, vex 0.208 < VEX_MIN (0.5).
      useFocusColumn([col], VIEWPORT, 1, 300, 50, PLOT_LEFT, SCALE_H, vi.fn(), setVex),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })

    expect(setVex).toHaveBeenCalledWith(VEX_MIN)
  })

  it('falls back to VEX 1.0 + unchanged level window when elevation is null', () => {
    const setViewport = vi.fn()
    const setVex = vi.fn()
    const col = cptColumn('cpt-1', 80, 80, null, 28)
    const { result } = renderHook(() =>
      useFocusColumn([col], VIEWPORT, 1, 300, 900, PLOT_LEFT, SCALE_H, setViewport, setVex),
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
    const col = cptColumn('cpt-1', 80, 80, 10, 28)
    const { result } = renderHook(() =>
      useFocusColumn([col], VIEWPORT, 2.5, 300, 900, PLOT_LEFT, SCALE_H, setViewport, setVex),
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

  it('centres on nudgedX when column is displaced (not on raw proj.along)', () => {
    // Column projected at along=80 m, but nudged 30 px rightward to
    // nudgedX=110. With plotLeft=0, scaleH=1.0 → rendered world-x = 110.
    // The focus window must centre at 110 (not 80).
    const setViewport = vi.fn()
    const col = cptColumn('cpt-1', 80, 110, 10, 28)
    const { result } = renderHook(() =>
      useFocusColumn([col], VIEWPORT, 1, 300, 900, PLOT_LEFT, SCALE_H, setViewport, vi.fn()),
    )

    act(() => {
      result.current.enterFocus({ kind: 'cpt', id: 'cpt-1', name: 'CPT-1' })
    })

    const vp = setViewport.mock.calls[0][0] as Viewport
    // Rendered world-x = 0 + (110 - 0) / 1.0 = 110.
    expect(vp.xMin).toBe(90)   // 110 - FOCUS_X_HALF_WIDTH_M (20)
    expect(vp.xMax).toBe(130)  // 110 + FOCUS_X_HALF_WIDTH_M (20)
  })
})
