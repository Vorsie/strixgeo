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
