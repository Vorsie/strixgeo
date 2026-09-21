// Unified litho-edge handle (owner-decided 2026-07-23, S98).
//
// The teal contact handle and the (retired) orange lens handle are ONE uniform
// grabbable litho-transition handle: same colour, same gesture. These cases
// paraphrase the owner's spec in the owner's words:
//
//   UH1  both a CONTACT edge and a LENS edge render a handle in the SAME colour
//        (the owner's teal "contact"); no handle is orange.
//   UH2  LEFT-mousedown on either edge's hit halo STARTS a drag (the marker
//        follows the cursor) — "left-click-drag reshapes on BOTH edges".
//   UH3  RIGHT-mousedown on an add-strip does NOT spawn a node — "right-click
//        must ONLY remove, never spawn" (the owner's bug: right-click made a marker).
//   UH4  RIGHT-click on a handle REMOVES that node (via the existing remove path).
//   UH5  a REJECTED drag leaves the handle at the LAST-GOOD position, not the
//        dragged one — "shape snaps back but the marker does not" (the desync).

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyBoundaryResponse } from '../../api/client'
import type { SectionRegion } from '../../utils/sectionPartition'
import * as engineSelect from '../../utils/partitionEngineSelect'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The ONE handle colour — teal (BOUNDARY_COLOR). No handle is amber (LENS_COLOR retired).
const HANDLE_COLOR = '#38bdf8'
const AMBER = '#f59e0b'

const colors = new Map([
  ['fSand', '#fbbf24'],
  ['fClay', '#6b7280'],
  ['fSilt', '#84cc16'],
])
const labels = new Map([
  ['fSand', 'Sa'],
  ['fClay', 'C'],
  ['fSilt', 'Si'],
])

// L: sand 0-4, silt-lens 4-5, sand 5-8, clay 8-10.  R: sand 0-7, clay 7-10.
// → a silt LENS edge AND a sand/clay CONTACT edge in the same section.
const mixedLayers = [
  layer({ id: 'm1', investigationId: 'L', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 4 }),
  layer({ id: 'm2', investigationId: 'L', bodyId: 'silt', formationId: 'fSilt', depthTopM: 4, depthBaseM: 5 }),
  layer({ id: 'm3', investigationId: 'L', bodyId: 'sand', formationId: 'fSand', depthTopM: 5, depthBaseM: 8 }),
  layer({ id: 'm4', investigationId: 'L', bodyId: 'clay', formationId: 'fClay', depthTopM: 8, depthBaseM: 10 }),
  layer({ id: 'm5', investigationId: 'R', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 7 }),
  layer({ id: 'm6', investigationId: 'R', bodyId: 'clay', formationId: 'fClay', depthTopM: 7, depthBaseM: 10 }),
]

const transforms = {
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (100 - y) / 10,
}

const base: Props = {
  lithoLayers: mixedLayers,
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

function renderOverlay(props: Partial<Props>): ReturnType<typeof render> {
  return render(
    <svg>
      <PartitionFillOverlay {...base} {...props} />
    </svg>,
  )
}

// A silt LENS region + a sand/clay CONTACT so BOTH surfaces render handles once
// nodes are stored. Stub the engine so the outcome status is deterministic.
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
function sandBandRegion(): SectionRegion {
  return {
    gapIndex: 0,
    formationId: 'fSand',
    bodyId: 'sand',
    kind: 'band',
    polygon: [
      { fraction: 0, elevation: 10 },
      { fraction: 1, elevation: 10 },
      { fraction: 1, elevation: 4 },
      { fraction: 0, elevation: 4 },
    ],
  } as unknown as SectionRegion
}
function clayBandRegion(): SectionRegion {
  return {
    gapIndex: 0,
    formationId: 'fClay',
    bodyId: 'clay',
    kind: 'band',
    polygon: [
      { fraction: 0, elevation: 4 },
      { fraction: 1, elevation: 4 },
      { fraction: 1, elevation: 0 },
      { fraction: 0, elevation: 0 },
    ],
  } as unknown as SectionRegion
}

/** Stub the active engine so an override present ⇒ the given status (base regions either way). */
function stubOutcome(status: 'applied' | 'rejected-unsafe' | 'rejected-collapse'): void {
  vi.spyOn(engineSelect, 'computeSectionFillActiveWithDiagnostics').mockImplementation(
    (_cols, _edges, overrides) =>
      ({
        regions: [sandBandRegion(), clayBandRegion(), siltLensRegion()],
        conflicts: [],
        overrideStatus: overrides && overrides.size > 0 ? status : 'unsupported',
      }) as never,
  )
}

// A stored lens upper-node AND a stored sand/clay contact node → both a lens
// handle and a contact handle render.
const boundaries = new Map<string, BodyBoundaryResponse>([
  ['silt', { upper_nodes: [{ along_m: 50, elevation_m: 4.5 }], lower_nodes: [] } as unknown as BodyBoundaryResponse],
  ['sand', { upper_nodes: [], lower_nodes: [{ along_m: 50, elevation_m: 2.0 }] } as unknown as BodyBoundaryResponse],
])

describe('unified litho-edge handle (S98)', () => {
  it('UH1 — a contact handle AND a lens handle render in the SAME colour; none is amber', () => {
    stubOutcome('applied')
    const { getByTestId } = renderOverlay({ onSaveBoundary: vi.fn(), boundariesByBodyId: boundaries })
    const lensHandle = getByTestId('partition-lens-handle-silt-upper-0')
    const contactHandle = getByTestId('partition-boundary-handle-sand-clay-0')
    expect(lensHandle.getAttribute('fill')).toBe(HANDLE_COLOR)
    expect(contactHandle.getAttribute('fill')).toBe(HANDLE_COLOR)
    // No handle is the retired amber.
    expect(lensHandle.getAttribute('fill')).not.toBe(AMBER)
    expect(contactHandle.getAttribute('fill')).not.toBe(AMBER)
  })

  it('UH2 — LEFT-mousedown on either edge starts a drag (marker follows the cursor)', () => {
    stubOutcome('applied')
    const { getByTestId } = renderOverlay({ onSaveBoundary: vi.fn(), boundariesByBodyId: boundaries })
    // Lens edge.
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'), { button: 0 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 44 }))
    })
    expect(Number(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('cx'))).toBeCloseTo(60, 3)
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // Contact edge.
    fireEvent.mouseDown(getByTestId('partition-boundary-hit-sand-clay-0'), { button: 0 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 62, clientY: 66 }))
    })
    expect(Number(getByTestId('partition-boundary-handle-sand-clay-0').getAttribute('cx'))).toBeCloseTo(62, 3)
  })

  it('UH3 — RIGHT-mousedown on an add-strip does NOT spawn a node (right-click only removes)', () => {
    stubOutcome('applied')
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({ onSaveBoundary, boundariesByBodyId: boundaries })
    // Right-button press on the lens add-strip: must NOT start a drag / persist a new node.
    fireEvent.mouseDown(getByTestId('partition-lens-addstrip-silt-upper'), { button: 2 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // Right-button press on the contact add-strip: same.
    fireEvent.mouseDown(getByTestId('partition-boundary-addstrip-sand-clay'), { button: 2 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // No new node spawned by either right-press.
    expect(onSaveBoundary).not.toHaveBeenCalled()
  })

  it('UH4 — RIGHT-click on a handle removes that node', () => {
    stubOutcome('applied')
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({ onSaveBoundary, boundariesByBodyId: boundaries })
    fireEvent.contextMenu(getByTestId('partition-lens-hit-silt-upper-0'))
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    // The silt lens upper_nodes is emptied (the one stored node removed).
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
    expect(onSaveBoundary.mock.calls[0][1]).toHaveLength(0)
  })

  it('UH5 — a REJECTED drag leaves the handle at the last-good position (snap-back follows the marker)', () => {
    stubOutcome('rejected-unsafe')
    const { getByTestId } = renderOverlay({ onSaveBoundary: vi.fn(), boundariesByBodyId: boundaries })
    const before = Number(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('cx'))
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'), { button: 0 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 72, clientY: 45 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    const after = Number(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('cx'))
    // The marker returned to the last-good position (not the dragged 72).
    expect(after).toBeCloseTo(before, 3)
  })
})
