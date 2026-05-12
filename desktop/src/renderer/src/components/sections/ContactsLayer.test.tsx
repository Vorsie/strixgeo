// Behaviour tests for ContactsLayer — the formation-contact
// polyline overlay on the cross-section.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { PlacedColumn } from './utils'

const flipped = (level: number): number => 20 - level

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#ff8800',
    code: null,
    display_order: 0,
    regional_ref: null,
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

function makeContact(
  overrides: Partial<FormationContactResponse> = {},
): FormationContactResponse {
  return {
    id: 'c-1',
    model_id: 'm-1',
    formation_id: 'f-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 3,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

function makeBoreholePlaced(
  id: string,
  nudgedX: number,
  elevation: number | null = 10,
): PlacedColumn {
  const item = {
    id,
    name: id,
    borehole_type: null,
    test_id: id,
    location_x: 0,
    location_y: 0,
    elevation_m: elevation,
    epsg: 31370,
    z_epsg: 5710,
    total_depth_m: 30,
    drill_method: null,
    n_drill_segments: null,
    n_field_log_intervals: null,
  } as BoreholeListItem
  const proj = {
    item,
    along: 0,
    offset: 0,
    side: 'on' as const,
  } as unknown as ProjectedInvestigation<BoreholeListItem>
  return {
    kind: 'borehole',
    proj,
    trueX: nudgedX,
    nudgedX,
    width: 14,
    displaced: false,
  }
}

function renderLayer(
  contacts: FormationContactResponse[],
  formations: GeologicalFormationResponse[],
  placedColumns: PlacedColumn[],
) {
  return render(
    <svg>
      <ContactsLayer
        contacts={contacts}
        formations={formations}
        placedColumns={placedColumns}
        levelToScreen={flipped}
        plotTop={0}
        plotBottom={50}
      />
    </svg>,
  )
}

describe('ContactsLayer', () => {
  it('renders nothing when there are no contacts', () => {
    const { container } = renderLayer([], [makeFormation()], [makeBoreholePlaced('bh-1', 50)])
    expect(container.querySelector('path')).toBeNull()
  })

  it('renders one polyline per formation across its contacts', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    expect(container.querySelectorAll('path').length).toBe(1)
    // Two vertex circles, one per contact.
    expect(container.querySelectorAll('circle').length).toBe(2)
    // Name label appears once per formation.
    expect(container.querySelector('text')?.textContent).toBe('Boom Klei')
  })

  it('separates polylines by formation', () => {
    const contacts = [
      makeContact({ id: 'c-1', formation_id: 'f-1', borehole_id: 'bh-1' }),
      makeContact({ id: 'c-2', formation_id: 'f-2', borehole_id: 'bh-2' }),
    ]
    const formations = [
      makeFormation({ id: 'f-1', name: 'Boom Klei', color: '#ff0000' }),
      makeFormation({ id: 'f-2', name: 'Diest Zand', color: '#00ff00' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    expect(container.querySelectorAll('path').length).toBe(2)
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('Boom Klei')
    expect(texts).toContain('Diest Zand')
  })

  it('skips contacts whose anchor borehole has no elevation', () => {
    const contacts = [makeContact({ borehole_id: 'bh-no-z' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-no-z', 50, null)],
    )
    expect(container.querySelector('path')).toBeNull()
  })

  it('uses the formation colour for the polyline stroke', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ color: '#aabbcc' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#aabbcc')
  })
})
