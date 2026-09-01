// Render-level net for the crossed-formation subtitle on the units roster AND
// the selectable body children.
//
// The tree arithmetic (which formations a class row lists, which bodies sit
// under it) is pinned in geotechUnitTree.test.ts; this file pins the WIRING —
// that the roster builds the crossed-formation map from its ``geotechBodies``
// prop and renders the joined list as a subtitle (debt #278, R2), and that a
// class row expands to selectable BODY children the engineer can click (owner
// dogfeed 2026-09-01: "i can only see packing but can't select the subbodies
// there").

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerConfidence,
  LithoLayerResponse,
} from '../../../api/client'
import GeotechnicalUnitRoster from './GeotechnicalUnitRoster'

afterEach(() => cleanup())

/** A geotech unit (formation row) with just the fields the roster reads. */
function unit(
  id: string,
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'p1',
    name: `${id} (geotech)`,
    color: '#aabbcc',
    code: null,
    display_order: 0,
    lithology: 'ZAND',
    nad_class: 6,
    regional_ref: null,
    description: null,
    pinned_order: false,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** One accepted band for a unit — what keeps its row on the roster. */
function contact(id: string, formationId: string): FormationContactResponse {
  return {
    id,
    model_id: 'geotech-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: 1.0,
    source: 'manual_pick',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** A body row carrying the crossed-formation list for a unit. */
function body(overrides: Partial<BodyListItem>): BodyListItem {
  return {
    id: 'b1',
    app_project_id: 'p1',
    model_id: 'geotech-1',
    formation_id: 'u1',
    body_ordinal: 0,
    source_investigation_id: 'inv',
    name: null,
    primary_section_id: null,
    content_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('the units roster surfaces the crossed-formation subtitle (R2)', () => {
  it('renders the joined formation names on a class row whose unit crosses two', () => {
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[contact('c1', 'u1')]}
        geotechLayers={[]}
        lithoFormations={[]}
        geotechBodies={[
          body({
            formation_id: 'u1',
            geo_formations: [
              { id: 'g1', name: 'Holoceen' },
              { id: 'g2', name: 'Pleistoceen' },
            ],
          }),
        ]}
        onPickColor={vi.fn()}
      />,
    )

    // A class carried by one unit answers to that unit's id.
    const subtitle = screen.getByTestId('geotech-class-geo-u1')
    expect(subtitle.textContent).toBe('Holoceen + Pleistoceen')
  })

  it('renders NO subtitle element on a row whose unit crosses nothing', () => {
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[contact('c1', 'u1')]}
        geotechLayers={[]}
        lithoFormations={[]}
        geotechBodies={[]}
        onPickColor={vi.fn()}
      />,
    )

    // The row is present, but the subtitle is absent — not an empty element.
    expect(screen.getByTestId('geotech-unit-row-u1')).toBeTruthy()
    expect(screen.queryByTestId('geotech-class-geo-u1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RB — selectable body children (owner dogfeed 2026-09-01: "i can only see
// packing but can't select the subbodies there")
// ---------------------------------------------------------------------------

let _rbSeq = 0
/** ``n`` accepted layers stamped to a body — its band count on the child row. */
function rbBodyLayer(
  formationId: string,
  bodyId: string,
  confidence: LithoLayerConfidence = 'high',
): LithoLayerResponse {
  _rbSeq += 1
  return {
    id: `rb-layer-${_rbSeq}`,
    model_id: 'geotech-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'c1',
    depth_top_m: 1,
    depth_base_m: 3,
    status: 'accepted',
    source: 'segmenter',
    confidence,
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: '',
    updated_at: '',
  } as LithoLayerResponse
}

/** One SAND·MD (NAD 6) unit with two geotech bodies gbA (2 bands) / gbB (1 band). */
function rbScene(
  over: { selectedBodyId?: string | null; onSelectBody?: (id: string) => void } = {},
) {
  return render(
    <GeotechnicalUnitRoster
      geotechFormations={[unit('u')]}
      geotechContacts={[contact('k1', 'u'), contact('k2', 'u'), contact('k3', 'u')]}
      geotechLayers={[rbBodyLayer('u', 'gbA'), rbBodyLayer('u', 'gbA'), rbBodyLayer('u', 'gbB')]}
      lithoFormations={[]}
      geotechBodies={[
        body({ id: 'gbA', formation_id: 'u', body_ordinal: 0 }),
        body({ id: 'gbB', formation_id: 'u', body_ordinal: 1 }),
      ]}
      onPickColor={vi.fn()}
      selectedBodyId={over.selectedBodyId ?? null}
      onSelectBody={over.onSelectBody ?? vi.fn()}
    />,
  )
}

describe('GeotechnicalUnitRoster — selectable body children (RB)', () => {
  it('RB1 — a class row with bodies is expandable and its body rows are collapsed', () => {
    rbScene()
    expect(screen.getByTestId('geotech-class-expander-SAND|6')).toBeTruthy()
    expect(screen.queryByTestId('geotech-body-row-gbA')).toBeNull()
  })

  it('RB2 — expanded, each body reads the unified label + its band count', () => {
    rbScene()
    fireEvent.click(screen.getByTestId('geotech-class-expander-SAND|6'))

    const rowA = screen.getByTestId('geotech-body-row-gbA')
    const rowB = screen.getByTestId('geotech-body-row-gbB')
    expect(rowA.textContent).toContain('SAND · MD #0')
    expect(rowA.textContent).toContain('2')
    expect(rowB.textContent).toContain('SAND · MD #1')
    expect(rowB.textContent).toContain('1')
  })

  it('RB3 — clicking a body row selects that body', () => {
    const onSelectBody = vi.fn()
    rbScene({ onSelectBody })
    fireEvent.click(screen.getByTestId('geotech-class-expander-SAND|6'))
    fireEvent.click(screen.getByTestId('geotech-body-row-gbA'))
    expect(onSelectBody).toHaveBeenCalledWith('gbA')
  })

  it('RB4 — the selected body’s row carries the selection ring', () => {
    rbScene({ selectedBodyId: 'gbA' })
    fireEvent.click(screen.getByTestId('geotech-class-expander-SAND|6'))
    expect(screen.getByTestId('geotech-body-row-gbA').className).toContain('bg-blue-50')
    expect(screen.getByTestId('geotech-body-row-gbB').className).not.toContain('bg-blue-50')
  })
})
