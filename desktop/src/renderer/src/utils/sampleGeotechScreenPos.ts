/**
 * Pure helper: map a lab sample to its screen position on the geotech axis.
 *
 * The sample is plotted at the midpoint of its depth interval below the
 * borehole's surface elevation.  The horizontal position uses the column's
 * ``along_m`` value fed through ``warpedXToScreen`` (the spacing-aware
 * transform) — never through raw ``xToScreen`` — so the dot follows the
 * column nudging that every other geotech section overlay applies.
 *
 * Returns ``null`` when the borehole has no known surface elevation
 * (``elevation_m`` is null), because the vertical position is undefined.
 */

/** Input data describing a single lab sample's depth interval. */
export interface SampleDepth {
  /** Depth from ground surface to the top of the sample interval (m). */
  depth_top_m: number
  /** Depth from ground surface to the base of the sample interval (m). */
  depth_base_m: number
}

/** Reduced column descriptor consumed by the helper. */
export interface SampleColumnRef {
  /** Along-section position in metres (world space). */
  along: number
  /** Borehole surface elevation in mTAW. ``null`` when not recorded. */
  elevationM: number | null
}

/** Screen position in SVG/canvas pixels. */
export interface SampleScreenPos {
  /** Horizontal pixel position (from the section SVG left edge). */
  x: number
  /** Vertical pixel position (from the section SVG top edge). */
  y: number
}

/**
 * Compute the screen position of a sample dot on the geotech axis.
 *
 * Parameters
 * ----------
 * sample
 *     The sample whose depth interval provides the vertical position.
 * column
 *     The borehole column's along-section position and surface elevation.
 * warpedXToScreen
 *     Column-spacing-aware horizontal transform.  MUST be ``warpedXToScreen``
 *     (never raw ``xToScreen``) so the dot stays aligned with the column
 *     glyph under any spacing setting.
 * levelToScreen
 *     Elevation-to-pixel vertical transform.
 *
 * Returns
 * -------
 * SampleScreenPos | null
 *     Screen position of the sample midpoint, or ``null`` when the borehole
 *     has no surface elevation (vertical position is undefined).
 */
export function sampleGeotechScreenPos(
  sample: SampleDepth,
  column: SampleColumnRef,
  warpedXToScreen: (along: number) => number,
  levelToScreen: (level: number) => number,
): SampleScreenPos | null {
  if (column.elevationM === null) return null

  // Mid-depth below ground surface → elevation in mTAW.
  const midDepth = (sample.depth_top_m + sample.depth_base_m) / 2
  const elevationM = column.elevationM - midDepth

  return {
    // Spacing-aware horizontal position — MUST use warpedXToScreen.
    x: warpedXToScreen(column.along),
    y: levelToScreen(elevationM),
  }
}
