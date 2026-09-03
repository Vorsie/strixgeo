import type L from 'leaflet'

import { projectedToWgs84 } from '../hooks/useWgs84'
import { resolveProjectEpsg } from '../components/mapMarkers'

/**
 * Return the ids of records whose marker is currently outside the
 * supplied Leaflet bounds.
 *
 * The map and the records use different CRSes — Leaflet's bounds are
 * WGS84 (lat/lng degrees), but record coordinates come from the project
 * in its own horizontal CRS. Each record's ``(location_x, location_y)``
 * is projected to WGS84 via ``projectedToWgs84`` **with the project's
 * effective EPSG** so the containment check is apples-to-apples. A
 * Netherlands (28992) project's rows would otherwise be read as Belgium
 * Lambert-72 and land hundreds of kilometres away, so the viewport
 * filter would dim rows that are actually on screen (Codex 2). ``epsg``
 * is clamped to a supported CRS (31370 / 28992) so the projection never
 * throws — see ``resolveProjectEpsg``.
 *
 * Returns an empty set when ``bounds`` is ``null`` so the first
 * render — before Leaflet has reported its initial bounds — treats
 * every record as in-viewport. Otherwise the sidebar would briefly
 * partition all records into the dimmed "out of viewport" section.
 *
 * Parameters
 * ----------
 * records : ReadonlyArray<{ id, location_x, location_y }>
 *     Project-owned rows (CPTs / boreholes) to test.
 * bounds : L.LatLngBounds | null
 *     The current map viewport in WGS84, or ``null`` pre-first-render.
 * epsg : number | null | undefined
 *     The project's effective horizontal EPSG. Defaults to 31370.
 *
 * Returns
 * -------
 * Set<string>
 *     Ids of records whose projected marker falls outside ``bounds``.
 */
export function idsOutsideBounds(
  records: ReadonlyArray<{ id: string; location_x: number; location_y: number }>,
  bounds: L.LatLngBounds | null,
  epsg: number | null | undefined = 31370,
): Set<string> {
  if (!bounds) return new Set<string>()
  const rowEpsg = resolveProjectEpsg(epsg)
  const out = new Set<string>()
  for (const r of records) {
    const [lat, lng] = projectedToWgs84(r.location_x, r.location_y, rowEpsg)
    if (!bounds.contains([lat, lng])) out.add(r.id)
  }
  return out
}
