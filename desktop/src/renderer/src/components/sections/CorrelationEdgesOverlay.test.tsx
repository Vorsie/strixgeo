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
//   CE-B4      buildBandMap separates two contacts with the same formation_id
//              at different depths (dogfeed 2026-05-31 — repeated-lithology
//              collision: shallow contact's hit-rect drew at the deep
//              contact's depth, so clicking the upper sand armed the lower).
//   CC1..CC9  Contact-correlate gesture (#133 Phase 1 + #135 lens-pinch-out).
//   CC-BH1    Bottom handle renders in correlate mode.
//   CC-BH2    Bottom handle absent when contactCorrelateMode=false.
//   CC-BH3    Clicking bottom handle (nothing armed) arms with side='base'.
//   CC-BH4    Clicking bottom handle (band armed) fires onContactCorrelate with sides.
//   CC10..CC10b  Delete-contact right-click gesture.
//   CC11..CC12  Drag-to-retarget unapproved edge (#133 Phase 2+3 Task 26).
//   CE-D1  Enlarged endpoint grab target fires onUnapprovedDragStart (#163d).
//   CE-E1..E2  Right-click edge → Delete-correlation menu → onRequestDeleteEdge (#163e).
//   CE-E4..E6  Right-click edge → "Accept correlation" menu item: present on
//              pending edges, fires onRequestAcceptEdge, suppressed on approved
//              edges (dogfeed 2026-05-31).

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
    source_litho_formation_id: null,
    source_geo_formation_id: null,
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
  it('CE14: right-click body chip opens body context menu (edit admixtures)', () => {
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
      id: 'e1', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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

  // CC8b: the approved seam fades from the tied unit's litho colour at one
  // test over into its colour at the next test (owner ask 2026-07-13 — the
  // solid near-black seam read as "black bands" on real data). The gradient
  // uses the colour of the unit BELOW each tied contact (the band whose top
  // the seam marks).
  it('CC8b: approved seam strokes a gradient from the left unit colour to the right unit colour', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const fB = { ...makeFormation('f-b', 'Klei', 2), color: '#94a3b8' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-b', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    const { container } = renderOverlay({
      contacts, formations: [fA, fB],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    const seam = screen.getByTestId('ribbon-seam-e1')
    expect(seam.getAttribute('stroke')).toBe('url(#seam-grad-e1)')
    const grad = container.querySelector('#seam-grad-e1')
    expect(grad).not.toBeNull()
    const stops = grad!.querySelectorAll('stop')
    expect(stops).toHaveLength(2)
    expect(stops[0].getAttribute('stop-color')).toBe('#fbbf24')
    expect(stops[1].getAttribute('stop-color')).toBe('#94a3b8')
  })

  // CC8c: when an endpoint's unit colour is unknown the seam falls back to
  // the solid near-black constant (no half-gradient into nothing).
  it('CC8c: seam falls back to the solid seam colour when a unit colour is unknown', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      // cb references a formation that is NOT in the formations list — no colour.
      makeContact('cb', 'f-missing', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    const seam = screen.getByTestId('ribbon-seam-e1')
    expect(seam.getAttribute('stroke')).toBe('#0f172a')
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
      id: 'e2', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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

  // TIE1/TIE2: cross-lithology edge → surface-tie LINE (no ribbon); same-
  // lithology edge → ribbon (no tie line). Surface ties are the "top is the
  // same as next test, across lithologies" gesture (thread B, 2026-06-07).
  it('TIE1: cross-lithology edge renders a tie line and no ribbon', () => {
    const fSand = {
      ...makeFormation('f-sand', 'Zand', 1),
      litho_main_soil_code: 'ZAND',
      color: '#fbbf24',
    }
    const fClay = {
      ...makeFormation('f-clay', 'Klei', 2),
      litho_main_soil_code: 'KLEI',
      color: '#6b7280',
    }
    const contacts = [
      makeContact('ca', 'f-sand', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-clay', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fSand, fClay],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('tie-line-e1')).not.toBeNull()
    expect(screen.queryByTestId('ribbon-e1')).toBeNull()
  })

  it('TIE2: same-lithology edge still renders a ribbon and no tie line', () => {
    const fSand = {
      ...makeFormation('f-sand', 'Zand', 1),
      litho_main_soil_code: 'ZAND',
      color: '#fbbf24',
    }
    const contacts = [
      makeContact('ca', 'f-sand', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-sand', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e2', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fSand],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e2')).not.toBeNull()
    expect(screen.queryByTestId('tie-line-e2')).toBeNull()
  })

  // SR1: topmost-contact edge omits the above stripe (only below renders).
  it.skip('SR1: topmost contacts omit the above stripe [gated: RIBBON_STRIPES_ENABLED]', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e3', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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
  it.skip('SR2: lens edge has differing below-gradient stops, equal above stops [gated: RIBBON_STRIPES_ENABLED]', () => {
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
      id: 'e4', layer_a_id: 'ka', layer_b_id: 'sb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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
  it.skip('SR3: ribbon anchors at the inner column edges, not the centres [gated: RIBBON_STRIPES_ENABLED]', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e5', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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

  // SR4 (dogfeed 2026-06-04): closely-spaced columns leave only the ~4 px
  // nudge edge-gap between their inner edges, so the gap-bridging ribbon
  // collapses to an invisible sliver and zoom can't widen it. The ribbon must
  // floor to a minimum on-screen width so the user can see + grab it.
  it.skip('SR4: closely-spaced columns render a ribbon at least the minimum width [gated: RIBBON_STRIPES_ENABLED]', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'em', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    // Centres 100 / 145, width 40 → inner edges 120 / 125 → a 5 px gap. The
    // gap-bridging ribbon would be a 5 px sliver; the floor must widen it.
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 145, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    const points = screen.getByTestId('ribbon-below-em').getAttribute('points') ?? ''
    const xs = points
      .trim()
      .split(/\s+/)
      .map(p => parseFloat(p.split(',')[0]))
    const span = Math.max(...xs) - Math.min(...xs)
    expect(span).toBeGreaterThanOrEqual(16)
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
      id: 'eg', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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
      id: 'ed', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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
      id: 'eok', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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

  // #68 (Tier E — robustness): the overlay's context menus used to render as a
  // <foreignObject> INSIDE the overlay's root <g style="pointer-events:none">,
  // so they were clickable only because the foreignObject's HTML children happen
  // not to inherit the SVG pointer-events:none — an SVG-spec oddity a Chromium
  // bump could regress. The robust shape: the menu must be reachable regardless
  // of the overlay's pointer-events model, i.e. it must NOT be a descendant of
  // the pointer-events:none group.
  it('#68: the uncorrelate (edge) menu is not nested in the pointer-events:none overlay group', () => {
    const onRequestDeleteEdge = vi.fn()
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'ed', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    const { container } = renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge], onRequestDeleteEdge, onUnapprovedDragStart: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('edge-grab-a-ed'))
    const overlayGroup = container.querySelector('[data-testid="correlation-edges-overlay"]') as SVGGElement
    expect(overlayGroup).not.toBeNull()
    // guard: this is the group the fix must not nest the menu inside
    expect(overlayGroup.style.pointerEvents).toBe('none')
    const menu = screen.getByTestId('edge-context-menu')
    expect(overlayGroup.contains(menu)).toBe(false)
    // and the menu is still wired: choosing Delete fires the handler
    fireEvent.click(screen.getByText(/Delete correlation/i, { selector: 'button' }))
    expect(onRequestDeleteEdge).toHaveBeenCalledOnce()
  })

  it('#68: the body chip menu is not nested in the pointer-events:none overlay group', () => {
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
    const { container } = renderOverlay({
      contacts, formations: [fA, fB],
      placedColumns: [makeColumn('inv-1', 100, 10, 5), makeColumn('inv-2', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      onPropagateAdmixtures: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('body-chip-inv-1-f-a'))
    const overlayGroup = container.querySelector('[data-testid="correlation-edges-overlay"]') as SVGGElement
    expect(overlayGroup).not.toBeNull()
    const menu = screen.getByTestId('body-context-menu')
    expect(overlayGroup.contains(menu)).toBe(false)
  })

  // CE-E4 (dogfeed 2026-05-31): right-clicking a pending edge shows the
  // "Accept correlation" item and choosing it fires onRequestAcceptEdge
  // with the edge.
  it('CE-E4: right-click pending edge shows Accept item and fires onRequestAcceptEdge', () => {
    const onRequestAcceptEdge = vi.fn()
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'epending', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
      onRequestAcceptEdge,
      onUnapprovedDragStart: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('edge-grab-a-epending'))
    fireEvent.click(screen.getByText(/Accept correlation/i, { selector: 'button' }))
    expect(onRequestAcceptEdge).toHaveBeenCalledOnce()
    expect((onRequestAcceptEdge.mock.calls[0][0] as LithoContactCorrelationEdge).id).toBe(
      'epending',
    )
  })

  // CE-E5: approved edges have no Accept item — the action is meaningless.
  it('CE-E5: approved edge menu does NOT include Accept correlation', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'eapproved', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
      onRequestAcceptEdge: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('edge-hit-eapproved'))
    // Delete still present.
    expect(screen.getByText(/Delete correlation/i, { selector: 'button' })).not.toBeNull()
    // Accept must NOT appear on an already-approved edge regardless of prop.
    expect(screen.queryByText(/Accept correlation/i, { selector: 'button' })).toBeNull()
  })

  // CE-E6: read-only callers (no onRequestAcceptEdge) get no Accept item.
  it('CE-E6: pending edge menu omits Accept when onRequestAcceptEdge is undefined', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'eronly', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
      // onRequestAcceptEdge intentionally omitted.
      onUnapprovedDragStart: vi.fn(),
    })
    fireEvent.contextMenu(screen.getByTestId('edge-grab-a-eronly'))
    expect(screen.getByText(/Delete correlation/i, { selector: 'button' })).not.toBeNull()
    expect(screen.queryByText(/Accept correlation/i, { selector: 'button' })).toBeNull()
  })

  // CE-E2 (#163e): no edge-delete hit target when onRequestDeleteEdge absent.
  it('CE-E2: no edge-delete hit target when onRequestDeleteEdge is absent', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'ez', layer_a_id: 'ca', layer_b_id: 'cb', model_id: 'm1',
      section_id: 's1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z', layer_a_side: 'top' as const, layer_b_side: 'top' as const,
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
    const c1Band = bands.get('c1')!
    expect(c1Band).toBeDefined()
    expect(c1Band.formationId).toBe('f1')
    // Top of this single contact: surface − depth_top = 5 − 3 = 2.
    expect(c1Band.topLevel).toBeCloseTo(2)
    // Bottom must be investigation bottom (5 − 10 = −5), not −50.
    expect(c1Band.botLevel).toBeCloseTo(-5)
  })

  it('CE-B2 — when max_depth_m is null, falls back to plotBottomLevel', () => {
    // Surface at 5 m TAW, single contact at 3 m depth, max_depth_m = null.
    const contact = makeMinimalContact('c1', 'f1', 'inv-1', 3)
    const col = makeMinimalColumn('inv-1', 5, null)
    const bandMap = buildBandMap([contact], [col], -50)
    const bands = bandMap.get('inv-1')!
    const c1Band = bands.get('c1')!
    // Fallback to plotBottomLevel.
    expect(c1Band.botLevel).toBeCloseTo(-50)
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
    const c1Band = bands.get('c1')!
    // Intermediate: closes at next contact's top = 5 − 7 = −2.
    expect(c1Band.botLevel).toBeCloseTo(-2)
    const c2Band = bands.get('c2')!
    // Deepest: closes at investigation bottom = 5 − 10 = −5.
    expect(c2Band.botLevel).toBeCloseTo(-5)
  })

  it('CE-B4 — two contacts with the SAME formation_id at different depths each get their own band entry', () => {
    // Repeated lithology: SAND #1 at 3 m and SAND #2 at 7 m share
    // formation_id 'sand'. max_depth = 10 m. Both contacts must appear
    // in the inner map (keyed by contact id) with their own depth
    // intervals — formation_id as the key would let the deeper write
    // overwrite the shallower one, drawing the upper hit-rect at the
    // lower band's depth (dogfeed 2026-05-31).
    const contacts = [
      makeMinimalContact('upper-sand', 'sand', 'inv-1', 3),
      makeMinimalContact('lower-sand', 'sand', 'inv-1', 7),
    ]
    const col = makeMinimalColumn('inv-1', 5, 10)
    const bandMap = buildBandMap(contacts, [col], -50)
    const bands = bandMap.get('inv-1')!
    expect(bands.size).toBe(2)
    const upper = bands.get('upper-sand')!
    const lower = bands.get('lower-sand')!
    expect(upper).toBeDefined()
    expect(lower).toBeDefined()
    expect(upper.formationId).toBe('sand')
    expect(lower.formationId).toBe('sand')
    // Upper: top = 5 − 3 = 2, bottom = 5 − 7 = −2.
    expect(upper.topLevel).toBeCloseTo(2)
    expect(upper.botLevel).toBeCloseTo(-2)
    // Lower: top = 5 − 7 = −2, bottom = 5 − 10 = −5 (investigation bottom).
    expect(lower.topLevel).toBeCloseTo(-2)
    expect(lower.botLevel).toBeCloseTo(-5)
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
    armedContactSide: 'top',
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
    expect(gesture.onArmContact).toHaveBeenCalledWith('ca', 'top')
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
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb1', 'top')
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
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb2', 'top')
  })

  it('CE-THIN: a thin band INTERIOR arms its own top — never one band low', () => {
    // Debt #158, owner mis-click 2026-08-04/05: on a ~10px band the midpoint
    // split handed the lower half to the NEXT-DEEPER contact — aiming at the
    // thin CLAY-SF armed the SILT below it, one band low, twice in one week.
    // An interior strike (a few px below the aimed-at top line) must arm the
    // band's OWN top; only the base LINE itself (the bottom few px) arms the
    // boundary below (owner 2026-08-07 — see CE-BASE).
    const thinContacts = [
      makeContact('t1', 'f-a', 'inv-B', 'cpt', 2.0),
      makeContact('t2', 'f-a', 'inv-B', 'cpt', 3.0), // 10px band above → THIN
      makeContact('t3', 'f-a', 'inv-B', 'cpt', 8.0), // fat band between t2..t3
    ]
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: thinContacts,
      formations: [fA],
      placedColumns: [makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    // The interior (everything above the 4px base-line grab) arms t1's top…
    const rect = screen.getByTestId('contact-hit-t1')
    expect(Number(rect.getAttribute('height'))).toBeCloseTo(6, 0)
    fireEvent.click(rect)
    expect(gesture.onArmContact).toHaveBeenCalledWith('t1', 'top')
    expect(gesture.onArmContact).not.toHaveBeenCalledWith('t2', 'top')
    // …and the boundary below stays reachable via the deeper band's upper zone.
    fireEvent.click(screen.getByTestId('contact-hit-t2'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('t2', 'top')
  })

  it('CE-BASE: clicking the BOTTOM of a thin band arms its base line, not its top', () => {
    // Owner 2026-08-07: "I click the bottom of a clay unit but the correlation
    // drew from the top." The whole-band-arms-top rule had erased base
    // targeting on every band under 28px; the base LINE now keeps a small
    // grab that arms the boundary below.
    const thinContacts = [
      makeContact('t1', 'f-a', 'inv-B', 'cpt', 2.0),
      makeContact('t2', 'f-a', 'inv-B', 'cpt', 3.0),
      makeContact('t3', 'f-a', 'inv-B', 'cpt', 8.0),
    ]
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: thinContacts,
      formations: [fA],
      placedColumns: [makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    const low = screen.getByTestId('contact-hit-t1-low')
    expect(Number(low.getAttribute('height'))).toBeCloseTo(4, 0)
    fireEvent.click(low)
    expect(gesture.onArmContact).toHaveBeenCalledWith('t2', 'top')
    expect(gesture.onArmContact).not.toHaveBeenCalledWith('t1', 'top')
  })

  it('CE-HOVER: hovering a zone previews the boundary line a click would arm', () => {
    // The thin-band ambiguity is resolved by FEEDBACK, not just zones: before
    // the click commits, the target boundary lights up dashed (owner
    // 2026-08-07 — a wrong tie should be visible before it is drawn).
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
    expect(screen.queryByTestId('contact-arm-preview')).toBeNull()
    // Hovering cb1's LOWER zone previews cb2's line (the boundary below).
    fireEvent.mouseEnter(screen.getByTestId('contact-hit-cb1-low'))
    const preview = screen.getByTestId('contact-arm-preview')
    const cb2Y = Number(preview.getAttribute('y1'))
    expect(Number(preview.getAttribute('y2'))).toBe(cb2Y)
    // Leaving clears it.
    fireEvent.mouseLeave(screen.getByTestId('contact-hit-cb1-low'))
    expect(screen.queryByTestId('contact-arm-preview')).toBeNull()
    // Hovering the UPPER zone previews the band's own top line.
    fireEvent.mouseEnter(screen.getByTestId('contact-hit-cb1'))
    expect(screen.getByTestId('contact-arm-preview')).not.toBeNull()
  })

  it('CE-THIN-DEEPEST: a thin DEEPEST band keeps its base zone — no alternative target exists', () => {
    // The base tie has no twin zone below (there is no deeper band), so the
    // midpoint split survives on the deepest band even when it is thin.
    const thinContacts = [
      makeContact('d1', 'f-a', 'inv-B', 'cpt', 2.0),
      makeContact('d2', 'f-a', 'inv-B', 'cpt', 3.0), // deepest, 10px to TD…
    ]
    const gesture = makeContactGestureState()
    renderOverlay({
      contacts: thinContacts,
      formations: [fA],
      placedColumns: [makeColumn('inv-B', 200, 10, 4)], // TD 4 m → thin deepest band
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-d2-low'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('d2', 'base')
  })

  it('CE-HIT-DEEPEST-LOW: the deepest band’s lower zone arms the unit BASE (bottom-tie)', () => {
    // cb2 (inv-B, 5 m) is the DEEPEST contact on its column — its base is the
    // column floor. Pre base-side support this zone was INERT to avoid grabbing
    // cb2's own top (dogfeed 2026-06-08). Now that the bottom-tie exists, the
    // zone arms cb2's BASE (side='base') — the generous bottom hit-target the
    // 12px floor marker alone couldn't provide (dogfeed 2026-06-19). It must
    // NOT arm the top.
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
    fireEvent.click(screen.getByTestId('contact-hit-cb2-low'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb2', 'base')
    expect(gesture.onArmContact).not.toHaveBeenCalledWith('cb2', 'top')
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CE-HIT-MID: clicking a tall band’s inert middle arms nothing', () => {
    // ca is the only contact on inv-A, so its band spans most of the column →
    // tall enough to have an inert middle zone. A click there must NOT arm a
    // far boundary (dogfeed 2026-05-29: mid-band clicks used to arm the band's
    // far edge).
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
    fireEvent.click(screen.getByTestId('contact-hit-ca-mid'))
    expect(gesture.onArmContact).not.toHaveBeenCalled()
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
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
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb1', 'top', 'top')
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
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb2', 'top', 'top')
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
    expect(gesture.onArmContact).toHaveBeenCalledWith('ca-alt', 'top')
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
    expect(gesture.onArmContact).toHaveBeenCalledWith('cc', 'top')
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
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb3', 'top', 'top')
  })

  // -------------------------------------------------------------------
  // CC-BH: bottom-of-test handle (base-side arm gesture)
  // -------------------------------------------------------------------

  it('CC-BH1: bottom handle renders in correlate mode', () => {
    // The deepest contact on inv-A is 'ca' (only one contact at depth 2 m).
    // A bottom handle should appear at the base of that column.
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
    // The handle is keyed by investigation id ('inv-A'), not contact id.
    expect(screen.getByTestId('correlate-bottom-handle-inv-A')).toBeTruthy()
  })

  it('CC-BH2: bottom handle does NOT render outside correlate mode', () => {
    const gesture = makeContactGestureState({ contactCorrelateMode: false })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    expect(screen.queryByTestId('correlate-bottom-handle-inv-A')).toBeNull()
  })

  it('CC-BH3: clicking bottom handle when nothing armed → onArmContact with side="base"', () => {
    // Nothing armed yet; clicking inv-B's bottom handle should arm cb2
    // (the deepest contact on inv-B, at depth 5 m) with side='base'.
    const gesture = makeContactGestureState({ armedContactId: null })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('correlate-bottom-handle-inv-B'))
    // cb2 is the deepest on inv-B (depth 5 m > cb1 depth 2 m).
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb2', 'base')
    expect(gesture.onContactCorrelate).not.toHaveBeenCalled()
  })

  it('CC-BH4: clicking bottom handle when a band is armed → onContactCorrelate with correct sides', () => {
    // ca (inv-A) is armed via a band click (side='top').
    // Clicking inv-B's bottom handle fires a top↔base correlation.
    const gesture = makeContactGestureState({
      armedContactId: 'ca',
      armedContactSide: 'top',
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
    fireEvent.click(screen.getByTestId('correlate-bottom-handle-inv-B'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('ca', 'cb2', 'top', 'base')
    expect(gesture.onArmContact).not.toHaveBeenCalled()
  })

  it('CC-BH5: arming a contact BASE does not light its band top (dogfeed 2026-06-19)', () => {
    // Arming the bottom-of-test handle (side='base') must NOT light the unit's
    // TOP boundary — only the floor marker lights. Lighting the top made
    // clicking the bottom marker look like it "selected the upper boundary".
    const baseArmed = makeContactGestureState({ armedContactId: 'cb2', armedContactSide: 'base' })
    const r1 = renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: baseArmed,
    })
    // The contact-hit rect stroke is 'transparent' when NOT armed-at-top.
    expect(screen.getByTestId('contact-hit-cb2').getAttribute('stroke')).toBe('transparent')
    r1.unmount()

    // Arming the SAME contact's TOP DOES light its band top (unchanged).
    const topArmed = makeContactGestureState({ armedContactId: 'cb2', armedContactSide: 'top' })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: topArmed,
    })
    expect(screen.getByTestId('contact-hit-cb2').getAttribute('stroke')).not.toBe('transparent')
  })

  it('CC-BH6: clicking two bottom handles fires a base↔base correlation (dogfeed 2026-06-19)', () => {
    // cb2 (deepest on inv-B) armed at its base; clicking inv-C's bottom handle
    // (deepest = cc) fires a base↔base tie — the bottom-to-bottom gesture.
    const gesture = makeContactGestureState({
      armedContactId: 'cb2',
      armedContactSide: 'base',
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
    fireEvent.click(screen.getByTestId('correlate-bottom-handle-inv-C'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('cb2', 'cc', 'base', 'base')
    expect(gesture.onArmContact).not.toHaveBeenCalled()
  })

  it('CC-BH7: deepest band lower zone arms the BASE (generous bottom hit-target, dogfeed 2026-06-19)', () => {
    // The 12px floor marker was too small to hit reliably; the deepest band's
    // lower half now arms the unit's base (side='base'). cb2 is the deepest on
    // inv-B → its lower zone is the base, not the inert-or-next-deeper case.
    const gesture = makeContactGestureState({ armedContactId: null })
    renderOverlay({
      contacts: baseContacts,
      formations: [fA],
      placedColumns: baseColumns,
      levelToScreen: makeLevelToScreen(),
      plotTop: 20,
      plotBottom: 200,
      contactGestureState: gesture,
    })
    fireEvent.click(screen.getByTestId('contact-hit-cb2-low'))
    expect(gesture.onArmContact).toHaveBeenCalledWith('cb2', 'base')
  })

  it('CC-BH8: deepest lower zone → deepest lower zone fires base↔base (bottom-to-bottom via the band)', () => {
    // cb2's base armed; clicking inv-C's deepest band lower zone (cc's base)
    // fires a base↔base tie — the bottom-to-bottom gesture the marker alone
    // made too fiddly.
    const gesture = makeContactGestureState({
      armedContactId: 'cb2',
      armedContactSide: 'base',
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
    fireEvent.click(screen.getByTestId('contact-hit-cc-low'))
    expect(gesture.onContactCorrelate).toHaveBeenCalledWith('cb2', 'cc', 'base', 'base')
    expect(gesture.onArmContact).not.toHaveBeenCalled()
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
      layer_a_id: 'ca',
      layer_b_id: 'cb1',
      model_id: 'm1',
      section_id: 's1',
      source: 'auto',
      user_approved: false,
      layer_a_side: 'top',
      layer_b_side: 'top',
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
      layer_a_id: 'ca',
      layer_b_id: 'cb1',
      model_id: 'm1',
      section_id: 's1',
      source: 'auto',
      user_approved: false,
      layer_a_side: 'top',
      layer_b_side: 'top',
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
  const mk = (id: string, a: string, b: string): LithoContactCorrelationEdge => ({
    id,
    layer_a_id: a,
    layer_b_id: b,
    model_id: 'm1',
    section_id: 's1',
    source: 'manual',
    user_approved: true,
    layer_a_side: 'top',
    layer_b_side: 'top',
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

// ---------------------------------------------------------------------------
// Base-side tie rendering + delete (spec §6 bug fixes 2026-06-18)
//
//   BT1  A base↔base edge renders its endpoints at botY (band bottom), not topY.
//   BT2  A mixed (top↔base) edge: endpoint A at topY, endpoint B at botY.
//   BT3  A top↔top edge still renders at topY (regression).
//   BT4  A base/mixed edge carries stroke-dasharray (interpretive).
//   BT5  A top↔top approved edge does NOT carry stroke-dasharray (regression).
//   BT6  Right-click a base-side ribbon → onRequestDeleteEdge receives the full
//        edge object with correct layer_a_side / layer_b_side.
// ---------------------------------------------------------------------------

describe('CorrelationEdgesOverlay — base-side ties (spec §6 bug fixes)', () => {
  // Setup: two columns, each with a single contact at depth 2 m.
  // Surface elevation = 10 m, max_depth = 20 m.
  // levelToScreen: plotTop=20, surfaceLevel=10, scale=10
  //   → topY(contact at 2 m depth) = 20 + (10 − 8) * 10 = 40
  //       where topLevel = 10 − 2 = 8
  //   → botY (investigation bottom at 20 m depth) = 20 + (10 − −10) * 10 = 220
  //       where botLevel = 10 − 20 = −10
  const level2screen = makeLevelToScreen(10, 20, 10)
  const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
  const contacts = [
    makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
    makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
  ]
  const columns = [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)]

  function makeEdge(
    id: string,
    aSide: 'top' | 'base',
    bSide: 'top' | 'base',
    approved = true,
  ): LithoContactCorrelationEdge {
    return {
      id,
      layer_a_id: 'ca',
      layer_b_id: 'cb',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: approved,
      layer_a_side: aSide,
      layer_b_side: bSide,
      created_at: '2026-01-01T00:00:00Z',
    }
  }

  // BT1: a base↔base edge has both y-coords at the band bottom.
  it('BT1: base↔base edge renders both endpoints at the band bottom Y', () => {
    const edge = makeEdge('e-bb', 'base', 'base')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
    })
    // The ribbon seam spans the gap between the columns' inner edges.
    // inv-A: centre 100, width 40, inner right edge = 120.
    // inv-B: centre 200, width 40, inner left  edge = 180.
    // band: topLevel = 10 − 2 = 8 → topY = 20 + (10−8)*10 = 40.
    // band: botLevel = 10 − 20 = −10 → botY = 20 + (10−(−10))*10 = 220.
    const seam = screen.getByTestId('ribbon-seam-e-bb')
    // Seam is a warp-aware <polyline>; endpoint Ys are the first/last vertices.
    const pts = (seam.getAttribute('points') ?? '').trim().split(/\s+/)
    const y1 = Number(pts[0].split(',')[1])
    const y2 = Number(pts[pts.length - 1].split(',')[1])
    // Both ends should be at the botY (≈220), NOT the topY (≈40).
    expect(y1).toBeCloseTo(220, 0)
    expect(y2).toBeCloseTo(220, 0)
  })

  // BT2: mixed top↔base edge: A at topY, B at botY.
  it('BT2: mixed top↔base edge — A endpoint at topY, B at botY', () => {
    const edge = makeEdge('e-tb', 'top', 'base')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
    })
    const seam = screen.getByTestId('ribbon-seam-e-tb')
    // Seam is a warp-aware <polyline>; endpoint Ys are the first/last vertices.
    const pts = (seam.getAttribute('points') ?? '').trim().split(/\s+/)
    const y1 = Number(pts[0].split(',')[1])
    const y2 = Number(pts[pts.length - 1].split(',')[1])
    // A is 'top' → topY ≈ 40; B is 'base' → botY ≈ 220.
    expect(y1).toBeCloseTo(40, 0)
    expect(y2).toBeCloseTo(220, 0)
  })

  // BT3: regression — a top↔top edge still anchors at topY.
  it('BT3 (regression): top↔top edge still renders both endpoints at topY', () => {
    const edge = makeEdge('e-tt', 'top', 'top')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
      onRequestDeleteEdge: vi.fn(),
    })
    const seam = screen.getByTestId('ribbon-seam-e-tt')
    // Seam is a warp-aware <polyline>; endpoint Ys are the first/last vertices.
    const pts = (seam.getAttribute('points') ?? '').trim().split(/\s+/)
    const y1 = Number(pts[0].split(',')[1])
    const y2 = Number(pts[pts.length - 1].split(',')[1])
    expect(y1).toBeCloseTo(40, 0)
    expect(y2).toBeCloseTo(40, 0)
  })

  // BT4: base/mixed ties carry stroke-dasharray (interpretive signal).
  it('BT4: base↔base edge carries stroke-dasharray on the seam', () => {
    const edge = makeEdge('e-bb2', 'base', 'base')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
    })
    const seam = screen.getByTestId('ribbon-seam-e-bb2')
    const dash = seam.getAttribute('stroke-dasharray')
    expect(dash).not.toBeNull()
    expect(dash).not.toBe('')
  })

  it('BT4b: mixed top↔base edge carries stroke-dasharray', () => {
    const edge = makeEdge('e-tb2', 'top', 'base')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
    })
    const seam = screen.getByTestId('ribbon-seam-e-tb2')
    const dash = seam.getAttribute('stroke-dasharray')
    expect(dash).not.toBeNull()
    expect(dash).not.toBe('')
  })

  // BT5: regression — an approved top↔top edge has NO stroke-dasharray.
  it('BT5 (regression): approved top↔top edge seam has no stroke-dasharray', () => {
    const edge = makeEdge('e-tt2', 'top', 'top', true)
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
    })
    const seam = screen.getByTestId('ribbon-seam-e-tt2')
    // An approved top↔top seam is a solid line — no dasharray attribute
    // (or null / empty string).
    const dash = seam.getAttribute('stroke-dasharray')
    expect(!dash || dash === '').toBe(true)
  })

  // BT6: right-click delete on a base↔base ribbon passes the full edge
  // object including layer_a_side / layer_b_side to onRequestDeleteEdge.
  it('BT6: right-click base↔base ribbon → onRequestDeleteEdge receives edge with correct sides', () => {
    const onRequestDeleteEdge = vi.fn()
    const edge = makeEdge('e-bb3', 'base', 'base')
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: columns,
      levelToScreen: level2screen,
      plotTop: 20, plotBottom: 300,
      contactEdges: [edge],
      onRequestDeleteEdge,
    })
    // The approved base↔base ribbon has an edge-hit polygon for right-click.
    const hitTarget = screen.getByTestId('edge-hit-e-bb3')
    fireEvent.contextMenu(hitTarget)
    // EdgeContextMenu should open with the delete option.
    const deleteBtn = screen.getByText(/Delete correlation/i, { selector: 'button' })
    fireEvent.click(deleteBtn)
    expect(onRequestDeleteEdge).toHaveBeenCalledOnce()
    const receivedEdge = onRequestDeleteEdge.mock.calls[0][0] as LithoContactCorrelationEdge
    expect(receivedEdge.id).toBe('e-bb3')
    expect(receivedEdge.layer_a_side).toBe('base')
    expect(receivedEdge.layer_b_side).toBe('base')
  })
})
