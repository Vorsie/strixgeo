import { projectedToWgs84 } from '../hooks/useWgs84'
import type { SuggestedTie } from './tieAutoSuggest'

/**
 * Convert a proposed tie's projected (x, y) endpoints into a Leaflet
 * ``[[lat, lng], [lat, lng]]`` polyline in the given EPSG, so the map
 * overlay can draw it. Pure — no React, no Leaflet.
 *
 * @param tie - The proposed tie-section (projected endpoints).
 * @param epsg - The project's horizontal EPSG (e.g. 31370 BE, 28992 NL).
 * @returns Two [lat, lng] pairs: the tie's start and end.
 */
export function tieToLatLngLine(tie: SuggestedTie, epsg: number): [number, number][] {
  return [
    projectedToWgs84(tie.start.x, tie.start.y, epsg),
    projectedToWgs84(tie.end.x, tie.end.y, epsg),
  ]
}
