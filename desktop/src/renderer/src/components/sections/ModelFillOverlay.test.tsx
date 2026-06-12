// Unit tests for ModelFillOverlay — renders the solids-derived section fill.
//
// Two render modes:
//   Mode A  — column segments sampled from 3D body meshes (sampleSolidColumns).
//             Adjacent columns' same-body segments are connected into band polygons.
//   Mode B  — closed ring polygons from a plane-slice (sliceSolidsAtPlane).
//
// Claims pinned:
//   MFO1  Mode A, same body present on two columns → one filled element per body.
//   MFO2  Mode A, two distinct bodies → two filled elements.
//   MFO3  Mode A, body on only ONE column → skipped (need ≥2 columns to span).
//   MFO4  Mode B, one SectionPoly → one filled element with the poly's colour.
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
  it('MFO1 same body on two columns renders exactly one filled element', () => {
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -4)]),
      col('T2', 100, [seg('b1', '#ff0000', 0, -4)]),
    ]
    const { container } = renderOverlay({ columns })

    // Exactly one element carrying data-testid="model-fill-b1"
    const fills = container.querySelectorAll('[data-testid="model-fill-b1"]')
    expect(fills).toHaveLength(1)

    // Fill colour must match
    const el = fills[0] as SVGPathElement
    expect(el.getAttribute('fill')).toBe('#ff0000')

    // pointer-events must be none
    const pe = el.getAttribute('pointer-events') ?? el.style.pointerEvents
    expect(pe).toBe('none')
  })

  // ---------------------------------------------------------------------------
  // MFO2 — two distinct bodies → two filled elements
  // ---------------------------------------------------------------------------

  it('MFO2 two bodies → two filled elements', () => {
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -2), seg('b2', '#0000ff', -2, -5)]),
      col('T2', 100, [seg('b1', '#ff0000', 0, -2), seg('b2', '#0000ff', -2, -5)]),
    ]
    const { container } = renderOverlay({ columns })

    expect(container.querySelectorAll('[data-testid="model-fill-b1"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="model-fill-b2"]')).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // MFO3 — body on only one column → skipped (needs ≥2 columns to span)
  // ---------------------------------------------------------------------------

  it('MFO3 body present on only one column is skipped', () => {
    // b1 appears on both columns, b2 only on T1
    const columns: SolidColumn[] = [
      col('T1', 0, [seg('b1', '#ff0000', 0, -4), seg('b2', '#00ff00', -4, -8)]),
      col('T2', 100, [seg('b1', '#ff0000', 0, -4)]),
    ]
    const { container } = renderOverlay({ columns })

    // b1 spans both → rendered
    expect(container.querySelectorAll('[data-testid="model-fill-b1"]')).toHaveLength(1)
    // b2 only on T1 → not rendered
    expect(container.querySelectorAll('[data-testid="model-fill-b2"]')).toHaveLength(0)
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

  const paths = container.querySelectorAll('path')
  for (const path of paths) {
    const pe = path.getAttribute('pointer-events') ?? path.style.pointerEvents
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
  expect(container.querySelectorAll('path')).toHaveLength(0)
})
