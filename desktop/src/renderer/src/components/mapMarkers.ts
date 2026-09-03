// Pure marker projection for the investigation map (Codex 2).
//
// MapView builds one marker per visible CPT / borehole by projecting its stored
// ``(location_x, location_y)`` into WGS84 for Leaflet. The projection lives
// here — a Leaflet-free module — so the CRS rule is unit-testable without
// mounting the map (Leaflet needs a real DOM).
//
// The rule: project-owned rows (CPTs, boreholes) render at the position implied
// by the PROJECT's horizontal CRS. DOV pending pins are a separate, explicitly
// Lambert-72 source and are NOT built here — MapView keeps ``lambertToWgs84``
// for those.

import { projectedToWgs84 } from '../hooks/useWgs84'
import type { CptListItem } from '../api/clients/cpt'
import type { BoreholeAxis, BoreholeListItem } from '../api/clients/borehole'

/** A projected CPT marker, ready for a Leaflet ``CircleMarker``. */
export interface CptMapMarker {
  id: string
  lat: number
  lng: number
  name: string
  type: string
  depth: number | null
}

/** A projected borehole marker, ready for a Leaflet divIcon ``Marker``. */
export interface BoreholeMapMarker {
  id: string
  lat: number
  lng: number
  name: string
  axisValue: string
  drillMethod: string | null
  boreholeType: string | null
  depth: number | null
}

/**
 * Clamp an arbitrary project EPSG to a CRS the projection helpers support.
 *
 * ``projectedToWgs84`` handles only the two project horizontal CRSes (31370 BE,
 * 28992 NL) and THROWS for anything else. Any other value — ``null`` on a fresh
 * project, or a future CRS not yet wired — falls back to Belgium Lambert-72, the
 * platform's historical default, so marker projection degrades to the old
 * behaviour rather than crashing the map.
 *
 * Parameters
 * ----------
 * epsg : number | null | undefined
 *     The project's effective horizontal EPSG.
 *
 * Returns
 * -------
 * number
 *     ``28992`` for a Netherlands project, ``31370`` otherwise.
 */
export function resolveProjectEpsg(epsg: number | null | undefined): number {
  return epsg === 28992 ? 28992 : 31370
}

/** The categorical value a borehole falls under for the active filter axis. */
export function boreholeAxisValue(b: BoreholeListItem, axis: BoreholeAxis): string {
  return (axis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
}

/**
 * Build the visible CPT markers, projected to WGS84 for the project's CRS.
 *
 * Parameters
 * ----------
 * cpts : CptListItem[]
 *     All project CPTs.
 * hiddenCptTypes : Set<string>
 *     CPT types the user has toggled off (hidden-set semantics).
 * epsg : number | null | undefined
 *     The project's effective horizontal EPSG.
 *
 * Returns
 * -------
 * CptMapMarker[]
 *     One marker per visible CPT with a finite projected position.
 */
export function buildCptMarkers(
  cpts: CptListItem[],
  hiddenCptTypes: Set<string>,
  epsg: number | null | undefined,
): CptMapMarker[] {
  const rowEpsg = resolveProjectEpsg(epsg)
  return cpts
    .filter(c => !hiddenCptTypes.has(c.cpt_type))
    .flatMap(c => {
      const [lat, lng] = projectedToWgs84(c.location_x, c.location_y, rowEpsg)
      if (!isFinite(lat) || !isFinite(lng)) return []
      return [{ id: c.id, lat, lng, name: c.name, type: c.cpt_type, depth: c.max_depth_m }]
    })
}

/**
 * Build the visible borehole markers, projected to WGS84 for the project's CRS.
 *
 * Parameters
 * ----------
 * boreholes : BoreholeListItem[]
 *     All project boreholes.
 * hiddenValues : Set<string>
 *     Axis values the user has toggled off (hidden-set semantics).
 * axis : BoreholeAxis
 *     The active filter axis (drill method / borehole type).
 * epsg : number | null | undefined
 *     The project's effective horizontal EPSG.
 *
 * Returns
 * -------
 * BoreholeMapMarker[]
 *     One marker per visible borehole with a finite projected position.
 */
export function buildBoreholeMarkers(
  boreholes: BoreholeListItem[],
  hiddenValues: Set<string>,
  axis: BoreholeAxis,
  epsg: number | null | undefined,
): BoreholeMapMarker[] {
  const rowEpsg = resolveProjectEpsg(epsg)
  return boreholes
    .filter(b => !hiddenValues.has(boreholeAxisValue(b, axis)))
    .flatMap(b => {
      const [lat, lng] = projectedToWgs84(b.location_x, b.location_y, rowEpsg)
      if (!isFinite(lat) || !isFinite(lng)) return []
      const value = boreholeAxisValue(b, axis)
      return [
        {
          id: b.id,
          lat,
          lng,
          name: b.name,
          axisValue: value,
          drillMethod: b.drill_method,
          boreholeType: b.borehole_type,
          depth: b.total_depth_m,
        },
      ]
    })
}
