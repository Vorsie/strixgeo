// "Zoom exactly on cursor" — the behavioural net for ``useSectionWheelZoom``.
//
// Owner (2026-08-15): "when i zoom in and out the camera slowly moves left on
// the section?? doesn't it get alongM or something to make sure i zoom exactly
// on cursor?"
//
// These drive the hook through REAL wheel steps and rebuild the column layout
// between them the way the panel does, so what they assert is what the engineer
// sees on the canvas: the thing under the mouse stays under the mouse, and
// wheeling in and back out lands the camera where it started.
//
// Lives apart from ``useSectionCanvasGestures.test.ts`` (which pins the Esc
// cascade + the wheel's plumbing) because the scene harness below is a file's
// worth of setup on its own.

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'

import { useSectionWheelZoom } from './useSectionCanvasGestures'
import type { SectionWheelLayoutState } from './useSectionCanvasGestures'
import { cptBandHalfWidth, type CptChannels } from './cptChannels'
import { warpedAlongToScreenX, warpedScreenXToAlong, type WarpAnchor } from './sectionWarp'
import { COLUMN_EDGE_GAP_PX, MARGIN } from './utils'
import type { PlacedColumn, Viewport } from './utils'
import { layoutColumnsHorizontally, zoomLayoutColumn } from './wheelZoomAnchor'

const PLOT_W = 800
const PLOT_H = 300
/** A section whose middle two tests sit close enough to trigger the nudge. */
const SCENE: { id: string; kind: 'cpt' | 'borehole'; along: number }[] = [
  { id: 'c1', kind: 'cpt', along: 10 },
  { id: 'b1', kind: 'borehole', along: 22 },
  { id: 'c2', kind: 'cpt', along: 24 },
  { id: 'c3', kind: 'cpt', along: 70 },
]
// Every column draws a data band, so each claims 2 × the band half-width on top
// of its bare glyph — the footprint that GROWS as the wheel zooms in, which is
// what made the old one-shot approximation drift.
const SPECS = SCENE.map(c => zoomLayoutColumn(c.id, c.along, 2, false, 0))
const CHANNELS: CptChannels = { qc: true, rf: false, fs: false, u2: false, qTotal: false }
const START: Viewport = { xMin: 0, xMax: 100, levelMin: -30, levelMax: 10 }

interface SceneLayout {
  scaleH: number
  anchors: WarpAnchor[]
  placedColumns: PlacedColumn[]
}

/** Lay the scene out at a viewport, exactly as SectionPanel does. */
function sceneLayout(vp: Viewport, spacing: number): SceneLayout {
  const scaleH = PLOT_W / (vp.xMax - vp.xMin)
  const placements = layoutColumnsHorizontally({
    columns: SPECS,
    xMin: vp.xMin,
    scaleH,
    bandHalfWidth: cptBandHalfWidth(scaleH),
    columnSpacing: spacing,
    marginLeft: MARGIN.left,
    edgeGapPx: COLUMN_EDGE_GAP_PX,
  })
  const byId = new Map(SCENE.map(c => [c.id, c]))
  const placedColumns = placements.map(p => {
    const src = byId.get(p.id) as (typeof SCENE)[number]
    return {
      kind: src.kind,
      proj: { item: { id: src.id, cpt_type: 'CPTU' }, along: p.along, offset: 0 },
      trueX: p.trueX,
      nudgedX: p.nudgedX,
      width: p.width,
      displaced: p.displaced,
    }
  }) as unknown as PlacedColumn[]
  const anchors = placements
    .map(p => ({ along: p.along, effX: p.nudgedX }))
    .sort((a, b) => a.along - b.along)
  return { scaleH, anchors, placedColumns }
}

interface ZoomHarness {
  /** Wheel once at ``cursorPx`` and return the resulting viewport. */
  step: (deltaY: number, cursorPx: number) => Viewport
  /** The layout currently on screen. */
  layout: () => SceneLayout
  viewport: () => Viewport
}

function renderZoomHarness(spacing: number): ZoomHarness {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: PLOT_W,
      bottom: PLOT_H,
      width: PLOT_W,
      height: PLOT_H,
      x: 0,
      y: 0,
    }) as DOMRect
  const container = document.createElement('div')
  container.appendChild(svg)
  document.body.appendChild(container)

  const containerRef = { current: container } as RefObject<HTMLDivElement>
  const warpAnchorsRef = { current: [] } as MutableRefObject<WarpAnchor[]>
  const columnSpacingRef = { current: spacing } as MutableRefObject<number>
  const layoutStateRef = { current: null } as MutableRefObject<SectionWheelLayoutState | null>

  let viewport = START
  let layout = sceneLayout(viewport, spacing)
  let captured: Viewport | null = null
  const setViewport = vi.fn((v: Viewport) => {
    captured = v
  }) as unknown as Dispatch<SetStateAction<Viewport>>

  function props(vp: Viewport): Parameters<typeof useSectionWheelZoom>[0] {
    layout = sceneLayout(vp, spacing)
    warpAnchorsRef.current = layout.anchors
    layoutStateRef.current = {
      placedColumns: layout.placedColumns,
      cptPlots: new Map(SCENE.filter(c => c.kind === 'cpt').map(c => [c.id, {}])) as never,
      boreholeDetails: new Map(
        SCENE.filter(c => c.kind === 'borehole').map(c => [c.id, {}]),
      ) as never,
      cptChannels: CHANNELS,
      enabledBhChannels: 1,
      ghostFootprintForLayout: 0,
      lithoGhostAnchorIds: new Set<string>(),
    }
    return {
      containerRef,
      warpAnchorsRef,
      columnSpacingRef,
      layoutStateRef,
      viewport: vp,
      scaleH: layout.scaleH,
      scaleV: PLOT_H / (vp.levelMax - vp.levelMin),
      effLevelMax: vp.levelMax,
      plotWidth: PLOT_W,
      plotHeight: PLOT_H,
      setViewport,
    }
  }

  const { rerender } = renderHook(p => useSectionWheelZoom(p), { initialProps: props(viewport) })

  return {
    step(deltaY, cursorPx) {
      captured = null
      act(() => {
        container.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY,
            clientX: cursorPx,
            clientY: MARGIN.top + PLOT_H / 2,
            cancelable: true,
            bubbles: true,
          }),
        )
      })
      if (captured === null) throw new Error('the wheel step produced no viewport')
      viewport = captured
      rerender(props(viewport))
      return viewport
    },
    layout: () => layout,
    viewport: () => viewport,
  }
}

/** A cursor pixel that sits BETWEEN two tests, not on one. */
function betweenTestsPx(anchors: readonly WarpAnchor[]): number {
  return (anchors[1].effX + anchors[2].effX) / 2
}

/** Where a given along-distance is drawn, in the layout now on screen. */
function drawnAt(along: number, layout: SceneLayout, vp: Viewport): number {
  return warpedAlongToScreenX(
    along,
    layout.anchors,
    layout.scaleH,
    MARGIN.left + (along - vp.xMin) * layout.scaleH,
  )
}

describe('useSectionWheelZoom — the point under the cursor stays under the cursor', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  // Owner: "doesn't it get alongM or something to make sure i zoom exactly on
  // cursor?" — the point the mouse is pointing at must not move on screen,
  // whether the mouse is on a test or in the gap between two.
  for (const spacing of [0, 0.5, 1]) {
    for (const [direction, deltaY] of [
      ['in', -100],
      ['out', 100],
    ] as const) {
      it(`CZ1 (spacing ${spacing}, zoom ${direction}): the point under the cursor keeps its pixel`, () => {
        const h = renderZoomHarness(spacing)
        const before = h.layout()
        const cursorPx = betweenTestsPx(before.anchors)
        const pointed = warpedScreenXToAlong(
          cursorPx,
          before.anchors,
          before.scaleH,
          START.xMin + (cursorPx - MARGIN.left) / before.scaleH,
        )

        h.step(deltaY, cursorPx)

        expect(Math.abs(drawnAt(pointed, h.layout(), h.viewport()) - cursorPx)).toBeLessThan(1)
      })
    }
  }

  // Owner: "when i zoom in and out the camera slowly moves left on the
  // section??" — wheeling in five notches and back out five notches with the
  // mouse held still must land the camera exactly where it started.
  for (const spacing of [0, 0.5, 1]) {
    it(`CZ2 (spacing ${spacing}): five notches in and five back out return the camera to where it started`, () => {
      const h = renderZoomHarness(spacing)
      const cursorPx = betweenTestsPx(h.layout().anchors)

      for (let i = 0; i < 5; i += 1) h.step(-100, cursorPx)
      for (let i = 0; i < 5; i += 1) h.step(100, cursorPx)

      const vp = h.viewport()
      expect(Math.abs(vp.xMin - START.xMin)).toBeLessThan(1e-6)
      expect(Math.abs(vp.xMax - START.xMax)).toBeLessThan(1e-6)
    })
  }

  it('CZ3: with the cursor exactly on a test, that test keeps its pixel (the case that already worked)', () => {
    const h = renderZoomHarness(0.5)
    const target = h.layout().anchors[3]

    h.step(-100, target.effX)

    const moved = h.layout().anchors.find(a => a.along === target.along) as WarpAnchor
    expect(Math.abs(moved.effX - target.effX)).toBeLessThan(1)
  })

  it('CZ4: a section with no projected tests still anchors on the cursor (the linear case)', () => {
    // No anchors and no layout state — the map degenerates to the plain linear
    // one, and the world point under the cursor must still hold.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: PLOT_W,
        bottom: PLOT_H,
        width: PLOT_W,
        height: PLOT_H,
        x: 0,
        y: 0,
      }) as DOMRect
    const container = document.createElement('div')
    container.appendChild(svg)
    document.body.appendChild(container)
    let captured: Viewport | null = null
    const setViewport = vi.fn((v: Viewport) => {
      captured = v
    }) as unknown as Dispatch<SetStateAction<Viewport>>
    const scaleH = PLOT_W / (START.xMax - START.xMin)
    renderHook(() =>
      useSectionWheelZoom({
        containerRef: { current: container } as RefObject<HTMLDivElement>,
        warpAnchorsRef: { current: [] } as MutableRefObject<WarpAnchor[]>,
        columnSpacingRef: { current: 1 } as MutableRefObject<number>,
        layoutStateRef: { current: null },
        viewport: START,
        scaleH,
        scaleV: PLOT_H / (START.levelMax - START.levelMin),
        effLevelMax: START.levelMax,
        plotWidth: PLOT_W,
        plotHeight: PLOT_H,
        setViewport,
      }),
    )
    const cursorPx = MARGIN.left + 250
    const pointed = START.xMin + (cursorPx - MARGIN.left) / scaleH
    act(() => {
      container.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          clientX: cursorPx,
          clientY: MARGIN.top + PLOT_H / 2,
          cancelable: true,
          bubbles: true,
        }),
      )
    })

    const vp = captured as Viewport | null
    expect(vp).not.toBeNull()
    const newScaleH = PLOT_W / ((vp as Viewport).xMax - (vp as Viewport).xMin)
    const pxAfter = MARGIN.left + (pointed - (vp as Viewport).xMin) * newScaleH
    expect(Math.abs(pxAfter - cursorPx)).toBeLessThan(1)
  })
})
