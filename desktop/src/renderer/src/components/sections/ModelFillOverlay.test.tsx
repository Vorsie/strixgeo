// Unit tests for ModelFillOverlay — renders the solids-derived section fill.
//
// Two render modes:
//   Mode A  — column segments sampled from 3D body meshes (sampleSolidColumns).
//             Each test's sampled stack renders as a vertical STRIP at the test's
//             exact (x,y) — the ground-truth check at the data locations. Every
//             segment renders (no between-test interpolation, no ≥2-column rule).
//   Mode B  — closed ring polygons from a plane-slice (sliceSolidsAtPlane).
//
// Claims pinned:
//   MA1   Mode A, a segment renders one strip at the test's x with its colour.
//   MA2   Mode A, a body on only ONE column STILL renders (ground-truth check).
//   MA3   Mode A, same body on two columns → one strip PER column (no band).
//   MA4   Mode A, two stacked bodies at one column → two strips at that column.
//   MFO4  Mode B, one SectionPoly → one filled element with the poly's colour.
//   MFO4b Mode B, a body slicing into two loops → two filled elements (both keyed).
//   MFO5  All rendered elements carry pointer-events="none" / pointerEvents none.
//   MFO6  Empty / missing props → empty <g>, no crash.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import ModelFillOverlay from './ModelFillOverlay'
import type { ModelFillOverlayProps } from './ModelFillOverlay'
import type { SolidColumn, SectionPoly } from '../../utils/sectionFromSolids'

afterEach(() => cleanup())

// Identity-ish transforms: alongM → px (1 m = 1 px), elev → screen Y (-elev px)
// so positive ground elevation → negative Y (up on screen).
const alongMToScreenX = (m: number): number => m
const levelToScreen = (z: number): number => -z

function renderOverlay(props: Partial<ModelFillOverlayProps> = {}): ReturnType<typeof render> {
  return render(
    <svg>
      <ModelFillOverlay
        opacity={0.6}
        alongMToScreenX={alongMToScreenX}
        levelToScreen={levelToScreen}
        {...props}
      />
    </svg>,
  )
}

// ---------------------------------------------------------------------------
// Mode A helpers
// ---------------------------------------------------------------------------

function col(testId: string, alongM: number, segments: SolidColumn['segments']): SolidColumn {
  return { testId, alongM, segments }
}

function seg(bodyId: string, color: string, topElev: number, baseElev: number): SolidColumn['segments'][number] {
  return { bodyId, formationId: `f-${bodyId}`, color, topElev, baseElev }
}

// ---------------------------------------------------------------------------
// MFO1 — same body on two columns → ONE filled element
// ---------------------------------------------------------------------------

describe('Mode A', () => {
  it('MA1 a segment fills the WHOLE column at the test (layout-driven)', () => {
    const columns: SolidColumn[] = [col('T1', 100, [seg('b1', '#ff0000', 0, -4)])]
    // The column's rendered geometry (centre + width) comes from the section
    // layout so the model overlay sits exactly on the borehole's litho column.
    const { container } = renderOverlay({
      columns,
      columnLayoutByTestId: { T1: { centerX: 100, width: 40 } },
    })

    const fills = container.querySelectorAll('[data-testid="model-fill-b1"]')
    expect(fills).toHaveLength(1)

    const el = fills[0] as SVGRectElement
    expect(el.getAttribute('fill')).toBe('#ff0000')
    // Spans the full column width: x = centerX - width/2 = 80, width = 40.
    expect(Number(el.getAttribute('x'))).toBeCloseTo(80, 6)
    expect(Number(el.getAttribute('width'))).toBeCloseTo(40, 6)
    // Top at levelToScreen(0)=0, height = levelToScreen(-4)-0 = 4.
    expect(Number(el.getAttribute('y'))).toBeCloseTo(0, 6)
    expect(Number(el.getAttribute('height'))).toBeCloseTo(4, 6)

    const pe = el.getAttribute('pointer-events') ?? el.style.pointerEvents
    expect(pe).toBe('none')
  })

  it('MA1b falls back to a fixed-width strip at the test x when no layout is given', () => {
    const columns: SolidColumn[] = [col('T1', 100, [seg('b1', '#ff0000', 0, -4)])]
    const { container } = renderOverlay({ columns, testStripWidthPx: 16 })
    const el = container.querySelector('[data-testid="model-fill-b1"]') as SVGRectElement
    // Centred on alongMToScreenX(100)=100 with the fallback width 16.
    expect(Number(el.getAttribute('x'))).toBeCloseTo(92, 6)
    expect(Number(el.getAttribute('width'))).toBeCloseTo(16, 6)
  })

  // ---------------------------------------------------------------------------
  // MA2 — a body present on only ONE column STILL renders. This is the whole
  // point of the per-test mode: it shows the model's ground truth at each data
  // location, so a single-column body must NOT be dropped (the old ≥2-column
  // band rule is gone).
  // ---------------------------------------------------------------------------

  it('MA2 a body on only one column still renders (ground-truth check)', () => {
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -4), seg('b2', '#00ff00', -4, -8)]),
      col('T2', 100, [seg('b1', '#ff0000', 0, -4)]),
    ]
    const { container } = renderOverlay({ columns })

    // b2 appears on only T1 — it must still render exactly one strip.
    expect(container.querySelectorAll('[data-testid="model-fill-b2"]')).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // MA3 — the same body on two columns renders one strip PER column (the model
  // sampled at each test), NOT a single connecting band between them.
  // ---------------------------------------------------------------------------

  it('MA3 same body on two columns fills each whole column (no connecting band)', () => {
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -4)]),
      col('T2', 100, [seg('b1', '#ff0000', 0, -4)]),
    ]
    const { container } = renderOverlay({
      columns,
      columnLayoutByTestId: {
        T1: { centerX: 0, width: 20 },
        T2: { centerX: 100, width: 30 },
      },
    })

    const strips = container.querySelectorAll('[data-testid="model-fill-b1"]')
    expect(strips).toHaveLength(2)
    const widths = Array.from(strips)
      .map((s) => Number((s as SVGRectElement).getAttribute('width')))
      .sort((a, b) => a - b)
    // Each strip spans its own column's full width (20 and 30), not a band.
    expect(widths).toEqual([20, 30])
  })

  // ---------------------------------------------------------------------------
  // MA4 — two stacked bodies at one column render two strips at that column.
  // ---------------------------------------------------------------------------

  it('MA4 two stacked bodies at one column render two strips', () => {
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -2), seg('b2', '#0000ff', -2, -5)]),
    ]
    const { container } = renderOverlay({ columns })

    expect(container.querySelectorAll('[data-testid="model-fill-b1"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="model-fill-b2"]')).toHaveLength(1)
    expect(container.querySelectorAll('rect')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Mode B — plane-slice polygons
// ---------------------------------------------------------------------------

describe('Mode B', () => {
  it('MFO4 one SectionPoly renders one filled element with its colour', () => {
    const polys: SectionPoly[] = [
      {
        bodyId: 'p1',
        formationId: 'fP1',
        color: '#abcdef',
        points: [
          { alongM: 0, elev: 0 },
          { alongM: 100, elev: 0 },
          { alongM: 100, elev: -5 },
          { alongM: 0, elev: -5 },
        ],
      },
    ]
    const { container } = renderOverlay({ polys })

    const fills = container.querySelectorAll('[data-testid="model-fill-p1"]')
    expect(fills).toHaveLength(1)

    const el = fills[0] as SVGPathElement
    expect(el.getAttribute('fill')).toBe('#abcdef')

    const pe = el.getAttribute('pointer-events') ?? el.style.pointerEvents
    expect(pe).toBe('none')
  })

  it('MFO4b two loops of one body render two filled elements', () => {
    // sliceSolidsAtPlane returns one SectionPoly PER loop, so a body sliced into
    // two disjoint pieces arrives as two polys sharing a bodyId. Both must render
    // (unique React keys), not collapse to one.
    const ring = (a0: number, a1: number) => [
      { alongM: a0, elev: 0 },
      { alongM: a1, elev: 0 },
      { alongM: a1, elev: -5 },
      { alongM: a0, elev: -5 },
    ]
    const polys: SectionPoly[] = [
      { bodyId: 'p1', formationId: 'fP1', color: '#abcdef', points: ring(0, 10) },
      { bodyId: 'p1', formationId: 'fP1', color: '#abcdef', points: ring(20, 30) },
    ]
    const { container } = renderOverlay({ polys })
    expect(container.querySelectorAll('[data-testid="model-fill-p1"]')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// MFO5 — pointer-events none on all painted elements (shared requirement)
// ---------------------------------------------------------------------------

it('MFO5 all painted elements carry pointer-events none', () => {
  const columns: SolidColumn[] = [
    col('T1', 0, [seg('b1', '#ff0000', 0, -4)]),
    col('T2', 100, [seg('b1', '#ff0000', 0, -4)]),
  ]
  const { container } = renderOverlay({ columns })

  const painted = container.querySelectorAll('path, rect')
  expect(painted.length).toBeGreaterThan(0)
  for (const el of painted) {
    const pe = el.getAttribute('pointer-events') ?? (el as SVGElement).style.pointerEvents
    expect(pe).toBe('none')
  }
})

// ---------------------------------------------------------------------------
// MFO6 — no crash on empty / missing props
// ---------------------------------------------------------------------------

it('MFO6 empty props renders empty group without crashing', () => {
  const { container } = renderOverlay()
  // The root <g> must exist and have no child paths
  const g = container.querySelector('g')
  expect(g).toBeTruthy()
  expect(container.querySelectorAll('path, rect')).toHaveLength(0)
})
