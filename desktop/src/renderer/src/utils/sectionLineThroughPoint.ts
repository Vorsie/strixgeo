// A cross-section line through one test, for "draw one through the borehole or
// CPT" when no section contains an offending contact (owner dogfeed
// 2026-09-22). East-west, centred on the test, so the column sits mid-section.
import { projectedToWgs84 } from '../hooks/useWgs84'

/** Half the default line length, metres: enough for the neighbours to project on. */
export const SECTION_THROUGH_POINT_HALF_LENGTH_M = 60

export interface LatLng {
  lat: number
  lng: number
}

/**
 * The endpoints of an east-west section line centred on a projected point.
 *
 * @param x - Easting in the project CRS, metres.
 * @param y - Northing in the project CRS, metres.
 * @param epsg - The project's horizontal CRS.
 * @param halfLengthM - Half the line length, metres.
 * @returns ``start`` (west) and ``end`` (east) in WGS84, the shape ``handleSectionLineDrawn`` takes.
 */
export function sectionLineThroughPoint(
  x: number,
  y: number,
  epsg: number,
  halfLengthM: number = SECTION_THROUGH_POINT_HALF_LENGTH_M,
): { start: LatLng; end: LatLng } {
  const [lat0, lng0] = projectedToWgs84(x - halfLengthM, y, epsg)
  const [lat1, lng1] = projectedToWgs84(x + halfLengthM, y, epsg)
  return { start: { lat: lat0, lng: lng0 }, end: { lat: lat1, lng: lng1 } }
}
