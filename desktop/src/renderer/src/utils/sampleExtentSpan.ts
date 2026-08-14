/**
 * Pure helper: map a lab sample to its vertical EXTENT on a section column.
 *
 * Supersedes the mid-depth point that ``sampleGeotechScreenPos`` returns. A
 * sample is an interval, not a point — the engineer needs to see which part of
 * the log a lab result speaks for, so the marker spans ``depth_top_m`` to
 * ``depth_base_m`` at the exact depths.
 *
 * A spot sample (top == base) has no extent at all, and a thin sample can
 * collapse below a pixel at a zoomed-out scale. Both would vanish, so any span
 * shorter than ``minHeightPx`` is opened up to that floor, centred on its own
 * interval — the marker stays findable without ever mis-stating WHERE the
 * sample sits.
 *
 * The horizontal position uses the column's ``along`` fed through
 * ``warpedXToScreen`` (the spacing-aware transform) — never raw ``xToScreen``
 * — so the marker follows the column nudging every other section overlay
 * applies.
 */

import type { SampleColumnRef, SampleDepth } from './sampleGeotechScreenPos'

export type { SampleColumnRef, SampleDepth }

/** Vertical extent of one sample marker in SVG/canvas pixels. */
export interface SampleExtentSpan {
  /** Horizontal pixel position (column centre). */
  x: number
  /** Pixel Y of the shallow end (always the smaller of the two). */
  yTop: number
  /** Pixel Y of the deep end (always the larger of the two). */
  yBase: number
  /** ``yBase - yTop`` — never below the caller's minimum. */
  height: number
}

/**
 * Compute the screen extent of one lab sample on a section column.
 *
 * @param sample - The sample's top and base depths below ground surface (m).
 * @param column - The column's along-section position and surface elevation.
 * @param warpedXToScreen - Spacing-aware horizontal transform. MUST be
 *   ``warpedXToScreen`` (never raw ``xToScreen``) so the marker stays aligned
 *   with the column glyph at any spacing setting.
 * @param levelToScreen - Elevation-to-pixel vertical transform.
 * @param minHeightPx - Floor for the marker's drawn height, in pixels.
 * @returns The marker's extent, or ``null`` when the borehole has no recorded
 *   surface elevation (the vertical position is undefined).
 */
export function sampleExtentScreenSpan(
  sample: SampleDepth,
  column: SampleColumnRef,
  warpedXToScreen: (along: number) => number,
  levelToScreen: (level: number) => number,
  minHeightPx: number,
): SampleExtentSpan | null {
  if (column.elevationM === null) return null

  const yA = levelToScreen(column.elevationM - sample.depth_top_m)
  const yB = levelToScreen(column.elevationM - sample.depth_base_m)
  // Normalise rather than assume the axis runs downward: the section's real
  // levelToScreen inverts elevation, but a caller (or a test) may not.
  let yTop = Math.min(yA, yB)
  let yBase = Math.max(yA, yB)

  if (yBase - yTop < minHeightPx) {
    // Grow symmetrically so the marker still points at the depth it came from.
    const centre = (yTop + yBase) / 2
    yTop = centre - minHeightPx / 2
    yBase = centre + minHeightPx / 2
  }

  return {
    // Spacing-aware horizontal position — MUST use warpedXToScreen.
    x: warpedXToScreen(column.along),
    yTop,
    yBase,
    height: yBase - yTop,
  }
}
