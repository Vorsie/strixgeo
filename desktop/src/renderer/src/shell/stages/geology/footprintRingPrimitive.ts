// Cesium primitive for the model-footprint ring.
//
// Its own module rather than a 19th builder inside geology3DPrimitives.ts (1683
// lines, debt #201): the ring shares nothing with the mesh builders there — no
// triangles, no clip threading, no confidence fade — so co-locating it would
// only add mass to the file the god-component hook already flags.
//
// The polygon this draws is NOT computed here or anywhere in the renderer. It
// comes from the backend, which replays the persisted build payload through the
// same alpha hull the build clipped to. See ``utils/footprintRing.ts`` for why
// that matters.

import * as Cesium from 'cesium'

import { projectedToWgs84 } from '../../../hooks/useWgs84'

/** Screen width in pixels of the footprint ring. Two pixels reads as a
 * deliberate boundary at every camera distance the viewer uses while staying
 * thinner than any modelled contact — the ring annotates the model, it must
 * never compete with it. (One pixel disappears against a busy orthophoto lid.) */
export const FOOTPRINT_RING_WIDTH_PX = 2

/** Colour of the footprint ring — a desaturated slate at partial alpha.
 * Deliberately NOT a formation-palette hue: the ring is chrome that says where
 * the model stops, and a saturated colour would read as one more unit. */
export const FOOTPRINT_RING_COLOR = new Cesium.Color(0.42, 0.45, 0.5, 0.85)

/**
 * Build the closed polyline primitive for the model-footprint ring.
 *
 * A ``PolylineGeometry`` rather than a ``LINES`` mesh: WebGL's native line
 * width is clamped to 1 px on every desktop GL implementation we target, and a
 * 1 px hairline is invisible over the orthophoto lid. Cesium's polyline shader
 * draws real screen-space width.
 *
 * The ring is deliberately NOT clipped in split view. It states the extent of
 * the whole model, which does not change because the user cut the scene in
 * half; clipping it would make the cut edge look like a second model boundary.
 *
 * Parameters
 * ----------
 * ring
 *     Closed ring of ``[x_m, y_m, elevation_m]`` in the project CRS, as
 *     produced by ``footprintRingPositions`` (first vertex repeated at the
 *     end). Fewer than 2 points draws nothing.
 * projectEpsg
 *     Horizontal CRS EPSG code (31370 Lambert72 / 28992 RD New).
 * color
 *     Ring colour; defaults to ``FOOTPRINT_RING_COLOR``.
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null`` when the ring has too few points to draw.
 */
export function buildFootprintRingPrimitive(
  ring: readonly (readonly number[])[],
  projectEpsg: number,
  color: Cesium.Color = FOOTPRINT_RING_COLOR,
): Cesium.Primitive | null {
  if (ring.length < 2) return null

  const positions = ring.map(([x, y, z]) => {
    const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
    return Cesium.Cartesian3.fromDegrees(lng, lat, z)
  })

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions,
        width: FOOTPRINT_RING_WIDTH_PX,
        // PolylineColorAppearance needs its own vertex format; the default
        // (PolylineMaterialAppearance's) omits the per-vertex colour slot and
        // the primitive silently renders untinted.
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      },
    }),
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
  })
}
