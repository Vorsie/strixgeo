// Codex 2 — a project's own CPTs and boreholes must render and select at the
// right place for the PROJECT's horizontal CRS, not a hardcoded Belgium
// Lambert-72.
//
// The rule (production-readiness / codex CRS finding): the map builds a CPT /
// borehole marker by projecting its stored ``(location_x, location_y)`` to
// WGS84. A Netherlands project stores RD-New (EPSG:28992) coordinates, so
// projecting them through Lambert-72 (EPSG:31370) drops the marker hundreds of
// kilometres from the true site — and any map-driven selection (marquee /
// viewport) then picks the wrong thing, or nothing. DOV pending pins are a
// separate, explicitly-31370 source and are NOT built here.

import { describe, expect, it } from 'vitest'

import type { CptListItem } from '../api/clients/cpt'
import type { BoreholeListItem } from '../api/clients/borehole'
import { lambertToWgs84, projectedToWgs84 } from '../hooks/useWgs84'
import {
  buildCptMarkers,
  buildBoreholeMarkers,
  resolveProjectEpsg,
} from './mapMarkers'

// A CPT stored in Netherlands RD-New metres (Utrecht-ish). The SAME numbers,
// read as Lambert-72, land in a completely different place — which is the bug.
const NL_CPT: CptListItem = {
  id: 'C1',
  name: 'NL-1',
  cpt_type: 'CPTU',
  max_depth_m: 12.5,
  n_rows: 600,
  location_x: 136000,
  location_y: 456000,
  epsg: 28992,
  elevation_m: null,
  z_epsg: null,
  elevation_source: 'dov',
  start_date: null,
}

const NL_BOREHOLE: BoreholeListItem = {
  id: 'B1',
  name: 'NL-BH-1',
  test_id: 'bh-1',
  location_x: 136500,
  location_y: 455500,
  epsg: 28992,
  elevation_m: null,
  z_epsg: null,
  elevation_source: 'dov',
  drill_method: 'spoelboring',
  borehole_type: null,
  total_depth_m: 20,
  start_date: null,
  n_drill_segments: null,
  n_field_log_intervals: null,
}

/** A tiny axis-aligned marquee model: does a ±halfSpan box at ``center`` hold
 *  the marker? Mirrors the map's ``bounds.contains([lat, lng])`` selection. */
function marqueeSelects(
  marker: { lat: number; lng: number },
  center: [number, number],
  halfSpan = 0.002,
): boolean {
  return (
    marker.lat >= center[0] - halfSpan &&
    marker.lat <= center[0] + halfSpan &&
    marker.lng >= center[1] - halfSpan &&
    marker.lng <= center[1] + halfSpan
  )
}

describe('resolveProjectEpsg — only the two supported CRSes, else Belgium', () => {
  it('keeps 28992 for a Netherlands project', () => {
    expect(resolveProjectEpsg(28992)).toBe(28992)
  })
  it('keeps 31370 for a Belgium project', () => {
    expect(resolveProjectEpsg(31370)).toBe(31370)
  })
  it('falls back to 31370 for null / unknown so projection never throws', () => {
    expect(resolveProjectEpsg(null)).toBe(31370)
    expect(resolveProjectEpsg(undefined)).toBe(31370)
    expect(resolveProjectEpsg(4326)).toBe(31370)
  })
})

describe('Codex 2 — a 28992 CPT marker lands at its true WGS84 position', () => {
  it('projects with the project EPSG, not a hardcoded 31370', () => {
    const [marker] = buildCptMarkers([NL_CPT], new Set(), 28992)
    const [trueLat, trueLng] = projectedToWgs84(136000, 456000, 28992)
    expect(marker.lat).toBeCloseTo(trueLat, 6)
    expect(marker.lng).toBeCloseTo(trueLng, 6)
  })

  it('map-driven selection picks it at the TRUE site and not the wrong 31370 one', () => {
    const [marker] = buildCptMarkers([NL_CPT], new Set(), 28992)
    const trueSite = projectedToWgs84(136000, 456000, 28992)
    const wrongSite = lambertToWgs84(136000, 456000)
    // A marquee over the real Netherlands site selects the marker...
    expect(marqueeSelects(marker, trueSite)).toBe(true)
    // ...and a marquee over where a 31370 projection would have put it does not.
    expect(marqueeSelects(marker, wrongSite)).toBe(false)
  })

  it('carries the CPT display fields through unchanged', () => {
    const [marker] = buildCptMarkers([NL_CPT], new Set(), 28992)
    expect(marker).toMatchObject({ id: 'C1', name: 'NL-1', type: 'CPTU', depth: 12.5 })
  })
})

describe('a 31370 CPT is unaffected (Belgium projects keep their positions)', () => {
  it('matches the Lambert-72 projection when the project is 31370', () => {
    const beCpt = { ...NL_CPT, id: 'C2', location_x: 150000, location_y: 200000, epsg: 31370 }
    const [marker] = buildCptMarkers([beCpt], new Set(), 31370)
    const [lat, lng] = lambertToWgs84(150000, 200000)
    expect(marker.lat).toBeCloseTo(lat, 6)
    expect(marker.lng).toBeCloseTo(lng, 6)
  })
})

describe('Codex 2 — a 28992 borehole marker lands at its true WGS84 position', () => {
  it('projects with the project EPSG', () => {
    const [marker] = buildBoreholeMarkers([NL_BOREHOLE], new Set(), 'drill_method', 28992)
    const [trueLat, trueLng] = projectedToWgs84(136500, 455500, 28992)
    expect(marker.lat).toBeCloseTo(trueLat, 6)
    expect(marker.lng).toBeCloseTo(trueLng, 6)
    expect(marker.axisValue).toBe('spoelboring')
  })

  it('respects the hidden-axis filter', () => {
    const hidden = new Set<string>(['spoelboring'])
    expect(buildBoreholeMarkers([NL_BOREHOLE], hidden, 'drill_method', 28992)).toHaveLength(0)
  })
})
