import proj4 from 'proj4'

// Belgian Lambert 72 (EPSG 31370) — the actual projection used by DOV files.
// DOV reports EPSG 32000 in its GEF headers but the coordinate values match
// Lambert 72, so we always project using the Lambert 72 definition.
proj4.defs(
  'EPSG:31370',
  '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 ' +
    '+lon_0=4.367486666666667 +x_0=150000.013 +y_0=5400088.438 ' +
    '+ellps=intl +towgs84=-106.869,52.2978,-103.724,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs',
)

// Netherlands Amersfoort / RD New (EPSG 28992). Mirrors the Lambert
// 72 setup above so the conversion helpers below cover both
// supported project horizontal CRSes.
proj4.defs(
  'EPSG:28992',
  '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 ' +
    '+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel ' +
    '+towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.8774,4.0725 ' +
    '+units=m +no_defs',
)

// Per-pair memoisation of the projection. ``proj4`` is pure for a
// given pair so caching is safe forever — the cache only grows as new
// (x, y) pairs are seen, bounded by the size of the dataset.
//
// Without caching, MapView called ``proj4(...)`` once per CPT marker
// AND once per borehole marker on every render — easily 1000+ calls
// per state change at typical project sizes.
const TO_WGS_CACHE = new Map<string, [number, number]>()
const FROM_WGS_CACHE = new Map<string, [number, number]>()

/** Convert a Lambert 72 (x, y) pair to [lat, lng] for Leaflet.
 *
 * Kept for the existing Belgium-only call sites; new code should
 * prefer ``projectedToWgs84(x, y, epsg)`` so the Netherlands case
 * routes naturally.
 */
export function lambertToWgs84(x: number, y: number): [number, number] {
  return projectedToWgs84(x, y, 31370)
}

/** Convert a projected (x, y) pair in the given EPSG to [lat, lng]
 * for Leaflet. Supported EPSGs: 31370 (BE Lambert 72), 28992 (NL
 * RD New). Throws for any other CRS — callers should gate on the
 * project's ``default_horizontal_epsg`` before invoking. */
export function projectedToWgs84(
  x: number,
  y: number,
  epsg: number,
): [number, number] {
  const key = `${epsg}:${x},${y}`
  const cached = TO_WGS_CACHE.get(key)
  if (cached) return cached
  const [lng, lat] = proj4(`EPSG:${epsg}`, 'WGS84', [x, y])
  const result: [number, number] = [lat, lng]
  TO_WGS_CACHE.set(key, result)
  return result
}

/** Inverse of ``projectedToWgs84`` — convert [lat, lng] back to the
 * given projected CRS. Used when capturing user clicks on the
 * Leaflet map and storing them as section endpoints in the project's
 * native CRS. Cached on the same (epsg, lat, lng) key shape. */
export function wgs84ToProjected(
  lat: number,
  lng: number,
  epsg: number,
): [number, number] {
  const key = `${epsg}:${lat},${lng}`
  const cached = FROM_WGS_CACHE.get(key)
  if (cached) return cached
  const [x, y] = proj4('WGS84', `EPSG:${epsg}`, [lng, lat])
  const result: [number, number] = [x, y]
  FROM_WGS_CACHE.set(key, result)
  return result
}

/**
 * Drop every cached projection (debt/audit L8).
 *
 * The caches are keyed by ``(epsg, x, y)`` and grow with the coordinate data a
 * project touches, so a session that opens several projects accumulates entries
 * that will never be looked up again. The project lifecycle calls this on
 * project close / open (see ``useProject``) so the caches stay bounded by the
 * ACTIVE project's dataset rather than the whole session's.
 *
 * Safe to call at any time: projection is pure, so the next lookup simply
 * recomputes and re-caches. This is a memory-hygiene reset, not a correctness
 * one — clearing never changes a projected coordinate.
 */
export function clearProjectScopedCaches(): void {
  TO_WGS_CACHE.clear()
  FROM_WGS_CACHE.clear()
}

/**
 * Test-only view of the cache sizes.
 *
 * The caches are module-private (they are an implementation detail, not part of
 * the projection contract), so a test that wants to assert "the cache filled"
 * or "the cache emptied" needs this narrow window. Mirrors the
 * ``resetXForTests`` convention used elsewhere in the codebase.
 *
 * Returns
 * -------
 * { to: number, from: number }
 *     Entry counts of the forward (projected→WGS84) and inverse caches.
 */
export function __wgs84CacheSizesForTest(): { to: number; from: number } {
  return { to: TO_WGS_CACHE.size, from: FROM_WGS_CACHE.size }
}
