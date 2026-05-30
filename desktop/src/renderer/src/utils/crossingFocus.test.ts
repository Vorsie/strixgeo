// Behaviour tests for resolveCandidateCrossingSections.

import { describe, expect, it } from 'vitest'

import type {
  CrossSectionResponse,
  FormationContactResponse,
} from '../api/client'
import { resolveCandidateCrossingSections } from './crossingFocus'

interface Anchor {
  id: string
  location_x: number | null
  location_y: number | null
}

function bh(overrides: Partial<Anchor> = {}): Anchor {
  return { id: 'bh-1', location_x: 100, location_y: 100, ...overrides }
}

function cpt(overrides: Partial<Anchor> = {}): Anchor {
  return { id: 'cpt-1', location_x: 200, location_y: 100, ...overrides }
}

function contact(
  id: string,
  overrides: Partial<FormationContactResponse> = {},
): FormationContactResponse {
  return {
    id,
    app_project_id: 'p',
    model_id: 'm',
    formation_id: 'f',
    borehole_id: null,
    cpt_id: null,
    depth_top_m: 1,
    instance_ordinal: 0,
    confidence: 'confirmed',
    source: 'manual',
    created_at: '',
    updated_at: '',
    parent_geo_contact_id: null,
    ...overrides,
  } as FormationContactResponse
}

function section(
  id: string,
  overrides: Partial<CrossSectionResponse> = {},
): CrossSectionResponse {
  return {
    id,
    app_project_id: 'p',
    name: id,
    description: null,
    start_x: 0,
    start_y: 100,
    end_x: 1000,
    end_y: 100,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 1,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    seeded_formation_contact_ids: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  } as CrossSectionResponse
}

describe('resolveCandidateCrossingSections', () => {
  it('returns an empty list for an empty contact-id input', () => {
    expect(
      resolveCandidateCrossingSections([], [], [section('s1')], [bh()], [cpt()]),
    ).toEqual([])
  })

  it('returns an empty list when the contact ids reference deleted rows', () => {
    expect(
      resolveCandidateCrossingSections(['missing-id'], [], [section('s1')], [], []),
    ).toEqual([])
  })

  it('returns the section that contains the borehole anchor (1 candidate)', () => {
    const contacts = [contact('c1', { borehole_id: 'bh-A' })]
    const sections = [
      section('s-along', { start_x: 0, start_y: 100, end_x: 1000, end_y: 100 }),
    ]
    const result = resolveCandidateCrossingSections(
      ['c1'],
      contacts,
      sections,
      [bh({ id: 'bh-A', location_x: 100, location_y: 100 })],
      [],
    )
    expect(result.map(s => s.id)).toEqual(['s-along'])
  })

  it('returns multiple sections when each contains one of the contacts (the picker case)', () => {
    const contacts = [
      contact('c1', { borehole_id: 'bh-A' }),
      contact('c2', { cpt_id: 'cpt-A' }),
    ]
    const sections = [
      // Horizontal section through y=100: contains bh-A (100, 100).
      section('s-horizontal', { start_x: 0, start_y: 100, end_x: 1000, end_y: 100 }),
      // Vertical section through x=200: contains cpt-A (200, 100).
      section('s-vertical', { start_x: 200, start_y: 0, end_x: 200, end_y: 500 }),
    ]
    const result = resolveCandidateCrossingSections(
      ['c1', 'c2'],
      contacts,
      sections,
      [bh({ id: 'bh-A', location_x: 100, location_y: 100 })],
      [cpt({ id: 'cpt-A', location_x: 200, location_y: 100 })],
    )
    expect(result.map(s => s.id).sort()).toEqual(['s-horizontal', 's-vertical'])
  })

  it('excludes sections whose buffer does not reach the anchor', () => {
    // Anchor sits at (100, 500). Section along y=100 with a 50 m
    // buffer cannot reach 400 m off-line. No candidate.
    const contacts = [contact('c1', { borehole_id: 'bh-A' })]
    const result = resolveCandidateCrossingSections(
      ['c1'],
      contacts,
      [section('s1', { projection_buffer_m: 50 })],
      [bh({ id: 'bh-A', location_x: 100, location_y: 500 })],
      [],
    )
    expect(result).toEqual([])
  })

  it('skips contacts whose anchor has missing coordinates', () => {
    const contacts = [contact('c1', { borehole_id: 'bh-A' })]
    const result = resolveCandidateCrossingSections(
      ['c1'],
      contacts,
      [section('s1')],
      [bh({ id: 'bh-A', location_x: null, location_y: null })],
      [],
    )
    expect(result).toEqual([])
  })

  it('preserves the input section order in the candidate list (stable for the picker)', () => {
    const contacts = [contact('c1', { borehole_id: 'bh-A' })]
    const sections = [
      section('s-a'),
      section('s-b'),
      section('s-c'),
    ]
    const result = resolveCandidateCrossingSections(
      ['c1'],
      contacts,
      sections,
      [bh({ id: 'bh-A', location_x: 500, location_y: 100 })],
      [],
    )
    expect(result.map(s => s.id)).toEqual(['s-a', 's-b', 's-c'])
  })
})
