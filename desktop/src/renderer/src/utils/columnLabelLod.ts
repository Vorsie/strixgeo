/**
 * Column-label level-of-detail (LOD) for the section canvas.
 *
 * At dense column spacings the three-line header stack (id / elevation /
 * qc value) becomes unreadable. This module decides, per column, which of
 * three modes the label should use — a pure function so it is unit-testable
 * without React or SVG.
 *
 * Decision cascade (applied per column):
 *   1. If the column is ``selected`` or ``hovered``, always ``full``
 *      (rendered as a callout so it doesn't collide with neighbours).
 *   2. If ``spacing >= FULL_HEADER_THRESHOLD_PX`` → ``full`` (normal
 *      multi-line stack).
 *   3. If ``spacing >= ROTATED_THRESHOLD_PX`` → ``rotated`` (just the id,
 *      rotated 90° to read vertically).
 *   4. Otherwise → decimate. Only the selected, hovered, first, and last
 *      columns are guaranteed a label; remaining columns are suppressed
 *      (``none``).
 *
 * ``spacing`` per column is the distance in pixels to the nearest
 * neighbour column (by ``nudgedX``). Using the nearest-neighbour distance
 * (rather than a global step) handles non-uniform layouts gracefully: a
 * pair of close columns can be rotated while distant neighbours stay full.
 */

/** The three rendering modes a column label can take. */
export type ColumnLabelMode = 'full' | 'rotated' | 'none'

/**
 * Minimum spacing (px between nudgedX positions) at which the full
 * three-line header fits without colliding.
 *
 * The worst-case header is ~80 px wide at fontSize=9 (a long borehole id
 * like "B-2024-0042" plus an offset annotation). Add a 4 px gap on each
 * side → 88 px total; rounded up to 90 for comfort. **Tunable** — the
 * owner can adjust this constant after visual review.
 */
export const FULL_HEADER_THRESHOLD_PX = 90

/**
 * Minimum spacing (px) at which a single rotated id fits without
 * colliding with its neighbour.
 *
 * A rotated label occupies its *height* horizontally — ~9 px (one
 * character's rendered width at fontSize=9) plus a gap. In practice
 * a typical id is ~7 characters × ~6 px ≈ 42 px high when rotated.
 * We therefore need at least 18 px of spacing so the rotated label
 * has room. **Tunable** — the owner can adjust after visual review.
 */
export const ROTATED_THRESHOLD_PX = 18

/**
 * Per-column label metadata consumed by ``selectVisibleLabels``.
 */
export interface ColumnLodInput {
  /** Unique column key (``kind-id`` or any stable string). */
  id: string
  /** Horizontal screen position of the column's centreline. */
  nudgedX: number
  /** Whether this column is the user's current selection. */
  selected: boolean
  /** Whether this column is currently hovered. */
  hovered: boolean
}

/**
 * Result record returned for each input column.
 */
export interface ColumnLodResult {
  id: string
  mode: ColumnLabelMode
  /** When ``mode === 'full'`` and the column is selected/hovered but
   * spacing is too tight, ``callout`` is ``true`` — the renderer
   * should offset the label above the nearest neighbour to avoid
   * occlusion. */
  callout: boolean
}

/**
 * Compute per-column label display modes for a set of placed columns.
 *
 * Parameters
 * ----------
 * columns
 *     Placed columns in any order. Must carry ``nudgedX``.
 * fullThreshold
 *     Pixel spacing at or above which the full multi-line header renders.
 *     Defaults to ``FULL_HEADER_THRESHOLD_PX``.
 * rotatedThreshold
 *     Pixel spacing at or above which a rotated id renders (below
 *     ``fullThreshold``). Defaults to ``ROTATED_THRESHOLD_PX``.
 *
 * Returns
 * -------
 * ColumnLodResult[]
 *     One result per input column, in the same order as the input.
 *
 * Notes
 * -----
 * Pure function — no side effects, no React, no DOM. Safe to call in a
 * ``useMemo`` with no special handling.
 */
export function selectVisibleLabels(
  columns: readonly ColumnLodInput[],
  fullThreshold = FULL_HEADER_THRESHOLD_PX,
  rotatedThreshold = ROTATED_THRESHOLD_PX,
): ColumnLodResult[] {
  if (columns.length === 0) return []

  // Nearest-neighbour distance for each column (by nudgedX).
  // Sort a copy by nudgedX to walk adjacents in O(n).
  const sorted = [...columns].sort((a, b) => a.nudgedX - b.nudgedX)
  const nearestNeighbour = new Map<string, number>()
  for (let i = 0; i < sorted.length; i += 1) {
    let minDist = Infinity
    if (i > 0) minDist = Math.min(minDist, sorted[i].nudgedX - sorted[i - 1].nudgedX)
    if (i < sorted.length - 1)
      minDist = Math.min(minDist, sorted[i + 1].nudgedX - sorted[i].nudgedX)
    nearestNeighbour.set(sorted[i].id, minDist)
  }

  // Identify the first and last column (by nudgedX) so they are
  // guaranteed a label even in the dense / decimated regime.
  const firstId = sorted[0].id
  const lastId = sorted[sorted.length - 1].id

  return columns.map(col => {
    const spacing = nearestNeighbour.get(col.id) ?? Infinity

    // Selected or hovered always shows full. Mark callout when spacing
    // is below the full threshold so the renderer knows to offset the
    // label to prevent occlusion with a densely-packed neighbour.
    if (col.selected || col.hovered) {
      return {
        id: col.id,
        mode: 'full',
        callout: spacing < fullThreshold,
      }
    }

    if (spacing >= fullThreshold) {
      return { id: col.id, mode: 'full', callout: false }
    }

    if (spacing >= rotatedThreshold) {
      return { id: col.id, mode: 'rotated', callout: false }
    }

    // Dense / decimation regime — only first and last get a label.
    // Selected/hovered already returned above.
    if (col.id === firstId || col.id === lastId) {
      return { id: col.id, mode: 'rotated', callout: false }
    }

    return { id: col.id, mode: 'none', callout: false }
  })
}
