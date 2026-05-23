// Unit tests for CorrelationEdgesOverlay (Slice 4, #55).
//
// Claims pinned here:
//   CE1  No edges rendered when edges array is empty.
//   CE2  One edge between two columns renders: a line and a badge.
//   CE3  Badge shows "body N" when instance_ordinal is set on a formation.
//   CE4  Badge shows "?" (amber) when instance_ordinal is null.
//   CE5  Dangling edge suppressed: when only one formation's column is on
//        the section, the edge line is NOT rendered (both x1/x2 required).
//   CE6  True-spacing warning label renders when correlateMode is true
//        and adjacent columns are < 1 m apart (along distance).
//   CE7  Arm source: in correlate mode with no source armed, clicking a
//        band rect calls onArm with the correct formationId + investigationId.
//   CE8  Valid target: when source is armed, clicking a different column's
//        band rect calls onCorrelate(sourceFormationId, targetFormationId).
//   CE9  Esc on the document while correlationSource is armed calls onClearArmed
//        (tested indirectly — the Esc peel lives in SectionPanel.test).
//
// Note: the Esc peel order (L1=clearArmed, L2=exitMode) is tested in
//       SectionPanel because it lives in SectionPanel's keydown handler.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CorrelationEdgesOverlay from './CorrelationEdgesOverlay'
import type { CorrelateGestureState } from './CorrelationEdgesOverlay'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoCorrelationEdge,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import type { CptListItem } from '../../api/client'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeEdge(
  aId: string,
  bId: string,
  id = 'edge-1',
): LithoCorrelationEdge {
  return {
    id,
    formation_a_id: aId,
    formation_b_id: bId,
    source: 'manual_connect',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeFormation(
  id: string,
  name: string,
  ordinal: number | null = null,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#4ade80',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: ordinal,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeContact(
  id: string,
  formationId: string,
  investigationId: string,
  kind: 'cpt' | 'borehole',
  depthTopM: number,
): FormationContactResponse {
  return {
    id,
    model_id: 'model-1',
    formation_id: formationId,
    borehole_id: kind === 'borehole' ? investigationId : null,
    cpt_id: kind === 'cpt' ? investigationId : null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: depthTopM,
    source: 'manual_pick' as const,
    confidence: 'high' as const,
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCptListItem(id: string, elevationM: number): CptListItem {
  return {
    id,
    name: id,
    cpt_type: 'CPTM',
    location_x: 0,
    location_y: 0,
    elevation_m: elevationM,
    epsg: 31370,
    z_epsg: 5710,
    max_depth_m: 20,
    n_rows: 100,
    elevation_source: 'dem',
    start_date: null,
  }
}

function makeColumn(
  investigationId: string,
  nudgedX: number,
  elevationM: number,
  alongM = 10,
): PlacedColumn {
  return {
    kind: 'cpt',
    proj: {
      item: makeCptListItem(investigationId, elevationM),
      along: alongM,
      offset: 0,
    } as ProjectedInvestigation<CptListItem>,
    trueX: nudgedX,
    nudgedX,
    width: 40,
    displaced: false,
  }
}

/** Identity levelToScreen: level maps linearly to screen y (higher = smaller y) */
function makeLevelToScreen(surfaceLevel = 10, plotTop = 20, scale = 10) {
  // levelToScreen(level) = plotTop + (surfaceLevel - level) * scale
  return (level: number) => plotTop + (surfaceLevel - level) * scale
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderOverlay(
  props: Parameters<typeof CorrelationEdgesOverlay>[0],
): ReturnType<typeof render> {
  // Wrap in an SVG so SVG elements are valid DOM children
  return render(
    <svg>
      <CorrelationEdgesOverlay {...props} />
    </svg>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CorrelationEdgesOverlay', () => {
  it('CE1: renders nothing when edges array is empty', () => {
    const { container } = renderOverlay({
      edges: [],
      contacts: [],
      formations: [],
      placedColumns: [],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    const overlay = container.querySelector('[data-testid="correlation-edges-overlay"]')
    expect(overlay).not.toBeNull()
    // No line elements inside the overlay
    expect(overlay!.querySelectorAll('line')).toHaveLength(0)
  })

  // CE2 — debt #100: edges are hidden by default and revealed only on
  // chip hover. The chip surface is always-on; the connecting line is
  // off-by-default to kill the crisscrossing-spaghetti effect.
  it('CE2: edges are hidden by default; chip + edge-revealed surfaces are present per band', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const columns = [
      makeColumn('inv-1', 100, 10, 5),
      makeColumn('inv-2', 200, 10, 20),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(10, 20, 10),
      plotTop: 20,
      plotBottom: 200,
    })
    // Chips render on every band with a non-null ordinal.
    expect(screen.getByTestId('body-chip-inv-1-f-a')).not.toBeNull()
    expect(screen.getByTestId('body-chip-inv-2-f-b')).not.toBeNull()
    // No edge lines visible at rest (other than the drag-preview, which
    // is absent without a drag in flight).
    const overlay = container.querySelector('[data-testid="correlation-edges-overlay"]')!
    expect(overlay.querySelectorAll('line').length).toBe(0)
  })

  it('CE3: chip shows "#N" when instance_ordinal is set', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    // Two chips, both "#1" (same body).
    const chips = screen.getAllByText('#1')
    expect(chips.length).toBe(2)
  })

  it('CE4: no chip when instance_ordinal is null (pre-Resolve state)', () => {
    const fA = makeFormation('f-a', 'Zand', null) // ordinal null
    const fB = makeFormation('f-b', 'Klei', null)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    // No chip elements at all — the inspector's RO-3 stale-ordinal
    // amber indicator covers the "go run Resolve" nudge; per-band
    // amber "?" everywhere would be noisy.
    expect(container.querySelector('[data-testid^="body-chip-"]')).toBeNull()
  })

  it('CE5: dangling edge suppressed when only one formation has a column', () => {
    // f-b has no contact on any column → no line rendered
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    const overlay = container.querySelector('[data-testid="correlation-edges-overlay"]')!
    const lines = overlay.querySelectorAll('line')
    // No edge lines — no badge either
    expect(lines).toHaveLength(0)
    expect(screen.queryByText(/body/)).toBeNull()
  })

  it('CE6: true-spacing warning renders when correlateMode and adjacent columns are < 1 m apart', () => {
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    // Two columns 0.5 m apart (along = 5 and 5.5)
    const columns = [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 5.5)]
    renderOverlay({
      edges: [],
      contacts: [],
      formations: [],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    expect(screen.getByText(/true spacing.*< 1 m/i)).not.toBeNull()
  })

  it('CE7: clicking a band rect in correlate mode (no source) calls onArm', () => {
    const onArm = vi.fn()
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm,
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    // Find the arm click rect by data-testid
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.click(armRect)
    expect(onArm).toHaveBeenCalledWith(
      expect.objectContaining({ formationId: 'f-a', investigationId: 'inv-1' }),
    )
  })

  it('CE8: clicking valid target band rect calls onCorrelate', async () => {
    const onCorrelate = vi.fn().mockResolvedValue(undefined)
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: { formationId: 'f-a', investigationId: 'inv-1', label: 'Zand' },
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate,
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const fB = makeFormation('f-b', 'Klei', null)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const columns = [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA, fB],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    // Find the valid target rect for inv-2/f-b by data-testid
    const targetRect = screen.getByTestId('correlate-target-inv-2-f-b')
    fireEvent.click(targetRect)
    expect(onCorrelate).toHaveBeenCalledWith('f-a', 'f-b')
  })

  // -------------------------------------------------------------------
  // Drag-arm gesture (debt #78) — drag-inside-correlate-mode.
  // -------------------------------------------------------------------

  it('CE9: mousedown on un-armed band fires onArm and shows preview line', () => {
    const onArm = vi.fn()
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm,
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    const { container } = renderOverlay({
      edges: [],
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.mouseDown(armRect, { clientX: 100, clientY: 50, button: 0 })
    expect(onArm).toHaveBeenCalledWith(
      expect.objectContaining({ formationId: 'f-a', investigationId: 'inv-1' }),
    )
    // Preview line renders while drag is in flight.
    expect(container.querySelector('[data-testid="correlate-drag-preview"]')).not.toBeNull()
  })

  it('CE10: mouseup over another band fires onCorrelate with source + target ids', () => {
    const onCorrelate = vi.fn().mockResolvedValue(undefined)
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate,
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const fB = makeFormation('f-b', 'Zand', null) // same parent/litho → valid target
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const columns = [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA, fB],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.mouseDown(armRect, { clientX: 100, clientY: 50, button: 0 })
    // Stub elementsFromPoint to return a fake element carrying the
    // target band's data attrs. jsdom doesn't implement layout, so
    // the real call returns []; stubbing isolates the handler logic.
    const fakeTarget = document.createElement('div')
    fakeTarget.setAttribute('data-correlate-investigation-id', 'inv-2')
    fakeTarget.setAttribute('data-correlate-formation-id', 'f-b')
    const original = document.elementsFromPoint
    document.elementsFromPoint = vi.fn().mockReturnValue([fakeTarget as unknown as Element])
    fireEvent.mouseUp(document, { clientX: 200, clientY: 50 })
    expect(onCorrelate).toHaveBeenCalledWith('f-a', 'f-b')
    document.elementsFromPoint = original
  })

  it('CE11: mouseup over the same band does NOT fire onCorrelate', () => {
    const onCorrelate = vi.fn().mockResolvedValue(undefined)
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate,
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.mouseDown(armRect, { clientX: 100, clientY: 50, button: 0 })
    const sameTarget = document.createElement('div')
    sameTarget.setAttribute('data-correlate-investigation-id', 'inv-1')
    sameTarget.setAttribute('data-correlate-formation-id', 'f-a')
    const original = document.elementsFromPoint
    document.elementsFromPoint = vi.fn().mockReturnValue([sameTarget as unknown as Element])
    fireEvent.mouseUp(document, { clientX: 100, clientY: 50 })
    expect(onCorrelate).not.toHaveBeenCalled()
    document.elementsFromPoint = original
  })

  it('CE12: mouseup on empty space does NOT fire onCorrelate', () => {
    const onCorrelate = vi.fn().mockResolvedValue(undefined)
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate,
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.mouseDown(armRect, { clientX: 100, clientY: 50, button: 0 })
    const original = document.elementsFromPoint
    document.elementsFromPoint = vi.fn().mockReturnValue([])
    fireEvent.mouseUp(document, { clientX: 500, clientY: 500 })
    expect(onCorrelate).not.toHaveBeenCalled()
    document.elementsFromPoint = original
  })

  it('CE13: right-mousedown does NOT open a drag (button !== 0)', () => {
    const onArm = vi.fn()
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: null,
      onArm,
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    const fA = makeFormation('f-a', 'Zand', null)
    const contacts = [makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0)]
    const columns = [makeColumn('inv-1', 100, 10, 5)]
    const { container } = renderOverlay({
      edges: [],
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const armRect = screen.getByTestId('correlate-arm-inv-1-f-a')
    fireEvent.mouseDown(armRect, { clientX: 100, clientY: 50, button: 2 })
    expect(onArm).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="correlate-drag-preview"]')).toBeNull()
  })

  // -------------------------------------------------------------------
  // Context-menu admixture propagation (new items CE14–CE15)
  // -------------------------------------------------------------------

  // CE14 — debt #100: right-click on a body chip opens the body-level
  // context menu (replaces the right-click-on-edge-line surface, which
  // is now hidden by default + only the per-edge fallback).
  it('CE14: right-click body chip opens body context menu (edit admixtures + remove all)', () => {
    const fA = {
      ...makeFormation('f-a', 'Zand', 1),
      litho_main_soil_code: 'ZAND',
      litho_admixtures: [{ soil_code: 'KL', amount: 'M', locally: false }],
    }
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const gestureState: CorrelateGestureState = {
      correlateMode: false,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
      onPropagateAdmixtures: vi.fn(),
    }
    renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const chip = screen.getByTestId('body-chip-inv-1-f-a')
    fireEvent.contextMenu(chip)
    expect(screen.getByTestId('body-context-menu')).not.toBeNull()
    expect(screen.getByText(/Edit admixtures for this body/i)).not.toBeNull()
    expect(screen.getByText(/Remove all correlations for this body/i)).not.toBeNull()
  })

  it('CE15: chip menu "Edit admixtures for this body" opens the admixture editor', () => {
    const onPropagateAdmixtures = vi.fn().mockResolvedValue(undefined)
    const fA = {
      ...makeFormation('f-a', 'Zand', 1),
      litho_main_soil_code: 'ZAND',
      litho_admixtures: [] as Array<{ soil_code: string; amount: string; locally: boolean }>,
    }
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const gestureState: CorrelateGestureState = {
      correlateMode: false,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
      onPropagateAdmixtures,
    }
    renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    const chip = screen.getByTestId('body-chip-inv-1-f-a')
    fireEvent.contextMenu(chip)
    // Pick the menu BUTTON (there will be a duplicate text on the h2
    // after open — `selector: 'button'` disambiguates).
    fireEvent.click(screen.getByText(/Edit admixtures for this body/i, { selector: 'button' }))
    expect(screen.getByText(/Edit admixtures for this body/i, { selector: 'h2' })).not.toBeNull()
  })

  // -------------------------------------------------------------------
  // CE16–CE19 — debt #100: hover-to-reveal + body-level remove-all.
  // -------------------------------------------------------------------

  // CE16: hovering a chip whose ordinal is N reveals every edge whose
  // two endpoint formations both carry ordinal N. Other-body edges
  // stay hidden — that is the whole anti-spaghetti contract.
  it('CE16: hovering a chip reveals edges for that body only', () => {
    const fA1 = makeFormation('f-a1', 'Zand', 1)
    const fA2 = makeFormation('f-a2', 'Zand', 1) // same body
    const fB1 = makeFormation('f-b1', 'Klei', 2) // different body
    const fB2 = makeFormation('f-b2', 'Klei', 2)
    const contacts = [
      makeContact('c1', 'f-a1', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-a2', 'inv-2', 'cpt', 2.0),
      makeContact('c3', 'f-b1', 'inv-1', 'cpt', 5.0),
      makeContact('c4', 'f-b2', 'inv-2', 'cpt', 5.0),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a1', 'f-a2', 'edge-A'), makeEdge('f-b1', 'f-b2', 'edge-B')],
      contacts,
      formations: [fA1, fA2, fB1, fB2],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    // Idle: no edge lines.
    expect(container.querySelectorAll('[data-testid^="correlation-edge-"]').length).toBe(0)
    // Hover a body-1 chip → only the body-1 edge appears.
    fireEvent.mouseEnter(screen.getByTestId('body-chip-inv-1-f-a1'))
    expect(container.querySelector('[data-testid="correlation-edge-edge-A"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="correlation-edge-edge-B"]')).toBeNull()
  })

  // CE17: mouseleave from the chip clears the hover state and hides
  // the previously-revealed edges. Idempotent — the next hover re-
  // reveals from clean state.
  it('CE17: mouseleave hides revealed edges', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Zand', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b', 'edge-1')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    const chip = screen.getByTestId('body-chip-inv-1-f-a')
    fireEvent.mouseEnter(chip)
    expect(container.querySelector('[data-testid="correlation-edge-edge-1"]')).not.toBeNull()
    fireEvent.mouseLeave(chip)
    expect(container.querySelector('[data-testid="correlation-edge-edge-1"]')).toBeNull()
  })

  // CE20 — debt #100-followup 2026-05-23: when ``pulsingFormationIds``
  // contains a formation id, every committed band of that formation
  // renders an amber pulse stroke. Set transiently by the caller after
  // a successful correlate; the overlay is a pure projection of the
  // set so the test only needs to verify the rect renders when the
  // prop is populated.
  it('CE20: bands of pulsing formations render an amber pulse stroke', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      pulsingFormationIds: new Set(['f-a', 'f-b']),
    })
    // One pulse rect per (column × pulsing formation) band — here:
    // inv-1/f-a and inv-2/f-b.
    expect(container.querySelector('[data-testid="correlation-pulse-inv-1-f-a"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="correlation-pulse-inv-2-f-b"]')).not.toBeNull()
  })

  it('CE21: no pulse rects when pulsingFormationIds is empty / absent', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const { container } = renderOverlay({
      edges: [makeEdge('f-a', 'f-b')],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    expect(container.querySelector('[data-testid="correlation-pulse"]')).toBeNull()
  })

  // CE19: "Remove all correlations for this body" fires onUncorrelate
  // for every edge whose endpoints both carry the body's ordinal — not
  // just the edge under the right-clicked chip. Other bodies untouched.
  it('CE19: chip menu Remove-all fires onUncorrelate per body edge', async () => {
    // Note: the handler is async and serialises N onUncorrelate calls
    // with await between iterations. The test awaits via waitFor so the
    // microtask queue drains before the assertion.
    const onUncorrelate = vi.fn().mockResolvedValue(undefined)
    const fA1 = makeFormation('f-a1', 'Zand', 1)
    const fA2 = makeFormation('f-a2', 'Zand', 1)
    const fA3 = makeFormation('f-a3', 'Zand', 1) // 3-node body — 2 edges
    const fB1 = makeFormation('f-b1', 'Klei', 2)
    const fB2 = makeFormation('f-b2', 'Klei', 2)
    const contacts = [
      makeContact('c1', 'f-a1', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-a2', 'inv-2', 'cpt', 2.0),
      makeContact('c3', 'f-a3', 'inv-3', 'cpt', 2.0),
      makeContact('c4', 'f-b1', 'inv-1', 'cpt', 5.0),
      makeContact('c5', 'f-b2', 'inv-2', 'cpt', 5.0),
    ]
    const gestureState: CorrelateGestureState = {
      correlateMode: false,
      correlationSource: null,
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate,
      onPropagateAdmixtures: vi.fn(),
    }
    renderOverlay({
      edges: [
        makeEdge('f-a1', 'f-a2', 'edge-A12'),
        makeEdge('f-a2', 'f-a3', 'edge-A23'),
        makeEdge('f-b1', 'f-b2', 'edge-B'),
      ],
      contacts,
      formations: [fA1, fA2, fA3, fB1, fB2],
      placedColumns: [
        makeColumn('inv-1', 100, 10, 5),
        makeColumn('inv-2', 200, 10, 20),
        makeColumn('inv-3', 300, 10, 40),
      ],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
    })
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a1'))
    fireEvent.click(screen.getByText(/Remove all correlations for this body/i))
    // The body's two edges are both removed; body-2's edge is not.
    await vi.waitFor(() => expect(onUncorrelate).toHaveBeenCalledTimes(2))
    const calls = onUncorrelate.mock.calls.map(c => [c[0], c[1]].sort())
    expect(calls).toContainEqual(['f-a1', 'f-a2'].sort())
    expect(calls).toContainEqual(['f-a2', 'f-a3'].sort())
  })
})
