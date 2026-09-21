/**
 * PartitionFillOverlay.unsafeDrag.test.tsx — SESSION 80 owner UX "red handle and snapback".
 *
 * Component-level wiring of the S79 ``rejected-unsafe`` outcome into the live drag:
 *
 *   UD1  while a lens handle is dragged to a REJECTED (unsafe) position, THAT handle renders red
 *        (the dragged body's outcome is ``rejected-unsafe`` this frame).
 *   UD2  releasing at a rejected position does NOT call onSaveBoundary — the unsafe node is
 *        discarded and the handle snaps back to the last applied geometry.
 *   UD3  a SAFE (``applied``) drag keeps the normal handle colour AND persists via onSaveBoundary.
 *
 * The engine outcome is stubbed at the ACTIVE-SELECTOR boundary (``computeSectionFillActiveWithDiagnostics``)
 * so the test drives the exact ``overrideStatus`` the overlay reads per frame — the real-CS1 production
 * of that status is covered in ``unsafeDragUX.rules.test.ts`` (CS1_GATE=1). Both proven RED against the
 * pre-Session-80 overlay (no red-handle / no snap-back wiring existed).
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyBoundaryResponse } from '../../api/client'
import type { SectionRegion } from '../../utils/sectionPartition'
import * as engineSelect from '../../utils/partitionEngineSelect'
import PartitionFillOverlay, { type Props } from './PartitionFillOverlay'
import { REJECT_COLOR } from './unsafeDragUX'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// S98 unified handle: a lens edge now renders the ONE teal BOUNDARY_COLOR, not the
// retired amber LENS_COLOR. The rejected-drag frame still reddens to REJECT_COLOR.
const NORMAL_LENS_COLOR = '#38bdf8' // BOUNDARY_COLOR (sky-400) — the one unified handle colour

const colors = new Map([
  ['fSand', '#fbbf24'],
  ['fSilt', '#84cc16'],
])
const labels = new Map([
  ['fSand', 'Sa'],
  ['fSilt', 'Si'],
])

// Enclosed silt lens in a sand matrix on L; continuous sand on R (mirrors PFO7's lensLayers).
const lensLayers = [
  layer({ id: 'l1', investigationId: 'L', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 4 }),
  layer({ id: 'l2', investigationId: 'L', bodyId: 'silt', formationId: 'fSilt', depthTopM: 4, depthBaseM: 5 }),
  layer({ id: 'l3', investigationId: 'L', bodyId: 'sand', formationId: 'fSand', depthTopM: 5, depthBaseM: 10 }),
  layer({ id: 'r1', investigationId: 'R', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 10 }),
]

const transforms = {
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (100 - y) / 10,
}

const baseProps: Props = {
  lithoLayers: lensLayers,
  placedColumns: [column({ investigationId: 'L', along: 0, elevationM: 10 }), column({ investigationId: 'R', along: 100, elevationM: 10 })],
  formationColorById: colors,
  formationLabelById: labels,
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10,
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
  ...transforms,
}

/**
 * A silt LENS region on gap 0 (leftX=20, rightX=80) with a shapeable interior apex tip, so the
 * overlay renders a draggable ``silt`` handle.
 */
function siltLensRegion(): SectionRegion {
  return {
    gapIndex: 0,
    formationId: 'fSilt',
    bodyId: 'silt',
    kind: 'lens',
    polygon: [
      { fraction: 0, elevation: 5 },
      { fraction: 0.5, elevation: 4.5 },
      { fraction: 0, elevation: 4 },
    ],
  } as unknown as SectionRegion
}


/** A full-width sand band so the gap is a valid partition alongside the lens. */
function sandBandRegion(): SectionRegion {
  return {
    gapIndex: 0,
    formationId: 'fSand',
    bodyId: 'sand',
    kind: 'band',
    polygon: [
      { fraction: 0, elevation: 10 },
      { fraction: 1, elevation: 10 },
      { fraction: 1, elevation: 0 },
      { fraction: 0, elevation: 0 },
    ],
  } as unknown as SectionRegion
}

/**
 * Stub the active selector so an override present ⇒ the given ``overrideStatus``. Returns the same
 * regions either way (S79: a rejected frame renders the base fill), so the ONLY signal the overlay
 * has for red/snap-back is the status.
 */
function stubOutcome(status: 'applied' | 'rejected-unsafe'): void {
  vi.spyOn(engineSelect, 'computeSectionFillActiveWithDiagnostics').mockImplementation(
    (_cols, _edges, overrides) => ({
      regions: [sandBandRegion(), siltLensRegion()],
      conflicts: [],
      reviewFlags: [],
      overrideStatus: overrides && overrides.size > 0 ? status : 'unsupported',
    }),
  )
}

const boundariesWithNode = new Map([
  [
    'silt',
    {
      upper_nodes: [{ along_m: 50, elevation_m: 4.5 }],
      lower_nodes: [],
    } as unknown as BodyBoundaryResponse,
  ],
])

// The SAME silt body carries an upper AND a lower node → TWO handles on one body. BUG #1 (§87):
// the old body-level red rule reddened BOTH when only one is dragged. The exact-identity rule
// reddens only the dragged one.
const boundariesTwoHandles = new Map([
  [
    'silt',
    {
      upper_nodes: [{ along_m: 50, elevation_m: 4.5 }],
      lower_nodes: [{ along_m: 50, elevation_m: 4.2 }],
    } as unknown as BodyBoundaryResponse,
  ],
])

function renderOverlay(props: Partial<Props>): ReturnType<typeof render> {
  return render(
    <svg>
      <PartitionFillOverlay {...baseProps} {...props} />
    </svg>,
  )
}

describe('PartitionFillOverlay — unsafe-drag red handle + snap-back (owner S80)', () => {
  it('UD1 — dragging a lens handle to a rejected-unsafe position turns THAT handle red', () => {
    stubOutcome('rejected-unsafe')
    const { getByTestId } = renderOverlay({
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: boundariesWithNode,
    })
    const handle = getByTestId('partition-lens-handle-silt-upper-0')
    // Before the drag: normal amber.
    expect(handle.getAttribute('fill')).toBe(NORMAL_LENS_COLOR)
    // Grab + drag to an unsafe reach (the stub reports rejected-unsafe once an override exists).
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 78, clientY: 45 }))
    })
    // The dragged handle is now red.
    expect(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('fill')).toBe(REJECT_COLOR)
  })

  it('UD2 — releasing at a rejected-unsafe position does NOT persist (snap back)', () => {
    stubOutcome('rejected-unsafe')
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      onSaveBoundary,
      boundariesByBodyId: boundariesWithNode,
    })
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 78, clientY: 45 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // Snap back: the unsafe node was discarded, the safe geometry stands unchanged.
    expect(onSaveBoundary).not.toHaveBeenCalled()
  })

  it('UD4 — a rejected lens drag reddens ONLY the dragged node, not a sibling handle of the same body (§87 BUG #1)', () => {
    stubOutcome('rejected-unsafe')
    const { getByTestId } = renderOverlay({
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: boundariesTwoHandles,
    })
    const upper = getByTestId('partition-lens-handle-silt-upper-0')
    const lower = getByTestId('partition-lens-handle-silt-lower-0')
    // Both amber before the drag.
    expect(upper.getAttribute('fill')).toBe(NORMAL_LENS_COLOR)
    expect(lower.getAttribute('fill')).toBe(NORMAL_LENS_COLOR)
    // Drag the UPPER node into a rejection.
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 78, clientY: 45 }))
    })
    // The dragged (upper) handle is red; the SIBLING (lower) handle of the SAME body stays amber.
    expect(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('fill')).toBe(REJECT_COLOR)
    expect(getByTestId('partition-lens-handle-silt-lower-0').getAttribute('fill')).toBe(NORMAL_LENS_COLOR)
  })

  it('UD3 — a SAFE (applied) drag keeps the normal handle colour AND persists', () => {
    stubOutcome('applied')
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      onSaveBoundary,
      boundariesByBodyId: boundariesWithNode,
    })
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 55, clientY: 45 }))
    })
    // Safe drag → the handle stays amber (never red).
    expect(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('fill')).toBe(NORMAL_LENS_COLOR)
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // And it persists normally (unchanged from today).
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
  })
})
