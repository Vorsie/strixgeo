import L from 'leaflet'
import { describe, expect, it } from 'vitest'

import { lambertToWgs84 } from '../hooks/useWgs84'
import { idsOutsideBounds } from './viewportFilter'

// Lambert-72 fixtures — three points around Ghent, Belgium. Each
// projects to a known WGS84 lat/lng so the bounds-construction below
// can build "in" and "out" bounds around them deterministically.
const GHENT_CENTRE = { id: 'ghent', location_x: 105000, location_y: 195000 }
const ANTWERP = { id: 'antwerp', location_x: 152000, location_y: 211000 }
const BRUGGE = { id: 'brugge', location_x: 70000, location_y: 211000 }

describe('idsOutsideBounds', () => {
  it('returns empty set when bounds is null', () => {
    expect(idsOutsideBounds([GHENT_CENTRE, ANTWERP], null)).toEqual(new Set())
  })

  it('returns empty set when records list is empty', () => {
    const bounds = L.latLngBounds([50, 3], [52, 5])
    expect(idsOutsideBounds([], bounds)).toEqual(new Set())
  })

  it('returns empty set when all records are inside the bounds', () => {
    // Wide bounds covering all of Belgium — every fixture point fits.
    const bounds = L.latLngBounds([49.5, 2.5], [51.5, 6])
    expect(idsOutsideBounds([GHENT_CENTRE, ANTWERP, BRUGGE], bounds)).toEqual(new Set())
  })

  it('returns every id when all records are outside the bounds', () => {
    // Bounds in the middle of the Atlantic — none of the Belgian
    // points are inside.
    const bounds = L.latLngBounds([20, -40], [25, -35])
    expect(idsOutsideBounds([GHENT_CENTRE, ANTWERP, BRUGGE], bounds)).toEqual(
      new Set(['ghent', 'antwerp', 'brugge']),
    )
  })

  it('returns only the records outside the bounds', () => {
    // Tight bounds around Ghent only — Antwerp and Bruges fall outside.
    const [ghentLat, ghentLng] = lambertToWgs84(
      GHENT_CENTRE.location_x,
      GHENT_CENTRE.location_y,
    )
    const bounds = L.latLngBounds(
      [ghentLat - 0.05, ghentLng - 0.05],
      [ghentLat + 0.05, ghentLng + 0.05],
    )
    expect(idsOutsideBounds([GHENT_CENTRE, ANTWERP, BRUGGE], bounds)).toEqual(
      new Set(['antwerp', 'brugge']),
    )
  })

  it('treats records on the bounds edge as inside (Leaflet contains semantics)', () => {
    // Construct bounds where Ghent lands exactly on the south-west
    // corner. Leaflet's ``contains`` is inclusive, so Ghent should
    // NOT appear in the out-of-viewport set.
    const [ghentLat, ghentLng] = lambertToWgs84(
      GHENT_CENTRE.location_x,
      GHENT_CENTRE.location_y,
    )
    const bounds = L.latLngBounds(
      [ghentLat, ghentLng],
      [ghentLat + 0.5, ghentLng + 0.5],
    )
    expect(idsOutsideBounds([GHENT_CENTRE], bounds)).toEqual(new Set())
  })
})
