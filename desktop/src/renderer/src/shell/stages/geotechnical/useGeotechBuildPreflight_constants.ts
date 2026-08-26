/**
 * Constants for the geotech Build pre-flight state machine.
 *
 * @module shell/stages/geotechnical/useGeotechBuildPreflight_constants
 */

/**
 * How long "Subdivide them & build" waits for the bands it just asked for to
 * reach the renderer before giving up and saying so.
 *
 * WHY a wait exists at all: ``handleSubdivideAllBodies`` finishes by BUMPING a
 * refetch nonce (``requestGeotechLayersRefetch``), and the GET that nonce
 * triggers runs in an effect on a later render. So the fresh bands are provably
 * not in ``geotechLayers`` when the press resolves, and the voxel builder — a
 * closure rebuilt from ``geotechLayers`` on every canvas render — would post
 * the pre-press payload. The build therefore waits for the model to catch up
 * rather than predicting it (the "defer until loaded" rule).
 *
 * WHY it is bounded: if the press could not band a column, the wait would never
 * end and the engineer would be left with a Build button that silently did
 * nothing. 15 s is far past a single list GET on any project and short enough
 * that a stall is reported while he is still looking at the screen.
 */
export const GEOTECH_BAND_WAIT_MS = 15_000
