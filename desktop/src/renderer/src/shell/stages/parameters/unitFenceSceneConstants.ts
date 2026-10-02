// Scene-dressing constants for the fence cutout — a separate Cesium-free
// module so the B6 pins can import them without pulling the viewer chunk.

/**
 * Basemap lid alpha in the CUTOUT's viewer only (owner ruling B6b,
 * 2026-08-27, verbatim: "make the basemap a bit more seethrough? like 5%?").
 * The shared lid already renders at ``DEFAULT_BASEMAP_LID_ALPHA`` = 0.65, so
 * "a bit MORE see-through" means BELOW 0.65 — a 95 % reading would have made
 * it more opaque, the opposite of the ask. 0.60 = 5 % more see-through than
 * today. The shared 3-D stages keep their own default; this dial moves the
 * cutout alone.
 */
export const UNIT_FENCE_BASEMAP_LID_ALPHA = 0.6

/**
 * The cutout's wheel-zoom tuning (audit F5, 2026-08-27). Cutout ONLY — the
 * shared 3-D stages never pass it, so their controller keeps every Cesium
 * default.
 *
 * * ``zoomFactor`` 2 — Cesium's default is 5, and the cutout is the SHORTEST
 *   canvas in the app (h-80), so a default wheel notch crossed most of the
 *   scene in one step. 2 keeps the same proportional-to-distance feel at
 *   less than half the stride.
 * * ``minimumZoomDistanceM`` 5 — the default 1 m lets the camera dive inside
 *   a wall and near-plane-clip through it; 5 m is close enough to read a
 *   band and far enough to keep the wall a surface.
 * * ``fineZoomFraction`` 0.05 — the CTRL+wheel fine step moves 5 % of the
 *   camera height per notch (asymptotic toward the ground, so it cannot
 *   punch through where the controller's own clamp does not apply).
 */
export const UNIT_FENCE_ZOOM_TUNING = {
  zoomFactor: 2,
  minimumZoomDistanceM: 5,
  fineZoomFraction: 0.05,
} as const

/**
 * The closest range (m) the cutout's "Zoom to unit" flight may end at (owner
 * ruling C(a), 2026-10-02). The shared bounds fit never flies closer than
 * 600 m — right for a whole model, a sliver for one thin unit. ~40 m frames a
 * single thin wall so its bands read, and stays well clear of the 5 m wheel
 * floor (``UNIT_FENCE_ZOOM_TUNING.minimumZoomDistanceM``).
 */
export const UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M = 40

/**
 * localStorage key for the cutout's basemap on/off (owner ruling C(a),
 * 2026-10-02). Per-viewer UI chrome only — never an engineering decision, so
 * it does not belong in the project bundle. ``'0'`` = off; anything else = on.
 */
export const UNIT_FENCE_BASEMAP_STORAGE_KEY = 'strix.parameters.fenceCutout.basemap'
