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

import type { BodyBoundaryResponse, LithoLayerResponse } from '../../api/client'
import type { SectionRegion } from '../../utils/sectionPartition'
import * as engineSelect from '../../utils/partitionEngineSelect'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import type { PlacedColumn } from './utils'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The ONE handle colour — teal (BOUNDARY_COLOR). No handle is amber (LENS_COLOR retired).
const HANDLE_COLOR = '#38bdf8'
const AMBER = '#f59e0b'

function layer(
  id: string,
  inv: string,
  bodyId: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'm1',
    formation_id: formationId,
    borehole_id: inv,
    cpt_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: 'x',
    updated_at: 'x',
  } as LithoLayerResponse
}

function column(inv: string, along: number, elev: number): PlacedColumn {
  return {
    kind: 'borehole',
    nudgedX: along,
    trueX: along,
    width: 40,
    displaced: false,
    proj: { along, offset: 0, item: { id: inv, elevation_m: elev } },
  } as unknown as PlacedColumn
}

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
  layer('m1', 'L', 'sand', 'fSand', 0, 4),
  layer('m2', 'L', 'silt', 'fSilt', 4, 5),
  layer('m3', 'L', 'sand', 'fSand', 5, 8),
  layer('m4', 'L', 'clay', 'fClay', 8, 10),
  layer('m5', 'R', 'sand', 'fSand', 0, 7),
  layer('m6', 'R', 'clay', 'fClay', 7, 10),
]

const transforms = {
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (100 - y) / 10,
}

const base: Props = {
  lithoLayers: mixedLayers,
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
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
