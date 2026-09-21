/**
 * Tests for the section-band display-label rule (contactsLayerGeometry.ts).
 *
 * Regression anchor: a GEOTECH formation inherits ``litho_main_soil_code`` from
 * the litho unit it subdivides, so the lithology branch used to win and the band
 * read litho-only ("SAND") — the packing class only showed on the connecting
 * fill, never on the per-test column (dogfeed 2026-06-30). The NAD branch must
 * win for any NAD-classed formation.
 */

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/clients/geology'
import { nadClassColor, nadClassName } from '../../utils/nadClasses'
import {
  formationDisplayLabel,
  geotechDisplayFormation,
  svgLocalPointFromEvent,
} from './contactsLayerGeometry'

/** Build a GeologicalFormationResponse with all required fields, override per case. */
function makeFormation(over: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'p-1',
    name: 'Formation',
    color: '#cccccc',
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
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('formationDisplayLabel', () => {
  it('GEOTECH formation labels by NAD name even though it inherited a litho soil code', () => {
    // The exact dogfeed shape: a subdivided sand body — nad_class set AND
    // litho_main_soil_code inherited from the source litho unit.
    const geotech = makeFormation({
      nad_class: 6,
      litho_main_soil_code: 'ZAND',
      name: 'ZAND (NAD 6)',
    })
    expect(formationDisplayLabel(geotech)).toBe(nadClassName(6)) // "SAND, medium dense"
    // NOT the lithology — the bug was it read "Sand"/"SAND" (litho only).
    expect(formationDisplayLabel(geotech)).not.toMatch(/^Sand$/i)
  })

  it('LITHO unit (no nad_class) still labels by translated lithology — debt #96 unchanged', () => {
    const litho = makeFormation({
      nad_class: null,
      litho_main_soil_code: 'KLEI',
      name: 'KLEI (KL:Z)',
    })
    // formatLithoDisplayName output, not the raw "KLEI (KL:Z)" token.
    const label = formationDisplayLabel(litho)
    expect(label).not.toBe('KLEI (KL:Z)')
    expect(label.length).toBeGreaterThan(0)
  })

  it('GEOLOGICAL / curated formation (no nad_class, no soil code) labels by name', () => {
    const geo = makeFormation({ name: 'Diest Zand', regional_ref: 'DZ' })
    expect(formationDisplayLabel(geo)).toBe('Diest Zand')
  })

  it('a non-NAD, non-litho formation prefers name over regional_ref', () => {
    const geo = makeFormation({ name: 'Boom Klei', regional_ref: 'BK' })
    expect(formationDisplayLabel(geo)).toBe('Boom Klei')
  })
})

// ---------------------------------------------------------------------------
// geotechDisplayFormation — the per-column band colour on the geotech axis.
//
// Owner ruling 2026-08-26: "Colours on the right hand pane need to be choosable
// if user wants." The pane is where he picks, but the pick has to reach the
// section too, or the colour he chose disagrees with the colour he sees.
// ---------------------------------------------------------------------------

describe('geotechDisplayFormation — colour', () => {
  it('CG1 — with nobody having picked, the band takes its NAD packing colour', () => {
    const f = makeFormation({ nad_class: 6, color: '#c2b280' })

    expect(geotechDisplayFormation(f, 'geotechnical').color).toBe(nadClassColor(6))
  })

  it('CG2 — a colour the engineer picked wins on the section band', () => {
    const f = makeFormation({ nad_class: 6, color: '#c2b280', color_override: '#ff00ff' })

    expect(geotechDisplayFormation(f, 'geotechnical').color).toBe('#ff00ff')
  })

  it('CG3 — the litho axis is untouched: it still shows the stored colour', () => {
    // Control. The ruling is about the geotech pane; a pick made there must not
    // start repainting the lithostratigraphic axis.
    const f = makeFormation({ nad_class: 6, color: '#c2b280', color_override: '#ff00ff' })

    expect(geotechDisplayFormation(f, 'lithostratigraphic').color).toBe('#c2b280')
  })
})

describe('svgLocalPointFromEvent', () => {
  // jsdom returns all-zero rects, so a real owner is faked with a known rect.
  const owner = (left: number, top: number): SVGSVGElement =>
    ({ getBoundingClientRect: () => ({ left, top }) as DOMRect }) as unknown as SVGSVGElement

  it('subtracts the owner rect top-left from the event client point', () => {
    expect(svgLocalPointFromEvent(owner(100, 50), { clientX: 130, clientY: 80 })).toEqual({
      x: 30,
      y: 30,
    })
  })

  it('falls back to the raw client point when the owner is null or undefined', () => {
    // The load-bearing ``?? 0`` guard: no rect → subtract nothing.
    expect(svgLocalPointFromEvent(null, { clientX: 42, clientY: 17 })).toEqual({ x: 42, y: 17 })
    expect(svgLocalPointFromEvent(undefined, { clientX: 5, clientY: 9 })).toEqual({ x: 5, y: 9 })
  })
})
