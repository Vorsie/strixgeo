// Owner 2026-10-04: a borehole with at least one lab test carries a small
// flask glyph on its map marker, the same flask the Data list shows. The
// glyph is a badge ON the square: shape still encodes the source kind
// (circle = CPT, square = borehole, docs/ux.md), so the square stays.
import { describe, expect, it } from 'vitest'

import type { BoreholeListItem } from '../api/clients/borehole'
import { buildBoreholeMarkers } from './mapMarkers'
import { boreholeMarkerSvg } from './mapMarkerStyle'

function borehole(id: string, labSeriesCount: number | null | undefined): BoreholeListItem {
  return {
    id,
    name: id,
    test_id: id,
    location_x: 150000,
    location_y: 200000,
    epsg: 31370,
    elevation_m: null,
    z_epsg: null,
    elevation_source: 'dov',
    drill_method: 'spoelboring',
    borehole_type: null,
    total_depth_m: 20,
    start_date: null,
    n_drill_segments: null,
    n_field_log_intervals: null,
    lab_series_count: labSeriesCount,
  }
}

describe('borehole map marker: the lab-test flask', () => {
  it('a borehole with lab tests is marked; one without (or with no count) is not', () => {
    const markers = buildBoreholeMarkers(
      [borehole('with', 2), borehole('without', 0), borehole('unknown', null)],
      new Set(),
      'drill_method',
      31370,
    )
    const has = Object.fromEntries(markers.map(m => [m.id, m.hasLabTests]))
    expect(has).toEqual({ with: true, without: false, unknown: false })
  })

  it('count > 0: the marker draws the flask glyph next to the square', () => {
    const svg = boreholeMarkerSvg({ fill: '#888', selected: false, ringed: false, hasLabTests: true })
    expect(svg.html).toContain('data-glyph="lab-flask"')
    expect(svg.html).toContain('<rect')
  })

  it('count 0: the same square, no flask', () => {
    const svg = boreholeMarkerSvg({ fill: '#888', selected: false, ringed: false, hasLabTests: false })
    expect(svg.html).not.toContain('lab-flask')
    expect(svg.html).toContain('<rect')
  })

  it('the square stays centred on the borehole position with or without the flask', () => {
    for (const ringed of [false, true]) {
      for (const selected of [false, true]) {
        const plain = boreholeMarkerSvg({ fill: '#888', selected, ringed, hasLabTests: false })
        const flagged = boreholeMarkerSvg({ fill: '#888', selected, ringed, hasLabTests: true })
        // The anchor sits on the square's centre: same offset from the square's
        // left edge, shifted down by the glyph's headroom only.
        expect(flagged.anchor[0]).toBe(plain.anchor[0])
        expect(flagged.anchor[1] - flagged.squareTop).toBe(plain.anchor[1] - plain.squareTop)
      }
    }
  })
})
