// Render-level net for the geotech units roster — soil ▸ litho body ▸ packing
// body (owner ruling 2026-08-31 walk interview).
//
// The tree arithmetic (which litho body a packing body homes under, the leaf
// labels, the group tag) is pinned in geotechUnitTree.test.ts; this file pins
// the WIRING — that the roster maps its props into that tree and renders the
// three levels, that a packing-body leaf is selectable and carries its badges /
// crossed-formations / group tag / colour swatch, and that the null-parent
// packing body lands in the ungrouped bucket rather than vanishing.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyListItem,
  BodyUnionListItem,
  GeologicalFormationResponse,
  LithoLayerConfidence,
  LithoLayerResponse,
} from '../../../api/client'
import GeotechnicalUnitRoster from './GeotechnicalUnitRoster'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Scene builders
// ---------------------------------------------------------------------------

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

/** A body row (geotech or litho) with just the fields the roster reads. */
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
    parent_litho_body_id: null,
    content_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

let _layerSeq = 0
/** ``n`` accepted layers stamped to a geotech body — its leaf band count + badge. */
function bodyLayers(
  formationId: string,
  bodyId: string,
  n: number,
  confidence: LithoLayerConfidence = 'high',
): LithoLayerResponse[] {
  return Array.from({ length: n }, () => {
    _layerSeq += 1
    return {
      id: `layer-${_layerSeq}`,
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
  })
}

/** One union pair between two geotech bodies (the "(group N)" source). */
function union(
  aId: string,
  aOrd: number,
  bId: string,
  bOrd: number,
): BodyUnionListItem {
  return {
    id: `${aId}-${bId}`,
    model_id: 'geotech-1',
    layer_a_id: `la-${aId}`,
    layer_b_id: `lb-${bId}`,
    anchor_a: {
      layer_id: `la-${aId}`,
      body_id: aId,
      body_name: null,
      body_ordinal: aOrd,
      formation_id: 'u1',
    },
    anchor_b: {
      layer_id: `lb-${bId}`,
      body_id: bId,
      body_name: null,
      body_ordinal: bOrd,
      formation_id: 'u1',
    },
    created_at: '',
  }
}

/** A SAND unit u1 (NAD 6) with two disconnected litho bodies (lbX, lbY), each
 *  carrying one packing body (gbA under lbX, gbB under lbY). */
function twoBodyScene(
  over: {
    selectedBodyId?: string | null
    onSelectBody?: (id: string) => void
    onPickColor?: (ids: readonly string[], c: string | null) => void
    bodyUnions?: BodyUnionListItem[]
  } = {},
) {
  return render(
    <GeotechnicalUnitRoster
      geotechFormations={[unit('u1')]}
      geotechContacts={[]}
      geotechLayers={[...bodyLayers('u1', 'gbA', 2), ...bodyLayers('u1', 'gbB', 1)]}
      lithoFormations={[unit('lu', { name: 'SAND' })]}
      geotechBodies={[
        body({ id: 'gbA', formation_id: 'u1', body_ordinal: 0, parent_litho_body_id: 'lbX' }),
        body({ id: 'gbB', formation_id: 'u1', body_ordinal: 1, parent_litho_body_id: 'lbY' }),
      ]}
      lithoBodies={
        new Map([
          ['lbX', body({ id: 'lbX', model_id: 'litho-1', formation_id: 'lu', body_ordinal: 0 })],
          ['lbY', body({ id: 'lbY', model_id: 'litho-1', formation_id: 'lu', body_ordinal: 1 })],
        ])
      }
      bodyUnions={over.bodyUnions ?? []}
      onPickColor={over.onPickColor ?? vi.fn()}
      selectedBodyId={over.selectedBodyId ?? null}
      onSelectBody={over.onSelectBody ?? vi.fn()}
    />,
  )
}

// ---------------------------------------------------------------------------
// RB1 — the three levels render
// ---------------------------------------------------------------------------

describe('the roster renders soil ▸ litho body ▸ packing body (RB1)', () => {
  it('RB1a — one soil header, two litho-body nodes, one packing leaf each', () => {
    twoBodyScene()
    expect(screen.getByTestId('geotech-soil-header-SAND')).toBeTruthy()
    // Litho bodies read the way a litho body reads everywhere else.
    expect(screen.getByTestId('geotech-litho-body-SAND|lbX').textContent).toContain('SAND · #0')
    expect(screen.getByTestId('geotech-litho-body-SAND|lbY').textContent).toContain('SAND · #1')
    // Both levels start expanded, so the leaves are visible without a click.
    expect(screen.getByTestId('geotech-body-row-gbA')).toBeTruthy()
    expect(screen.getByTestId('geotech-body-row-gbB')).toBeTruthy()
  })

  it('RB1b — each leaf reads the unified label and its accepted-band count', () => {
    twoBodyScene()
    const rowA = screen.getByTestId('geotech-body-row-gbA')
    const rowB = screen.getByTestId('geotech-body-row-gbB')
    expect(rowA.textContent).toContain('SAND · MD #0')
    expect(rowA.textContent).toContain('2')
    expect(rowB.textContent).toContain('SAND · MD #1')
    expect(rowB.textContent).toContain('1')
  })
})

// ---------------------------------------------------------------------------
// RB2 — selection
// ---------------------------------------------------------------------------

describe('a packing-body leaf is selectable (RB2)', () => {
  it('RB2a — clicking a leaf selects that body', () => {
    const onSelectBody = vi.fn()
    twoBodyScene({ onSelectBody })
    fireEvent.click(screen.getByTestId('geotech-body-row-gbA'))
    expect(onSelectBody).toHaveBeenCalledWith('gbA')
  })

  it('RB2b — the selected leaf carries the selection ring', () => {
    twoBodyScene({ selectedBodyId: 'gbA' })
    expect(screen.getByTestId('geotech-body-row-gbA').className).toContain('bg-blue-50')
    expect(screen.getByTestId('geotech-body-row-gbB').className).not.toContain('bg-blue-50')
  })
})

// ---------------------------------------------------------------------------
// RB3 — the null-parent fallback bucket
// ---------------------------------------------------------------------------

describe('a packing body with no litho parent lands in the ungrouped bucket (RB3)', () => {
  it('RB3a — the null-parent leaf is under an ungrouped node, not dropped', () => {
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[]}
        geotechLayers={bodyLayers('u1', 'gbNull', 1)}
        lithoFormations={[]}
        geotechBodies={[
          body({ id: 'gbNull', formation_id: 'u1', body_ordinal: 0, parent_litho_body_id: null }),
        ]}
        lithoBodies={new Map()}
        onPickColor={vi.fn()}
      />,
    )
    expect(screen.getByTestId('geotech-litho-body-SAND|ungrouped')).toBeTruthy()
    expect(screen.getByTestId('geotech-body-row-gbNull')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// RB4 — the crossed-formation subtitle rides the leaf
// ---------------------------------------------------------------------------

describe('the crossed-formation subtitle rides the packing leaf (RB4)', () => {
  it('RB4a — a leaf whose body crosses two formations shows the joined list', () => {
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[]}
        geotechLayers={bodyLayers('u1', 'gbA', 1)}
        lithoFormations={[unit('lu', { name: 'SAND' })]}
        geotechBodies={[
          body({
            id: 'gbA',
            formation_id: 'u1',
            body_ordinal: 0,
            parent_litho_body_id: 'lbX',
            geo_formations: [
              { id: 'g1', name: 'Holoceen' },
              { id: 'g2', name: 'Pleistoceen' },
            ],
          }),
        ]}
        lithoBodies={new Map([['lbX', body({ id: 'lbX', formation_id: 'lu', body_ordinal: 0 })]])}
        onPickColor={vi.fn()}
      />,
    )
    expect(screen.getByTestId('geotech-body-geo-gbA').textContent).toBe('Holoceen + Pleistoceen')
  })

  it('RB4b — a leaf whose body crosses nothing renders no subtitle element', () => {
    twoBodyScene()
    expect(screen.queryByTestId('geotech-body-geo-gbA')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RB5 — the manual-group tag (D4)
// ---------------------------------------------------------------------------

describe('a grouped packing body shows its "(group N)" tag (RB5)', () => {
  it('RB5a — a body in a union group carries the tag; a singleton does not', () => {
    // gbA joined to gbB → both are group 1.
    twoBodyScene({ bodyUnions: [union('gbA', 0, 'gbB', 1)] })
    expect(screen.getByTestId('geotech-body-group-gbA').textContent).toContain('group 1')
    expect(screen.getByTestId('geotech-body-group-gbB').textContent).toContain('group 1')
  })

  it('RB5b — with no unions, no leaf shows a group tag', () => {
    twoBodyScene()
    expect(screen.queryByTestId('geotech-body-group-gbA')).toBeNull()
    expect(screen.queryByTestId('geotech-body-group-gbB')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RB6 — badges ride the leaf
// ---------------------------------------------------------------------------

describe('the provenance / confidence badges ride the leaf (RB6)', () => {
  it('RB6a — a body with a low fallback layer shows "No CPT (partial)" + Low', () => {
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[]}
        geotechLayers={[...bodyLayers('u1', 'gbA', 2, 'high'), ...bodyLayers('u1', 'gbA', 1, 'low')]}
        lithoFormations={[unit('lu', { name: 'SAND' })]}
        geotechBodies={[
          body({ id: 'gbA', formation_id: 'u1', body_ordinal: 0, parent_litho_body_id: 'lbX' }),
        ]}
        lithoBodies={new Map([['lbX', body({ id: 'lbX', formation_id: 'lu', body_ordinal: 0 })]])}
        onPickColor={vi.fn()}
      />,
    )
    expect(screen.getByTestId('partial-cpt-badge-gbA').textContent).toBe('No CPT (partial)')
    expect(screen.getByTestId('confidence-badge-gbA').textContent).toContain('Low')
  })

  it('RB6b — an all-cone body carries no provenance badge (the norm)', () => {
    twoBodyScene()
    expect(screen.queryByTestId('partial-cpt-badge-gbA')).toBeNull()
    expect(screen.queryByTestId('no-cpt-badge-gbA')).toBeNull()
    expect(screen.getByTestId('confidence-badge-gbA').textContent).toContain('High')
  })
})

// ---------------------------------------------------------------------------
// RB7 — the colour swatch edits the home unit
// ---------------------------------------------------------------------------

describe('the leaf swatch edits the home geotech unit colour (RB7)', () => {
  it('RB7a — the swatch draws the NAD colour and offers no reset when nobody picked', () => {
    twoBodyScene()
    const swatch = screen.getByTestId('geotech-body-swatch-gbA')
    // nad_class 6 → #d4b84a → rgb(212, 184, 74).
    expect((swatch as HTMLElement).style.backgroundColor).toBe('rgb(212, 184, 74)')
    expect(screen.queryByTestId('geotech-body-color-reset-gbA')).toBeNull()
  })

  it('RB7b — a picked colour draws the override and its reset clears the home unit', () => {
    const onPickColor = vi.fn()
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1', { color_override: '#ff00ff' })]}
        geotechContacts={[]}
        geotechLayers={bodyLayers('u1', 'gbA', 1)}
        lithoFormations={[unit('lu', { name: 'SAND' })]}
        geotechBodies={[
          body({ id: 'gbA', formation_id: 'u1', body_ordinal: 0, parent_litho_body_id: 'lbX' }),
        ]}
        lithoBodies={new Map([['lbX', body({ id: 'lbX', formation_id: 'lu', body_ordinal: 0 })]])}
        onPickColor={onPickColor}
      />,
    )
    const swatch = screen.getByTestId('geotech-body-swatch-gbA')
    expect((swatch as HTMLElement).style.backgroundColor).toBe('rgb(255, 0, 255)')
    fireEvent.click(screen.getByTestId('geotech-body-color-reset-gbA'))
    // Reset writes the HOME unit (u1), not the body.
    expect(onPickColor).toHaveBeenCalledWith(['u1'], null)
  })
})

// ---------------------------------------------------------------------------
// RB8 — collapse
// ---------------------------------------------------------------------------

describe('the litho-body node collapses its leaves (RB8)', () => {
  it('RB8a — collapsing a litho body hides its packing leaves', () => {
    twoBodyScene()
    // Both start visible.
    expect(screen.getByTestId('geotech-body-row-gbA')).toBeTruthy()
    fireEvent.click(screen.getByTestId('geotech-litho-body-expander-SAND|lbX'))
    expect(screen.queryByTestId('geotech-body-row-gbA')).toBeNull()
    // The sibling node is untouched.
    expect(screen.getByTestId('geotech-body-row-gbB')).toBeTruthy()
  })

  it('RB8b — a collapsed node keeps the worst-badge roll-up visible', () => {
    // A litho body whose only packing body ran on the low fallback: collapsing
    // must not hide the "No CPT (partial)" signal (ux-reviewer 2026-09-01).
    render(
      <GeotechnicalUnitRoster
        geotechFormations={[unit('u1')]}
        geotechContacts={[]}
        geotechLayers={[...bodyLayers('u1', 'gbA', 2, 'high'), ...bodyLayers('u1', 'gbA', 1, 'low')]}
        lithoFormations={[unit('lu', { name: 'SAND' })]}
        geotechBodies={[
          body({ id: 'gbA', formation_id: 'u1', body_ordinal: 0, parent_litho_body_id: 'lbX' }),
        ]}
        lithoBodies={new Map([['lbX', body({ id: 'lbX', formation_id: 'lu', body_ordinal: 0 })]])}
        onPickColor={vi.fn()}
      />,
    )
    // Expanded: the badge rides the leaf, not the node.
    expect(screen.queryByTestId('partial-cpt-badge-SAND|lbX')).toBeNull()
    fireEvent.click(screen.getByTestId('geotech-litho-body-expander-SAND|lbX'))
    // Collapsed: the roll-up badge appears on the node, keyed by node key.
    expect(screen.getByTestId('partial-cpt-badge-SAND|lbX').textContent).toBe('No CPT (partial)')
  })
})
