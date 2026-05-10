import type L from 'leaflet'

import { lambertToWgs84 } from '../hooks/useWgs84'

/**
 * Return the ids of records whose marker is currently outside the
 * supplied Leaflet bounds.
 *
 * The map and the records use different CRSes — Leaflet's bounds are
 * WGS84 (lat/lng degrees), but record coordinates come from DOV in
 * Lambert-72 metres. Each record's ``(location_x, location_y)`` is
 * projected to WGS84 via the cached ``lambertToWgs84`` so the
 * containment check is apples-to-apples.
 *
 * Returns an empty set when ``bounds`` is ``null`` so the first
 * render — before Leaflet has reported its initial bounds — treats
 * every record as in-viewport. Otherwise the sidebar would briefly
 * partition all records into the dimmed "out of viewport" section.
 */
export function idsOutsideBounds(
  records: ReadonlyArray<{ id: string; location_x: number; location_y: number }>,
  bounds: L.LatLngBounds | null,
): Set<string> {
  if (!bounds) return new Set<string>()
  const out = new Set<string>()
  for (const r of records) {
    const [lat, lng] = lambertToWgs84(r.location_x, r.location_y)
    if (!bounds.contains([lat, lng])) out.add(r.id)
  }
  return out
}
