// Unit tests for CorrelationEdgesOverlay (#133 Phase 1 + #135 + Phase 2+3).
//
// Claims pinned here:
//   CE1  No lines rendered when contacts and contactEdges are both empty.
//   CE3  Badge shows "#N" when instance_ordinal is set on a formation.
//   CE4  No chip when instance_ordinal is null (pre-Resolve state).
//   CE14 Right-click body chip opens body context menu (edit admixtures + remove all).
//   CE15 Chip menu "Edit admixtures for this body" opens the admixture editor.
//   CE20 Bands of pulsing formations render an amber pulse stroke.
//   CE21 No pulse rects when pulsingFormationIds is empty / absent.
//   CE22 Right-click on body chip → "Inspect lens body…" appears and calls onInspectLensBody.
//   CE23 "Inspect lens body…" absent when onInspectLensBody prop is not provided.
//   CE24 Regression — "Mark as lens" text is never present in body context menu.
//   CE-B1..B3  buildBandMap geometry anchors (debt #120 regression).
//   CC1..CC9  Contact-correlate gesture (#133 Phase 1 + #135 lens-pinch-out).
//   CC10..CC10b  Delete-contact right-click gesture.
//   CC11..CC12  Drag-to-retarget unapproved edge (#133 Phase 2+3 Task 26).
//   CE-D1  Enlarged endpoint grab target fires onUnapprovedDragStart (#163d).
//   CE-E1..E2  Right-click edge → Delete-correlation menu → onRequestDeleteEdge (#163e).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CorrelationEdgesOverlay, { buildBandMap, contactStripeColors } from './CorrelationEdgesOverlay'
import type { ContactGestureState } from './CorrelationEdgesOverlay'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import type { CptListItem } from '../../api/client'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

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
  it('CE1: renders nothing when contacts and contactEdges are both empty', () => {
    const { container } = renderOverlay({
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

  it('CE3: chip shows "#N" when instance_ordinal is set', () => {
    const fA = makeFormation('f-a', 'Zand', 1)
    const fB = makeFormation('f-b', 'Klei', 1)
    const contacts = [
      makeContact('c1', 'f-a', 'inv-1', 'cpt', 2.0),
      makeContact('c2', 'f-b', 'inv-2', 'cpt', 2.0),
    ]
    renderOverlay({
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

  // -------------------------------------------------------------------
  // Context-menu admixture propagation (CE14–CE15)
  // -------------------------------------------------------------------

  // CE14 — debt #100: right-click on a body chip opens the body-level
  // context menu. onPropagateAdmixtures is now a direct prop (not nested
  // inside a gesture state).
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
    renderOverlay({
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      onPropagateAdmixtures: vi.fn(),
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
    renderOverlay({
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      onPropagateAdmixtures,
    })
    const chip = screen.getByTestId('body-chip-inv-1-f-a')
    fireEvent.contextMenu(chip)
    // Pick the menu BUTTON (there will be a duplicate text on the h2
    // after open — `selector: 'button'` disambiguates).
    fireEvent.click(screen.getByText(/Edit admixtures for this body/i, { selector: 'button' }))
    expect(screen.getByText(/Edit admixtures for this body/i, { selector: 'h2' })).not.toBeNull()
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
    renderOverlay({
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
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
    renderOverlay({
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
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
    renderOverlay({
      contacts,
      formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
    })
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a'))
    // "Mark as lens" (any capitalisation) must be absent — the item was
    // removed in the #101 R5 refactor and must not come back.
    expect(screen.queryByText(/mark as lens/i)).toBeNull()
  })

  // CC8: approved contact edge renders a ribbon group with data-approved="true"
  // and a near-black seam line.
  it('CC8: approved contact edge renders ribbon with data-approved="true"', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e1').getAttribute('data-approved')).toBe('true')
    expect(screen.getByTestId('ribbon-seam-e1')).not.toBeNull()
    expect(screen.queryByTestId('ribbon-outline-e1')).toBeNull()
  })

  // CC9: unapproved contact edge renders a faded ribbon with a dashed amber
  // outline and data-approved="false".
  it('CC9: unapproved contact edge renders ribbon with data-approved="false"', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e2', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e2').getAttribute('data-approved')).toBe('false')
    const outline = screen.getByTestId('ribbon-outline-e2')
    expect(outline.getAttribute('stroke')).toBe('#f59e0b')
    expect(outline.getAttribute('stroke-dasharray')).toBe('4 4')
    expect(screen.queryByTestId('ribbon-seam-e2')).toBeNull()
  })

  // SR1: topmost-contact edge omits the above stripe (only below renders).
  it('SR1: topmost contacts omit the above stripe', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e3', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.queryByTestId('ribbon-above-e3')).toBeNull()
    expect(screen.getByTestId('ribbon-below-e3')).not.toBeNull()
  })

  // SR2: a lens (below lithology differs across ends) yields different
  // below-gradient stops; the above gradient (same ZAND both ends) is equal.
  it('SR2: lens edge has differing below-gradient stops, equal above stops', () => {
    const fZand = { ...makeFormation('f-zand', 'Zand', null), color: '#fbbf24' }
    const fKlei = { ...makeFormation('f-klei', 'Klei', null), color: '#6b7280' }
    const fSilt = { ...makeFormation('f-silt', 'Silt', null), color: '#84cc16' }
    const contacts = [
      makeContact('za', 'f-zand', 'inv-A', 'cpt', 0),
      makeContact('ka', 'f-klei', 'inv-A', 'cpt', 2),
      makeContact('zb', 'f-zand', 'inv-B', 'cpt', 0),
      makeContact('sb', 'f-silt', 'inv-B', 'cpt', 2),
    ]
    const edge = {
      id: 'e4', contact_a_id: 'ka', contact_b_id: 'sb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    const { container } = renderOverlay({
      contacts, formations: [fZand, fKlei, fSilt],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    // The above stripe must actually render here (both ends have ZAND
    // above) — guard the gradient-stop assertions against a silent omit.
    expect(screen.getByTestId('ribbon-above-e4')).not.toBeNull()
    const belowStops = container.querySelectorAll('#ribbon-below-grad-e4 stop')
    expect(belowStops[0].getAttribute('stop-color')).toBe('#6b7280') // KLEI (A)
    expect(belowStops[1].getAttribute('stop-color')).toBe('#84cc16') // SILT (B)
    const aboveStops = container.querySelectorAll('#ribbon-above-grad-e4 stop')
    expect(aboveStops[0].getAttribute('stop-color')).toBe('#fbbf24') // ZAND
    expect(aboveStops[1].getAttribute('stop-color')).toBe('#fbbf24') // ZAND
  })

  // SR3: the ribbon anchors at each column's INNER edge (gap-spanning), not
  // the column centre — so it bridges the gap rather than overlapping the
  // litho columns (owner dogfeed 2026-05-28).
  it('SR3: ribbon anchors at the inner column edges, not the centres', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e5', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    // Columns: centres 100 / 200, width 40 → inner edges at 120 (A right)
    // and 180 (B left). The ribbon must use the edges, not the centres.
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    const points = screen.getByTestId('ribbon-below-e5').getAttribute('points') ?? ''
    expect(points.startsWith('120,')).toBe(true) // A inner (right) edge
    expect(points).toContain('180,') //               B inner (left) edge
    expect(points).not.toContain('100,') //            not A centre
    expect(points).not.toContain('200,') //            not B centre
  })

  // CE-D1 (#31): the whole seam is grabbable, split at its midpoint into two
  // generous transparent zones (no tiny endpoint handles). Each half is wider
  // than the old 8 px handle and fires onUnapprovedDragStart for its end.
  it('CE-D1: midpoint-split grab zones fire onUnapprovedDragStart per end', () => {
    const onUnapprovedDragStart = vi.fn()
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'eg', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge], onUnapprovedDragStart,
    })
    const grabA = screen.getByTestId('edge-grab-a-eg')
    // The grab zone is meaningfully bigger than the old 8 px visible handle.
    expect(Number(grabA.getAttribute('stroke-width'))).toBeGreaterThan(8)
    fireEvent.mouseDown(grabA)
    expect(onUnapprovedDragStart).toHaveBeenCalledOnce()
    expect(onUnapprovedDragStart.mock.calls[0][2]).toBe('a')
    onUnapprovedDragStart.mockClear()
    fireEvent.mouseDown(screen.getByTestId('edge-grab-b-eg'))
    expect(onUnapprovedDragStart.mock.calls[0][2]).toBe('b')
  })

  // CE-E1 (#163e / #31): right-clicking a draggable (unapproved) seam zone
  // opens the Delete-correlation menu; choosing it fires onRequestDeleteEdge.
  it('CE-E1: right-click edge opens Delete menu and fires onRequestDeleteEdge', () => {
    const onRequestDeleteEdge = vi.fn()
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'ed', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge], onRequestDeleteEdge, onUnapprovedDragStart: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('edge-grab-a-ed'))
    fireEvent.click(screen.getByText(/Delete correlation/i, { selector: 'button' }))
    expect(onRequestDeleteEdge).toHaveBeenCalledOnce()
    expect((onRequestDeleteEdge.mock.calls[0][0] as LithoContactCorrelationEdge).id).toBe('ed')
  })

  // CE-E3 (dogfeed 2026-05-29): an APPROVED (accepted) correlation must be
  // deletable the same way — the owner reported "can't delete accepted
  // correlation". Approved edges show no grab handles, so the band itself
  // is the only affordance; right-clicking it must fire onRequestDeleteEdge.
  it('CE-E3: right-click an approved edge fires onRequestDeleteEdge', () => {
    const onRequestDeleteEdge = vi.fn()
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'eok', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge], onRequestDeleteEdge,
    })
    fireEvent.contextMenu(screen.getByTestId('edge-hit-eok'))
    fireEvent.click(screen.getByText(/Delete correlation/i, { selector: 'button' }))
    expect(onRequestDeleteEdge).toHaveBeenCalledOnce()
    expect((onRequestDeleteEdge.mock.calls[0][0] as LithoContactCorrelationEdge).id).toBe('eok')
  })

  // CE-E2 (#163e): no edge-delete hit target when onRequestDeleteEdge absent.
  it('CE-E2: no edge-delete hit target when onRequestDeleteEdge is absent', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'ez', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.queryByTestId('edge-hit-ez')).toBeNull()
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

// ---------------------------------------------------------------------------
// contactStripeColors — above/below lithology colour per contact (#131-c)
// ---------------------------------------------------------------------------
describe('contactStripeColors', () => {
  function fmt(id: string, color: string): GeologicalFormationResponse {
    return { ...makeFormation(id, id, null), color, litho_main_soil_code: 'ZAND' }
  }
  function byId(...fs: GeologicalFormationResponse[]) {
    return new Map(fs.map(f => [f.id, f]))
  }

  it('SC1: below = own formation colour, above = next-shallower formation colour', () => {
    const contacts = [
      makeContact('c-zand', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c-klei', 'f-klei', 'inv-1', 'cpt', 2),
    ]
    const formationById = byId(fmt('f-zand', '#fbbf24'), fmt('f-klei', '#6b7280'))
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c-klei')).toEqual({ above: '#fbbf24', below: '#6b7280' })
  })

  it('SC2: topmost contact has no above (null)', () => {
    const contacts = [
      makeContact('c-zand', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c-klei', 'f-klei', 'inv-1', 'cpt', 2),
    ]
    const formationById = byId(fmt('f-zand', '#fbbf24'), fmt('f-klei', '#6b7280'))
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c-zand')).toEqual({ above: null, below: '#fbbf24' })
  })

  it('SC3: investigations do not bleed into each other ordering', () => {
    const contacts = [
      makeContact('c1', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c2', 'f-klei', 'inv-1', 'cpt', 2),
      makeContact('c3', 'f-silt', 'inv-2', 'cpt', 3),
    ]
    const formationById = byId(
      fmt('f-zand', '#fbbf24'),
      fmt('f-klei', '#6b7280'),
      fmt('f-silt', '#84cc16'),
    )
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c3')).toEqual({ above: null, below: '#84cc16' })
    // inv-1's deeper contact must take inv-1's shallower contact as its
    // above — NOT inv-2's c3 — i.e. the per-investigation grouping holds.
    expect(result.get('c2')).toEqual({ above: '#fbbf24', below: '#6b7280' })
  })

  it('SC4: contact whose formation is unknown is skipped', () => {
    const contacts = [makeContact('c-missing', 'f-gone', 'inv-1', 'cpt', 0)]
    const result = contactStripeColors(contacts, new Map())
    expect(result.has('c-missing')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Contact-correlate gesture (#133 Phase 1 + #135 lens-pinch-out)
// ---------------------------------------------------------------------------

function makeContactGestureState(
  overrides: Partial<ContactGestureState> = {},
): ContactGestureState {
  return {
    contactCorrelateMode: true,
    armedContactId: null,
    lastTargetTestId: null,
    onArmContact: vi.fn(),
    onClearArmedContact: vi.fn(),
    onContactCorrelate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('CorrelationEdgesOverlay — contact-correlate gesture (#133 + #135)', () => {
  // Two columns on different investigations, one contact each.
  const fA = makeFormation('f-a', 'Zand', 1)
  const baseContacts = [
    makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
    makeContact('cb1', 'f-a', 'inv-B', 'cpt', 2.0),
    makeContact('cb2', 'f-a', 'inv-B', 'cpt', 5.0),
    makeContact('cc', 'f-a', 'inv-C', 'cpt', 2.0),
  ]
  const baseColumns = [
    makeColumn('inv-A', 100, 10, 5),
    makeColumn('inv-B', 200, 10, 20),
    makeColumn('inv-C', 300, 10, 35),
  ]

  it('CC1: clicking with nothing armed → onArmContact', () => {
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-ca'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('ca')
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CE-HIT: correlate hit-rect spans the whole band, not just the boundary line', () => {
    // cb1 (inv-B, 2 m) has cb2 (5 m) below it → a finite band. The hit-rect
    // must cover that band so a click on the band BODY — not only the thin
    // boundary line — arms the contact (dogfeed 2026-05-29).
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    const rect = screen.getByTestId('contact-hit-cb1')
    // band: topLevel 8 → y 40, botLevel 5 → y 70 ⇒ height 30, far above the
    // legacy 12 px boundary strip.
    expect(Number(rect.getAttribute('height'))).toBeGreaterThan(12)
    fireEvent.click(rect)
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb1')
  })

  it('CE-HIT-LOW: clicking the lower half arms the boundary BELOW (next-deeper contact)', () => {
    // cb1 (inv-B, 2 m) has cb2 (5 m) below it. cb1's lower half arms cb2, so
    // clicking a unit's BOTTOM edge selects the bottom boundary — not the top
    // (dogfeed 2026-05-29 regression: full-band targets armed the top).
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cb1-low'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb2')
  })

  it('CC2: clicking armed source again → onClearArmedContact', () => {
    const gesture = makeContactGestureState({ armedContactId: 'ca' })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-ca'))
    expect(gesture.onClearArmedContact).toHaveBeenCalled()
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CC3: first edge — armed source, no sticky → onContactCorrelate fires', () => {
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      lastTargetTestId: null,
    })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cb1'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb1')
    expect(gesture.onArmContact).not.toHaveBeenCalled()
  })

  it('CC4 (#135 lens): armed source + sticky target test, second click on same test → onContactCorrelate', () => {
    // After committing ca↔cb1, sticky = inv-B.  Clicking cb2 (also on inv-B)
    // must fire a SECOND correlation from the still-armed source — the
    // lens-pinch-out gesture.
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      lastTargetTestId: 'inv-B',
    })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cb2'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb2')
    expect(gesture.onArmContact).not.toHaveBeenCalled()
    expect(gesture.onClearArmedContact).not.toHaveBeenCalled()
  })

  it('CC5: armed + sticky, click on contact in source own test → re-arm (no correlate)', () => {
    // Armed = ca (on inv-A), sticky target test = inv-B.  Clicking another
    // contact on inv-A is interpreted as "actually I meant this one as
    // source" → re-arm, do not auto-fire a same-investigation correlation
    // that the server would reject anyway.
    const caAlt = makeContact('ca-alt', 'f-a', 'inv-A', 'cpt', 6.0)
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      lastTargetTestId: 'inv-B',
    })
    renderOverlay({
      contacts: [...baseContacts, caAlt],
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-ca-alt'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('ca-alt')
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CC6 (#135 conservative): armed + sticky, click on contact in a THIRD test → re-arm (no auto-fire)', () => {
    // Armed = ca (inv-A), sticky target = inv-B.  Clicking cc on inv-C is
    // NOT the lens gesture — the conservative choice is to clear sticky and
    // re-arm to cc rather than silently fire ca↔cc across a third test.
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      lastTargetTestId: 'inv-B',
    })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cc'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('cc')
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CC7 (#135 stacked): a third click on the same target test chains another lens edge', () => {
    // Armed = ca, sticky = inv-B.  Clicking yet another contact on inv-B
    // fires another correlation.  The gesture generalises to N≥2 clicks
    // for stacked-lens topology.
    const cb3 = makeContact('cb3', 'f-a', 'inv-B', 'cpt', 8.0)
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      lastTargetTestId: 'inv-B',
    })
    renderOverlay({
      contacts: [...baseContacts, cb3],
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cb3'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb3')
  })

  it('CC10: right-click on contact hit-rect fires onRequestDeleteContact with the contact id', () => {
    // Confirms that the context-menu gesture on the hit-rect calls the
    // optional onRequestDeleteContact callback — the caller (SectionsCanvas)
    // owns the confirm dialog + DELETE round-trip.
    const onRequestDeleteContact = vi.fn()
    const gesture = makeContactGestureState({ onRequestDeleteContact })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.contextMenu(screen.getByTestId('contact-hit-ca'))
    expect(onRequestDeleteContact).toHaveBeenCalledWith('ca')
    expect(onRequestDeleteContact).toHaveBeenCalledTimes(1)
  })

  it('CC10b: right-click without onRequestDeleteContact prop does not throw', () => {
    // When the caller omits onRequestDeleteContact the context-menu is a
    // no-op — no error surfaced to the user.
    const gesture = makeContactGestureState()
    // gesture has no onRequestDeleteContact → optional-chain is exercised
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    expect(() => fireEvent.contextMenu(screen.getByTestId('contact-hit-ca'))).not.toThrow()
  })

  // CC11 (#31): an unapproved edge renders two midpoint-split grab zones (the
  // whole seam is grabbable now — no tiny endpoint handles). Each half drags
  // its nearer endpoint.
  it('CC11: unapproved edge renders both grab zones', () => {
    const edge: LithoContactCorrelationEdge = {
      id: 'e-unapproved',
      contact_a_id: 'ca',
      contact_b_id: 'cb1',
      model_id: 'm1',
      source: 'auto',
      user_approved: false,
      created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactEdges: [edge],
      onUnapprovedDragStart: vi.fn(),
    })
    expect(screen.getByTestId('edge-grab-a-e-unapproved')).not.toBeNull()
    expect(screen.getByTestId('edge-grab-b-e-unapproved')).not.toBeNull()
  })

  // CC12 (#31): mousedown on a grab zone fires onUnapprovedDragStart with
  // (event, edge, 'a' | 'b') — the 'a' half drags endpoint A, 'b' half drags B.
  it('CC12: mousedown on grab zone fires onUnapprovedDragStart(e, edge, handle)', () => {
    const onUnapprovedDragStart = vi.fn()
    const edge: LithoContactCorrelationEdge = {
      id: 'e-unapproved-2',
      contact_a_id: 'ca',
      contact_b_id: 'cb1',
      model_id: 'm1',
      source: 'auto',
      user_approved: false,
      created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactEdges: [edge],
      onUnapprovedDragStart,
    })
    fireEvent.mouseDown(screen.getByTestId('edge-grab-a-e-unapproved-2'))
    expect(onUnapprovedDragStart).toHaveBeenCalledOnce()
    const [_e, calledEdge, calledHandle] = onUnapprovedDragStart.mock.calls[0] as [
      React.MouseEvent,
      LithoContactCorrelationEdge,
      'a' | 'b',
    ]
    expect(calledEdge.id).toBe('e-unapproved-2')
    expect(calledHandle).toBe('a')

    // Mousedown on the 'b' handle fires with handle='b'.
    onUnapprovedDragStart.mockClear()
    fireEvent.mouseDown(screen.getByTestId('edge-grab-b-e-unapproved-2'))
    expect(onUnapprovedDragStart).toHaveBeenCalledOnce()
    expect(onUnapprovedDragStart.mock.calls[0][2]).toBe('b')
  })
})

describe('CorrelationEdgesOverlay — lens candidates (#163 dogfeed 2026-05-29)', () => {
  const fA = makeFormation('f-a', 'Zand', 1)
  const contacts = [
    makeContact('a-top', 'f-a', 'inv-A', 'cpt', 1.0),
    makeContact('a-mid', 'f-a', 'inv-A', 'cpt', 5.0), // enclosed, un-correlated
    makeContact('a-bot', 'f-a', 'inv-A', 'cpt', 9.0),
    makeContact('b-top', 'f-a', 'inv-B', 'cpt', 1.0),
    makeContact('b-bot', 'f-a', 'inv-B', 'cpt', 9.0),
  ]
  const columns = [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)]
  const mk = (id: string, a: string, b: string) => ({
    id,
    contact_a_id: a,
    contact_b_id: b,
    model_id: 'm1',
    source: 'manual',
    user_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  })
  const edges = [mk('e-top', 'a-top', 'b-top'), mk('e-bot', 'a-bot', 'b-bot')]

  it('marks an enclosed un-correlated contact as a lens candidate (correlate mode)', () => {
    const { queryByTestId } = renderOverlay({
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactEdges: edges,
      contactGestureState: makeContactGestureState(),
    })
    expect(queryByTestId('lens-candidate-a-mid')).not.toBeNull()
    expect(queryByTestId('lens-candidate-a-top')).toBeNull()
    expect(queryByTestId('lens-candidate-a-bot')).toBeNull()
  })

  it('hides candidate markers outside correlate mode', () => {
    const { queryByTestId } = renderOverlay({
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactEdges: edges,
    })
    expect(queryByTestId('lens-candidate-a-mid')).toBeNull()
  })

  it('does not flag a non-enclosed un-correlated contact', () => {
    const { queryByTestId } = renderOverlay({
      contacts,
      formations: [fA],
      placedColumns: columns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactEdges: [edges[0]], // only the top correlated → a-mid not enclosed below
      contactGestureState: makeContactGestureState(),
    })
    expect(queryByTestId('lens-candidate-a-mid')).toBeNull()
  })
})
