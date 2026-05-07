import proj4 from 'proj4'

// Belgian Lambert 72 (EPSG 31370) — the actual projection used by DOV files.
// DOV reports EPSG 32000 in its GEF headers but the coordinate values match
// Lambert 72, so we always project using the Lambert 72 definition.
proj4.defs(
  'EPSG:31370',
  '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 ' +
  '+lon_0=4.367486666666667 +x_0=150000.013 +y_0=5400088.438 ' +
  '+ellps=intl +towgs84=-106.869,52.2978,-103.724,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs'
)

/** Convert a Lambert 72 (x, y) pair to [lat, lng] for Leaflet. */
export function lambertToWgs84(x: number, y: number): [number, number] {
  const [lng, lat] = proj4('EPSG:31370', 'WGS84', [x, y])
  return [lat, lng]
}
