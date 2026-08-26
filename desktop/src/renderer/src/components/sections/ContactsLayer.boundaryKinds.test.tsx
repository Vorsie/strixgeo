// LK — on the geotech axis, packing must not shout as loud as geology.
//
// Owner ruling 2026-08-26 ("lighten the lines"): a boundary between two NAD packing
// sub-bands INSIDE one litho unit is the engineer's own subdivision. Drawn with the
// weight of a lithostratigraphic contact it reads as geology, and a column where 14 of
// 17 boundaries are real contacts becomes an undifferentiated stack of black lines.
//
// The subordinate treatment already ships (`d3d8cdd1d`, 2026-08-09) — but nothing held
// it. These cases hold it, and hold the other half too: the litho contact's own stroke
// is NOT what was lightened. The assertions are written as RELATIONSHIPS (lighter than,
// thinner than, patterned where the contact is solid) rather than as a colour spelling,
// because the ruling is about the two kinds reading differently, not about one hex value.
//
// WCAG 2.2 AA §1.4.1: the difference is carried by dash and width as well as contrast,
// so "subordinate" survives a monochrome display and a colour-vision deficiency.

import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { PlacedColumn } from './utils'

/** Elevation → screen Y, flipped about 20 so 1 m of depth is 1 px. */
const flipped = (level: number): number => 20 - level

/** A sand formation carrying a litho soil code, as every packing band's parent does. */
function makeFormation(id: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name: 'SAND',
    color: '#fbbf24',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  }
}

/** A borehole-anchored contact at a given depth below the collar. */
function makeContact(id: string, depthTopM: number): FormationContactResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: 'f-sand',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: depthTopM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  }
}

/** The single placed borehole column every case here draws on. */
function makeColumn(): PlacedColumn {
  const item = {
    id: 'bh-1',
    name: 'bh-1',
    borehole_type: null,
    test_id: 'bh-1',
    location_x: 0,
    location_y: 0,
    elevation_m: 10,
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
  return { kind: 'borehole', proj, trueX: 100, nudgedX: 100, width: 14, displaced: false }
}

/**
 * Render three stacked bands on one column.
 *
 * @param restatingContactIds Which drawn boundaries restate a litho contact. Passing
 *   ``undefined`` is the litho axis, where the distinction does not exist.
 */
function renderLayer(restatingContactIds?: ReadonlySet<string>) {
  return render(
    <svg>
      <ContactsLayer
        contacts={[makeContact('c-1', 1), makeContact('c-2', 3), makeContact('c-3', 5)]}
        formations={[makeFormation('f-sand')]}
        placedColumns={[makeColumn()]}
        levelToScreen={flipped}
        plotTop={0}
        plotBottom={50}
        perColumnBandsFromContacts
        axisMode="geotechnical"
        restatingContactIds={restatingContactIds}
      />
    </svg>,
  )
}

/** The drawn boundary line for one contact. */
function line(container: HTMLElement, contactId: string): SVGLineElement {
  const el = container.querySelector(`[data-testid="contact-line-${contactId}"]`)
  expect(el, `no boundary line drawn for ${contactId}`).not.toBeNull()
  return el as unknown as SVGLineElement
}

/** Effective ink of a stroke: width scaled by its opacity. */
function weight(el: SVGLineElement): number {
  return Number(el.getAttribute('stroke-width')) * Number(el.getAttribute('stroke-opacity'))
}

describe('ContactsLayer — packing sub-boundaries read as subordinate to litho contacts', () => {
  afterEach(() => {
    cleanup()
  })

  // c-2's bands sit in two different litho units, so that boundary IS a contact.
  // c-1 and c-3 subdivide one unit — the engineer's own packing boundaries.
  const RESTATING = new Set(['c-2'])

  it('LK1 — a within-unit packing boundary is lighter and thinner than the litho contact', () => {
    const { container } = renderLayer(RESTATING)

    const packing = line(container, 'c-3')
    const contact = line(container, 'c-2')

    expect(packing.getAttribute('stroke')).not.toBe(contact.getAttribute('stroke'))
    expect(Number(packing.getAttribute('stroke-width'))).toBeLessThan(
      Number(contact.getAttribute('stroke-width')),
    )
    expect(weight(packing)).toBeLessThan(weight(contact))
  })

  it('LK2 — the difference survives without colour: the packing boundary is dashed, the contact solid', () => {
    const { container } = renderLayer(RESTATING)

    expect(line(container, 'c-3').getAttribute('stroke-dasharray')).toBeTruthy()
    expect(line(container, 'c-2').getAttribute('stroke-dasharray')).toBeNull()
  })

  it('LK3 — the litho contact keeps the heavy near-black solid line it always had', () => {
    const { container } = renderLayer(RESTATING)
    const contact = line(container, 'c-2')

    // Spelled out deliberately: this is the stroke the ruling says NOT to touch.
    expect(contact.getAttribute('stroke')).toBe('#0f172a')
    expect(contact.getAttribute('stroke-width')).toBe('1.75')
    expect(contact.getAttribute('stroke-opacity')).toBe('0.95')
  })

  it('LK4 — every boundary that subdivides one unit gets the treatment, not just one', () => {
    const { container } = renderLayer(RESTATING)

    for (const id of ['c-1', 'c-3']) {
      expect(line(container, id).getAttribute('stroke-dasharray')).toBeTruthy()
    }
  })

  it('LK5 — off the geotech axis nothing is demoted; the contact line is untouched', () => {
    // No classification supplied = the litho axis. Lightening there would restyle
    // lithology itself, which is the one thing this change must never do.
    const { container } = renderLayer(undefined)

    for (const id of ['c-1', 'c-2', 'c-3']) {
      const el = line(container, id)
      expect(el.getAttribute('stroke-dasharray')).toBeNull()
      expect(el.getAttribute('stroke-width')).toBe('1.75')
    }
  })
})
