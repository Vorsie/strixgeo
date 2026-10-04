/**
 * Shared scene for the CorrelationEdgesOverlay tests.
 *
 * Two CPT columns 15 m apart, one NAD-12 band each at the same depth, rendered
 * through `overlayEdgeSource` on the geotech axis — so a test proves something
 * about the list SectionPanel actually feeds the overlay, not about a list handed
 * straight to the component.
 *
 * Extracted when the second test file needed it; both import from here so the
 * scene has one definition.
 */

import { render } from '@testing-library/react'

import CorrelationEdgesOverlay from '../CorrelationEdgesOverlay'
import { overlayEdgeSource } from '../correlationOverlayAxis'
import type { PlacedColumn } from '../utils'
import type { ProjectedInvestigation } from '../../../utils/sectionProjection'
import type {
  CptListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'

export function makeFormation(id: string, name: string): GeologicalFormationResponse {
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

export function makeContact(
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

export function makeCptListItem(id: string, elevationM: number): CptListItem {
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

export function makeColumn(investigationId: string, nudgedX: number, alongM: number): PlacedColumn {
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

export function makeGeotechEdge(id: string, approved: boolean): LithoContactCorrelationEdge {
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
/** Handlers a test may wire; omitted ones stay undefined, as in the real absent case. */
export interface GeotechAxisHandlers {
  onRequestDeleteEdge?: (edge: LithoContactCorrelationEdge) => void
  onRequestConfirmEdgeReview?: (edge: LithoContactCorrelationEdge) => void
  onRequestAcceptEdge?: (edge: LithoContactCorrelationEdge) => void
  /** Edge the pending-tie chip just centred, and which must therefore pulse. */
  flashEdgeId?: string | null
  /** Stamped body id per band (layer) id — what SectionPanel passes. */
  bodyIdByLayerId?: ReadonlyMap<string, string | null>
}

export function renderGeotechAxis(
  edges: readonly LithoContactCorrelationEdge[],
  handlers: GeotechAxisHandlers = {},
) {
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
        onRequestDeleteEdge={handlers.onRequestDeleteEdge}
        onRequestConfirmEdgeReview={handlers.onRequestConfirmEdgeReview}
        onRequestAcceptEdge={handlers.onRequestAcceptEdge}
        // What SectionsCanvas passes on this axis — the scene must feed the
        // overlay what the geotech axis actually does, or the wording under test
        // is the test's own.
        acceptEdgeLabel="Accept tie"
        flashEdgeId={handlers.flashEdgeId ?? null}
        bodyIdByLayerId={handlers.bodyIdByLayerId}
      />
    </svg>,
  )
}

/**
 * The JUMP-TIE scene: A — M — B, where the tie joins A to B over M.
 *
 * Step 2 of the packing pipeline proposes ties across columns that carry no
 * packing yet, so a tie whose endpoints are NOT neighbours is ordinary on the
 * geotech axis. M sits between them on screen (x 150) and in along-metres
 * (12.5 of 5..20) — deliberately NOT at the same fraction of each, because a
 * straight screen segment between A and B would still pass through a column
 * placed proportionally and the test would prove nothing.
 *
 * Only A and B carry contacts: M is the undivided column the tie jumps.
 */
export function renderGeotechJumpAxis(
  edges: readonly LithoContactCorrelationEdge[],
  handlers: GeotechAxisHandlers = {},
) {
  const formation = makeFormation('f-nad-12', 'NAD 12')
  return render(
    <svg>
      <CorrelationEdgesOverlay
        contacts={[
          makeContact('ca', 'f-nad-12', 'inv-A', 2.0),
          makeContact('cb', 'f-nad-12', 'inv-B', 6.0),
        ]}
        formations={[formation]}
        placedColumns={[
          makeColumn('inv-A', 100, 5),
          // M: screen-fraction 0.5 of 100..200 but ALONG-fraction 0.2 of
          // 5..20 — deliberately different, so a bend whose y interpolates by
          // SCREEN position cannot pass the y assertions (review MINOR-2).
          makeColumn('inv-M', 150, 8),
          makeColumn('inv-B', 200, 20),
        ]}
        levelToScreen={(level: number) => 20 + (10 - level) * 10}
        plotTop={20}
        plotBottom={200}
        contactEdges={overlayEdgeSource('geotechnical', [], edges)}
        onRequestDeleteEdge={handlers.onRequestDeleteEdge}
        onRequestConfirmEdgeReview={handlers.onRequestConfirmEdgeReview}
        onRequestAcceptEdge={handlers.onRequestAcceptEdge}
        // What SectionsCanvas passes on this axis — the scene must feed the
        // overlay what the geotech axis actually does, or the wording under test
        // is the test's own.
        acceptEdgeLabel="Accept tie"
      />
    </svg>,
  )
}

