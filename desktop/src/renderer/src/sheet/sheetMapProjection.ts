// Sheet-map projection: every point on the sheet's map is converted with the
// SECTION's horizontal CRS (``payload.section.epsg``), so a Dutch RD project
// (EPSG:28992) lands where it belongs. The audit found ``SheetMap`` converting
// with ``lambertToWgs84`` regardless of the project CRS.
import { projectedToWgs84 } from '../hooks/useWgs84'
import { computeMapExtent } from './mapExtent'

/** WGS84 ``[lat, lng]`` of a projected point in the given EPSG. */
export function sheetPointToLatLng(epsg: number, x: number, y: number): [number, number] {
  return projectedToWgs84(x, y, epsg)
}

/** The padded map extent of ``points`` (projected, in ``epsg``) as WGS84 corners. */
export function sheetMapBounds(
  epsg: number,
  points: readonly { x: number; y: number }[],
): { sw: [number, number]; ne: [number, number] } {
  const extent = computeMapExtent(points)
  return {
    sw: sheetPointToLatLng(epsg, extent.minX, extent.minY),
    ne: sheetPointToLatLng(epsg, extent.maxX, extent.maxY),
  }
}
