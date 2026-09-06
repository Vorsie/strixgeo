// Client-side mirror of the DOV import bounding-box guard.
//
// SOURCE OF TRUTH — the server request schema:
//   src/groundmodel/api/schemas/cpt/import_dov_request.py (ImportDovRequest)
//   src/groundmodel/infrastructure/parsers/dov/dov_common.py
//     (validate_wgs84_import_bbox, DOV_MAX_BBOX_SIDE_KM / DOV_MAX_BBOX_AREA_KM2)
//
// A box drawn on the map is POSTed to ``/cpt/import-dov/stream`` (or the
// borehole twin), where the schema rejects a reversed / degenerate / oversized
// box with a 422. A click without a drag hands us a zero-extent box (its two
// corners coincide, so west === east and south === north), which is exactly
// that 422 — but until now it left the renderer and came back as an opaque
// "HTTP 422" toast. This helper refuses such a box locally so the request only
// ever goes out for one the schema would accept, and the caller can show a
// sentence the engineer can act on instead.
//
// Kept as a pure function with its own test so the mirror can be checked
// against the schema without spinning up the map or the backend.

import { wgs84ToProjected } from '../hooks/useWgs84'

// EPSG the server projects the box into before measuring its area — Belgian
// Lambert 72. Mirrors dov_common.DOV_HORIZONTAL_EPSG; a degree-space area check
// would be wrong by cos(lat) (a degree of longitude is ~70 km at Belgian
// latitudes, not 111 km), so we project exactly as the validator does.
const DOV_LAMBERT72_EPSG = 31370

/** Longest bbox side accepted for one DOV import, in kilometres. Mirrors
 *  dov_common.DOV_MAX_BBOX_SIDE_KM. */
export const DOV_MAX_BBOX_SIDE_KM = 25

/** Area limit for one DOV import bbox, in square kilometres. Mirrors
 *  dov_common.DOV_MAX_BBOX_AREA_KM2 (25 km x 25 km = 625 km²). */
export const DOV_MAX_BBOX_AREA_KM2 = DOV_MAX_BBOX_SIDE_KM * DOV_MAX_BBOX_SIDE_KM

/** A WGS84 bounding box as the draw gesture and the request body carry it. */
export interface DovBbox {
  west: number
  south: number
  east: number
  north: number
}

/**
 * Why a drawn box would be refused by the server, or ``null`` when it passes.
 *
 * - ``degenerate`` — a corner is non-finite, or the box has zero (or reversed)
 *   width/height: the schema's ``east <= west`` / ``north <= south`` check. A
 *   click without a drag lands here.
 * - ``out_of_range`` — a corner falls outside the WGS84 degree range: the
 *   ``Field(ge/le)`` bounds on the request schema.
 * - ``too_large`` — the projected area exceeds the 625 km² import limit.
 */
export type DovBboxProblem = 'degenerate' | 'out_of_range' | 'too_large'

/**
 * Classify a drawn box against the DOV import request schema.
 *
 * Parameters
 * ----------
 * bbox : DovBbox
 *     The four WGS84 corners from the draw gesture.
 *
 * Returns
 * -------
 * DovBboxProblem | null
 *     The reason the server would refuse the box, or ``null`` when it would be
 *     accepted. The checks run in the schema's order — range, then
 *     degeneracy/ordering, then area — so the reason matches what the 422 would
 *     have been.
 */
export function dovBboxProblem({ west, south, east, north }: DovBbox): DovBboxProblem | null {
  // A non-finite corner (a failed unproject, a missing value) would otherwise
  // sail through the comparisons below as NaN, so treat it as degenerate.
  if (![west, south, east, north].every(Number.isFinite)) return 'degenerate'

  // WGS84 degree ranges — the Field(ge=-180, le=180) / (ge=-90, le=90) bounds.
  if (west < -180 || west > 180 || east < -180 || east > 180) return 'out_of_range'
  if (south < -90 || south > 90 || north < -90 || north > 90) return 'out_of_range'

  // Strict ordering: a reversed box (corners swapped) and a degenerate box (a
  // corner shared, so zero width/height, e.g. a click without a drag) both fail
  // the same check the validator makes with east <= west / north <= south.
  if (east <= west || north <= south) return 'degenerate'

  // Area: project the two diagonal corners to Lambert 72 metres exactly as the
  // validator does (wgs84ToProjected takes lat, lng, so pass south/west then
  // north/east). Belgium is near-conformal under Lambert 72, so the
  // axis-aligned span of the diagonal corners is an accurate footprint.
  const [x1, y1] = wgs84ToProjected(south, west, DOV_LAMBERT72_EPSG)
  const [x2, y2] = wgs84ToProjected(north, east, DOV_LAMBERT72_EPSG)
  const areaKm2 = (Math.abs(x2 - x1) * Math.abs(y2 - y1)) / 1_000_000
  if (areaKm2 > DOV_MAX_BBOX_AREA_KM2) return 'too_large'

  return null
}

/**
 * Whether a drawn box would be accepted by the DOV import request schema.
 *
 * Parameters
 * ----------
 * bbox : DovBbox
 *     The four WGS84 corners from the draw gesture.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only when the box passes every schema rule; ``false`` for a
 *     degenerate, out-of-range, or oversized box.
 */
export function isValidDovBbox(bbox: DovBbox): boolean {
  return dovBboxProblem(bbox) === null
}
