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

import CorrelationEdgesOverlay, { buildBandMap } from './CorrelationEdgesOverlay'
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

  // CE2 — debt #122: committed edges are always-on at ambient opacity
  // (0.20); chip surface is always-on. The connecting line is visible at
  // rest but faint, addressing the "too many lines" dogfeed complaint
  // without hiding the correlation graph entirely.
  it('CE2: edges render at ambient opacity at rest; chips are present per band', () => {
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
      edges: [makeEdge('f-a', 'f-b', 'edge-1')],
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
    // Edge renders at rest (ambient opacity — always-on per debt #122).
    const edgeGroup = container.querySelector('[data-testid="correlation-edge-edge-1"]')
    expect(edgeGroup).not.toBeNull()
    // The group carries the ambient opacity attribute.
    expect(edgeGroup!.getAttribute('opacity')).toBe('0.2')
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

  // CE16: both edges render at ambient opacity at rest (debt #122 always-
  // on). Hovering a chip for body-1 spikes that body's edge to 0.80;
  // body-2's edge stays at ambient (0.20). No edge is suppressed —
  // anti-spaghetti is achieved through low ambient opacity, not hiding.
  it('CE16: hovering a chip spikes that body\'s edge opacity; other-body edges stay ambient', () => {
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
    // Both edges are present at rest.
    expect(container.querySelector('[data-testid="correlation-edge-edge-A"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="correlation-edge-edge-B"]')).not.toBeNull()
    // Both at ambient opacity.
    expect(container.querySelector('[data-testid="correlation-edge-edge-A"]')!.getAttribute('opacity')).toBe('0.2')
    expect(container.querySelector('[data-testid="correlation-edge-edge-B"]')!.getAttribute('opacity')).toBe('0.2')
    // Hover a body-1 chip → body-1 edge spikes; body-2 stays ambient.
    fireEvent.mouseEnter(screen.getByTestId('body-chip-inv-1-f-a1'))
    expect(container.querySelector('[data-testid="correlation-edge-edge-A"]')!.getAttribute('opacity')).toBe('0.8')
    expect(container.querySelector('[data-testid="correlation-edge-edge-B"]')!.getAttribute('opacity')).toBe('0.2')
  })

  // CE17: mouseleave from the chip returns the edge to ambient opacity (0.20).
  // Edges remain present — they no longer hide on mouseleave (debt #122).
  it('CE17: mouseleave returns the body\'s edge to ambient opacity', () => {
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
    // Hover spikes the edge.
    fireEvent.mouseEnter(chip)
    expect(container.querySelector('[data-testid="correlation-edge-edge-1"]')!.getAttribute('opacity')).toBe('0.8')
    // Leave returns to ambient — edge still present.
    fireEvent.mouseLeave(chip)
    expect(container.querySelector('[data-testid="correlation-edge-edge-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="correlation-edge-edge-1"]')!.getAttribute('opacity')).toBe('0.2')
  })

  // -------------------------------------------------------------------
  // CE-O1..CE-O3 — debt #122: opacity fade for committed edges.
  // -------------------------------------------------------------------

  // CE-O1: a committed edge with no hover renders at ambient opacity 0.20.
  it('CE-O1: committed edge with no hover renders at ambient opacity 0.20', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
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
    const edgeGroup = container.querySelector('[data-testid="correlation-edge-edge-1"]')
    expect(edgeGroup).not.toBeNull()
    expect(edgeGroup!.getAttribute('opacity')).toBe('0.2')
  })

  // CE-O2: same edge with hoveredBodyOrdinal matching the body renders at
  // spiked opacity 0.80.
  it('CE-O2: committed edge with matching hover renders at spiked opacity 0.80', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
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
    // Hover a chip of body ordinal 1 to spike the edge.
    fireEvent.mouseEnter(screen.getByTestId('body-chip-inv-1-f-a'))
    const edgeGroup = container.querySelector('[data-testid="correlation-edge-edge-1"]')
    expect(edgeGroup!.getAttribute('opacity')).toBe('0.8')
  })

  // CE-O3: a committed 'auto' edge also renders at ambient opacity 0.20 at
  // rest — the fade applies to both 'manual' and 'auto' committed sources.
  // (Regression: the old EDGE_OPACITY_AUTO path is superseded.)
  it('CE-O3: auto-source committed edge renders at ambient opacity (not full opacity)', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    const autoEdge: LithoCorrelationEdge = {
      ...makeEdge('f-a', 'f-b', 'edge-auto'),
      source: 'auto',
    }
    const { container } = renderOverlay({
      edges: [autoEdge],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    const edgeGroup = container.querySelector('[data-testid="correlation-edge-edge-auto"]')
    expect(edgeGroup).not.toBeNull()
    // Ambient opacity — not full opacity (0.4 EDGE_OPACITY_AUTO is gone,
    // 0.20 EDGE_OPACITY_AMBIENT applies uniformly across committed sources).
    expect(edgeGroup!.getAttribute('opacity')).toBe('0.2')
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

  // -------------------------------------------------------------------
  // CE22–CE24 — #101 Blocker 1: body-context "Inspect lens body…" menu item.
  // -------------------------------------------------------------------

  // CE22: right-clicking a body chip fires onInspectLensBody(formationId, ordinal)
  // when the prop is provided.  The testid "body-context-inspect" identifies the
  // menu button; clicking it must forward the formation id and body ordinal.
  it('CE22: right-click on body chip → "Inspect lens body…" appears and calls onInspectLensBody', () => {
    const onInspectLensBody = vi.fn()
    const fA = makeFormation('f-a', 'Zand', 3)
    const fB = makeFormation('f-b', 'Klei', 3)
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
      onInspectLensBody,
    })
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a'))
    // The "Inspect lens body…" button must be present.
    const inspectBtn = screen.getByTestId('body-context-inspect')
    expect(inspectBtn).not.toBeNull()
    fireEvent.click(inspectBtn)
    // Must have been called with (formationId, bodyOrdinal).
    expect(onInspectLensBody).toHaveBeenCalledOnce()
    expect(onInspectLensBody).toHaveBeenCalledWith('f-a', 3)
  })

  // CE23: when onInspectLensBody is NOT provided the "Inspect lens body…" button
  // must be absent from the context menu — no dead item cluttering the chip menu.
  it('CE23: "Inspect lens body…" absent when onInspectLensBody prop is not provided', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
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
      // onInspectLensBody intentionally absent
    })
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a'))
    expect(screen.queryByTestId('body-context-inspect')).toBeNull()
  })

  // CE24: regression — the old "Mark as lens…" menu item (Approach-C, removed in
  // the R5 refactor) must never appear in the body context menu.  This guards
  // against accidental re-introduction of the deleted handler.
  it('CE24: regression — "Mark as lens" text is never present in body context menu', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
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
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a'))
    // "Mark as lens" (any capitalisation) must be absent — the item was
    // removed in the #101 R5 refactor and must not come back.
    expect(screen.queryByText(/mark as lens/i)).toBeNull()
  })

  // -------------------------------------------------------------------
  // CE25–CE26 — #129c: rejection toasts for blocked correlate clicks.
  // -------------------------------------------------------------------

  // CE25: clicking a cross-group band (armed source on inv-1/f-a, target
  // on inv-2 but different formation type) fires onRejectCorrelate.
  it('CE25: clicking a cross-group band calls onRejectCorrelate with a reason', () => {
    const onRejectCorrelate = vi.fn()
    // f-a and f-b have different litho_main_soil_code → cross-group
    const fA = { ...makeFormation('f-a', 'Zand', null), litho_main_soil_code: 'Z', parent_formation_id: 'pf-1' }
    const fB = { ...makeFormation('f-b', 'Klei', null), litho_main_soil_code: 'K', parent_formation_id: 'pf-1' }
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: { formationId: 'f-a', investigationId: 'inv-1', label: 'Zand' },
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
      onRejectCorrelate,
    })
    const rejectRect = screen.getByTestId('correlate-reject-crossgroup-inv-2-f-b')
    fireEvent.click(rejectRect)
    expect(onRejectCorrelate).toHaveBeenCalledOnce()
    expect(onRejectCorrelate.mock.calls[0][0]).toMatch(/different formation group/i)
  })

  // CE26: clicking a band on the SAME investigation as the armed source
  // (same-investigation, self-edge blocked) fires onRejectCorrelate.
  it('CE26: clicking a same-investigation band calls onRejectCorrelate with a reason', () => {
    const onRejectCorrelate = vi.fn()
    // Two formations on the same investigation inv-1.  Source is f-a; f-b
    // is on inv-1 too — same investigationId → blocked.
    const fA = makeFormation('f-a', 'Zand', null)
    const fB = makeFormation('f-b', 'Klei', null)
    const gestureState: CorrelateGestureState = {
      correlateMode: true,
      correlationSource: { formationId: 'f-a', investigationId: 'inv-1', label: 'Zand' },
      onArm: vi.fn(),
      onClearArmed: vi.fn(),
      onExitMode: vi.fn(),
      onCorrelate: vi.fn(),
      onUncorrelate: vi.fn(),
    }
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 1.0),
      makeContact('c2', 'f-b', 'inv-1', 'cpt', 3.0), // same inv
    ]
    renderOverlay({
      edges: [],
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      correlateGestureState: gestureState,
      onRejectCorrelate,
    })
    const rejectRect = screen.getByTestId('correlate-reject-sameinv-inv-1-f-b')
    fireEvent.click(rejectRect)
    expect(onRejectCorrelate).toHaveBeenCalledOnce()
    expect(onRejectCorrelate.mock.calls[0][0]).toMatch(/different investigation/i)
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

// ---------------------------------------------------------------------------
// buildBandMap unit tests — debt #120 regression
// ---------------------------------------------------------------------------
//
// CE-B1  Deepest band closes at investigation bottom (surface − max_depth_m),
//        NOT at plotBottomLevel.  This is the #120 regression anchor:
//        before the fix, the deepest band extended to plotBottomLevel
//        (the section-view floor), making click-target rects extend ~5 m
//        past the CPT/borehole bottom on every column.
// CE-B2  When max_depth_m is null (column has no depth info), the deepest
//        band falls back to plotBottomLevel as before.
// CE-B3  Intermediate bands always close at the next contact's top level,
//        regardless of max_depth_m — the fix only applies to the LAST band.

describe('buildBandMap', () => {
  function makeMinimalContact(
    id: string,
    formationId: string,
    investigationId: string,
    depthTopM: number,
  ): FormationContactResponse {
    return {
      id,
      model_id: 'model-1',
      formation_id: formationId,
      cpt_id: investigationId,
      borehole_id: null,
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

  function makeMinimalColumn(
    id: string,
    elevationM: number,
    maxDepthM: number | null,
  ): PlacedColumn {
    return {
      kind: 'cpt',
      proj: {
        item: {
          id,
          name: id,
          cpt_type: 'CPTM',
          location_x: 0,
          location_y: 0,
          elevation_m: elevationM,
          epsg: 31370,
          z_epsg: 5710,
          max_depth_m: maxDepthM,
          n_rows: 100,
          elevation_source: 'dem',
          start_date: null,
        } as CptListItem,
        along: 0,
        offset: 0,
      } as ProjectedInvestigation<CptListItem>,
      trueX: 0,
      nudgedX: 0,
      width: 40,
      displaced: false,
    }
  }

  it('CE-B1 — deepest band closes at investigation bottom (max_depth_m), not plotBottomLevel', () => {
    // Surface at 5 m TAW, single contact at 3 m depth, max_depth = 10 m.
    // Expected deepest-band botLevel = 5 − 10 = −5.
    // plotBottomLevel is much lower at −50 — must NOT be used.
    const contact = makeMinimalContact('c1', 'f1', 'inv-1', 3)
    const col = makeMinimalColumn('inv-1', 5, 10)
    const bandMap = buildBandMap([contact], [col], -50)
    const bands = bandMap.get('inv-1')!
    expect(bands).toBeDefined()
    const f1Band = bands.get('f1')!
    expect(f1Band).toBeDefined()
    // Top of this single contact: surface − depth_top = 5 − 3 = 2.
    expect(f1Band.topLevel).toBeCloseTo(2)
    // Bottom must be investigation bottom (5 − 10 = −5), not −50.
    expect(f1Band.botLevel).toBeCloseTo(-5)
  })

  it('CE-B2 — when max_depth_m is null, falls back to plotBottomLevel', () => {
    // Surface at 5 m TAW, single contact at 3 m depth, max_depth_m = null.
    const contact = makeMinimalContact('c1', 'f1', 'inv-1', 3)
    const col = makeMinimalColumn('inv-1', 5, null)
    const bandMap = buildBandMap([contact], [col], -50)
    const bands = bandMap.get('inv-1')!
    const f1Band = bands.get('f1')!
    // Fallback to plotBottomLevel.
    expect(f1Band.botLevel).toBeCloseTo(-50)
  })

  it('CE-B3 — intermediate bands close at next contact top, not at max_depth_m', () => {
    // Two contacts: f1 at 3 m, f2 at 7 m.  max_depth = 10 m.
    // f1's band bottom must be surface − 7 = −2, not surface − 10 = −5.
    const contacts = [
      makeMinimalContact('c1', 'f1', 'inv-1', 3),
      makeMinimalContact('c2', 'f2', 'inv-1', 7),
    ]
    const col = makeMinimalColumn('inv-1', 5, 10)
    const bandMap = buildBandMap(contacts, [col], -50)
    const bands = bandMap.get('inv-1')!
    const f1Band = bands.get('f1')!
    // Intermediate: closes at next contact's top = 5 − 7 = −2.
    expect(f1Band.botLevel).toBeCloseTo(-2)
    const f2Band = bands.get('f2')!
    // Deepest: closes at investigation bottom = 5 − 10 = −5.
    expect(f2Band.botLevel).toBeCloseTo(-5)
  })
})
