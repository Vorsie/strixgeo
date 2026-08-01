// A geotech tie that is still waiting for review must LOOK unreviewed.
//
// Auto-correlate now proposes geotech ties as unapproved suggestions, so the engineer
// has to be able to tell at a glance which ties on a geotech section he drew and which
// the machine is proposing. On the litho axis that cue is the amber dashed outline; the
// question this file answers is whether that cue is driven by the edge's own
// ``user_approved`` flag or by an axis check somewhere in the render path.
//
// The edges are handed in through ``overlayEdgeSource`` rather than straight to the
// overlay, because on the geotech axis SectionPanel feeds the overlay the SEPARATE
// geotech edge list — routing the test through the real selector keeps the proof honest
// about which list actually reaches the render.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import CorrelationEdgesOverlay from './CorrelationEdgesOverlay'
import { overlayEdgeSource } from './correlationOverlayAxis'
import type { PlacedColumn } from './utils'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import type {
  CptListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
} from '../../api/client'

afterEach(() => cleanup())

// The amber the section view uses everywhere for "not yet accepted".
const PENDING_AMBER = '#f59e0b'

function makeFormation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#fbbf24',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: 12,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: null,
    instance_ordinal: 1,
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
  depthTopM: number,
): FormationContactResponse {
  return {
    id,
    model_id: 'geotech-model-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: investigationId,
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

function makeColumn(investigationId: string, nudgedX: number, alongM: number): PlacedColumn {
  return {
    kind: 'cpt',
    proj: {
      item: makeCptListItem(investigationId, 10),
      along: alongM,
      offset: 0,
    } as ProjectedInvestigation<CptListItem>,
    trueX: nudgedX,
    nudgedX,
    width: 40,
    displaced: false,
  }
}

function makeGeotechEdge(id: string, approved: boolean): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: 'ca',
    layer_b_id: 'cb',
    model_id: 'geotech-model-1',
    section_id: 'sec-1',
    source: approved ? 'manual' : 'auto',
    user_approved: approved,
    layer_a_side: 'top',
    layer_b_side: 'top',
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** Render the overlay exactly as the geotech axis feeds it. */
function renderGeotechAxis(edges: readonly LithoContactCorrelationEdge[]) {
  const formation = makeFormation('f-nad-12', 'NAD 12')
  return render(
    <svg>
      <CorrelationEdgesOverlay
        contacts={[
          makeContact('ca', 'f-nad-12', 'inv-A', 2.0),
          makeContact('cb', 'f-nad-12', 'inv-B', 2.0),
        ]}
        formations={[formation]}
        placedColumns={[makeColumn('inv-A', 100, 5), makeColumn('inv-B', 200, 20)]}
        levelToScreen={(level: number) => 20 + (10 - level) * 10}
        plotTop={20}
        plotBottom={200}
        // The litho list is deliberately non-empty and approved: if the render read it
        // instead of the geotech list, the pending cue would silently disappear.
        contactEdges={overlayEdgeSource(
          'geotechnical',
          [{ ...makeGeotechEdge('litho-edge', true), model_id: 'litho-model-1' }],
          edges,
        )}
      />
    </svg>,
  )
}

describe('CorrelationEdgesOverlay — a pending geotech tie reads as pending', () => {
  it('GR1 — an unapproved geotech tie draws the amber dashed outline, not a solid seam', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)])

    const outline = container.querySelector('[data-testid="ribbon-outline-geo-pending"]')
    expect(outline).not.toBeNull()
    expect(outline!.getAttribute('stroke')).toBe(PENDING_AMBER)
    expect(outline!.getAttribute('stroke-dasharray')).toBeTruthy()
    // The solid seam belongs to accepted work only.
    expect(container.querySelector('[data-testid="ribbon-seam-geo-pending"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="ribbon-geo-pending"]')!.getAttribute('data-approved'),
    ).toBe('false')
  })

  it('GR2 — an accepted geotech tie draws the solid seam and no amber outline (control)', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-approved', true)])

    expect(container.querySelector('[data-testid="ribbon-seam-geo-approved"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ribbon-outline-geo-approved"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="ribbon-geo-approved"]')!.getAttribute('data-approved'),
    ).toBe('true')
  })

  it('GR3 — the geotech axis renders the geotech list, so the flag under test is the geotech edge’s', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)])

    // The approved litho edge passed alongside must not appear on this axis.
    expect(container.querySelector('[data-testid="ribbon-litho-edge"]')).toBeNull()
  })
})
