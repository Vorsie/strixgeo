/**
 * Shared primitives for the cross-section panel.
 *
 * Three groups live here:
 *
 *   * Pure helpers — ``sectionLengthM``, ``niceStep``, ``ticks``. No
 *     React, no I/O; the section's rendering code consumes them.
 *   * Layout constants + types — ``MARGIN`` / ``Viewport`` /
 *     ``PlacedColumn`` etc. The orchestrator (``SectionPanel``) and
 *     the extracted sub-components all reference the same names so
 *     coordinate transforms stay in sync.
 *   * ``useElementSize`` — tiny ResizeObserver hook used by
 *     ``SectionPanel`` to drive its SVG viewBox. Lives here rather
 *     than in ``hooks/`` because no other module needs it yet —
 *     promote on the second copy per the duplication rule.
 */

import { useEffect, useState } from 'react'

import type {
  BoreholeDetailResponse,
  BoreholeListItem,
  CptListItem,
  CrossSectionResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'

// ---------------------------------------------------------------------------
// Snap-to-stratigraphy helpers
// ---------------------------------------------------------------------------

/**
 * Observation types whose layer top/base depths feed the snap-to-
 * stratigraphy interaction. Sharing a single set across the click
 * path (``BoreholeColumn``) and the drag path (``SectionPanel``'s
 * ``snapDepthsByAnchorId`` builder) keeps the two consumers in
 * sync; adding a third stratigraphy stream (e.g.
 * ``quaternary_stratigraphy``) becomes a one-line change here.
 */
export const STRAT_OBS_TYPES_FOR_SNAP: ReadonlySet<string> = new Set([
  'formal_stratigraphy',
  'informal_stratigraphy',
])

/**
 * Deduped layer-boundary depths from a single borehole's
 * stratigraphy observations. The output is the snap-target set the
 * editor uses for both single-test click placement (BoreholeColumn)
 * and section-wide drag (ContactsLayer via SectionPanel's
 * snapDepthsByAnchorId map).
 *
 * Returns layer top + base for every observation whose type is in
 * ``STRAT_OBS_TYPES_FOR_SNAP``. Duplicates (e.g. stacked layers
 * where base of N = top of N+1) collapse to a single entry. Empty
 * observations or unrecognised types yield ``[]``.
 */
export function collectSnapDepths(detail: BoreholeDetailResponse): number[] {
  const out = new Set<number>()
  for (const obs of detail.observations) {
    if (!STRAT_OBS_TYPES_FOR_SNAP.has(obs.observation_type)) continue
    for (const layer of obs.layers) {
      out.add(layer.top_m)
      out.add(layer.base_m)
    }
  }
  return Array.from(out)
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Pixel margins reserved for axis labels + ticks. Tight enough that
 * the drawing area doesn't shrink visibly on small viewports. */
export const MARGIN = { top: 24, right: 24, bottom: 36, left: 56 } as const

/** Default vertical window when the user opens a fresh section with
 * no data overlaid. Engineers can pan/zoom freely; this is just the
 * initial framing so the canvas isn't empty. */
export const DEFAULT_LEVEL_RANGE = { min: -40, max: 20 } as const

/** Vertical-exaggeration slider bounds. Geotech engineers typically
 * use 5–10× for shallow profiles; deep soundings (200m+) sometimes
 * run as low as 0.5×. Log-mapped on the slider so both ends are
 * reachable with reasonable thumb travel. */
export const VEX_MIN = 0.5
export const VEX_MAX = 50
export const VEX_DEFAULT = 1

/** Wheel-zoom factor per wheel tick. 1.15 = 15% in or out per detent;
 * matches Leaflet's default and feels natural after the user's
 * already-trained map muscle memory. */
export const WHEEL_ZOOM_FACTOR = 1.15

/** Edge-to-edge gap between adjacent columns. 4 px of clear air
 * keeps tie-back diagonals readable even on tight profiles. */
export const COLUMN_EDGE_GAP_PX = 4

/** Bare column width (S2/S3 layout — no data tracks). Used as the
 * floor for both kinds; data tracks grow the width additively as
 * the header toggles flip on. */
export const BARE_COLUMN_WIDTH_PX = 14

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** World viewport in section-local coordinates: x = along-distance
 * from start endpoint (metres), level = vertical (metres in the
 * project's vertical datum — typically TAW or NAP). */
export interface Viewport {
  xMin: number
  xMax: number
  levelMin: number
  levelMax: number
}

/** Input to the column collision-handling pass — natural screen X
 * plus the visible pixel width of the rendered glyph. */
/** Discriminated-union input shape for ``nudgeColumns`` (debt #28).
 *
 * Splitting CPT vs borehole into separate branches lets every
 * consumer narrow ``proj.item`` automatically via the ``kind``
 * discriminant — no ``as CptListItem`` casts needed. The previous
 * single-shape ``proj: ProjectedInvestigation<CptListItem |
 * BoreholeListItem>`` forced ~10 cast sites across the section
 * code; they're gone with the union.
 */
export interface CptPlacedColumnInput {
  kind: 'cpt'
  proj: ProjectedInvestigation<CptListItem>
  trueX: number
  width: number
}
export interface BoreholePlacedColumnInput {
  kind: 'borehole'
  proj: ProjectedInvestigation<BoreholeListItem>
  trueX: number
  width: number
}
export type PlacedColumnInput =
  | CptPlacedColumnInput
  | BoreholePlacedColumnInput

/** Output of the column collision-handling pass — nudged X plus a
 * displacement flag the renderer uses to draw a tie-back diagonal
 * back to the true projected X. Discriminated union by ``kind`` so
 * consumers narrow ``proj.item`` without casts.
 */
interface PlacedColumnBase {
  /** Screen X where the column would naturally land. */
  trueX: number
  /** Screen X where the column actually renders after collision
   * nudging. Equal to ``trueX`` when no displacement was needed. */
  nudgedX: number
  /** Pixel width of this column's rendered glyph (cap + any data
   * tracks). The renderer uses ``halfWidth`` to position the qc
   * curve / interpretation tracks relative to the column centerline. */
  width: number
  /** ``true`` when the column had to be moved more than half a
   * pixel. Drives whether the tie-back diagonal renders. */
  displaced: boolean
}
export interface CptPlacedColumn extends PlacedColumnBase {
  kind: 'cpt'
  proj: ProjectedInvestigation<CptListItem>
}
export interface BoreholePlacedColumn extends PlacedColumnBase {
  kind: 'borehole'
  proj: ProjectedInvestigation<BoreholeListItem>
}
export type PlacedColumn = CptPlacedColumn | BoreholePlacedColumn

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Return every placed column whose X (along-axis) lies strictly
 * between ``sourceX`` and ``targetX``, plus the column at ``targetX``
 * itself. The source column is excluded — it already carries the
 * contact being painted, so re-stamping it would be a no-op (or worse,
 * an overwrite to the same value).
 *
 * Used by the shift+drag "paint through" gesture: pulling a contact
 * from test A over B / C / D / E onto F duplicates the source contact
 * onto B, C, D, E and F at the source's own depth. Direction-agnostic
 * — a leftward drag returns the same set as a rightward drag with the
 * endpoints swapped.
 *
 * @param sourceX along-axis X of the drag's anchor column (excluded
 *                from the result)
 * @param targetX along-axis X of the drop column (included in the
 *                result; assumed non-null at call time)
 * @param columns the full placed-column set for the section
 * @returns columns sorted by ``trueX`` in source→target order, target
 *          included, source excluded
 */
export function columnsBetween(
  sourceX: number,
  targetX: number,
  columns: readonly PlacedColumn[],
): PlacedColumn[] {
  // Half-pixel epsilon so floating-point drift on the source's
  // cached X doesn't accidentally re-include the source itself.
  const EPS = 0.5
  const matches = columns.filter(c => {
    if (sourceX <= targetX) {
      // Rightward drag: drop SOURCE (at sourceX), keep target (at targetX).
      return c.trueX > sourceX + EPS && c.trueX <= targetX + EPS
    }
    // Leftward drag: keep target (at targetX), drop SOURCE (at sourceX).
    return c.trueX >= targetX - EPS && c.trueX < sourceX - EPS
  })
  matches.sort((a, b) =>
    sourceX <= targetX ? a.trueX - b.trueX : b.trueX - a.trueX,
  )
  return matches
}

/** Linear interpolation of a polyline's ``y`` at horizontal position
 * ``x``. Returns ``null`` when ``x`` is outside the polyline's range
 * — letting callers distinguish "the polyline isn't defined here"
 * (e.g. a pinched-out formation) from "the polyline is defined and
 * y is the value below". Polyline must be sorted ascending by ``x``. */
function _interpolatePolylineY(
  poly: readonly { x: number; y: number }[],
  x: number,
): number | null {
  if (poly.length === 0) return null
  if (x < poly[0].x || x > poly[poly.length - 1].x) return null
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.y + t * (b.y - a.y)
    }
  }
  return poly[poly.length - 1].y
}

/** Build a closed fill polygon for one geological band on the
 * section.
 *
 * The band's TOP is the formation's own slice polyline (younger end).
 * The band's BOTTOM at each X comes from the FIRST older formation
 * (walking ``olders`` in age order, immediate-next first) whose
 * polyline is defined at that X. When no older formation has data at
 * X — either the formation is the oldest in the column, OR every
 * older has pinched out there — the band drops to ``floor`` (a
 * horizontal cap; pass the deepest investigation's screen-Y to
 * stop the fill at the section's known-data depth).
 *
 * Why the multi-older fallback matters: a formation can pinch out
 * laterally (no contacts in some boreholes). When KoAa disappears
 * in the middle of a section, Quartair must sit directly on KoRo
 * there — the band needs to skip the absent intermediate and reach
 * the next-existing older. Without this, the Quartair band would
 * truncate at KoAa's eastern edge and leave a visual gap where
 * Quartair geologically continues onto KoRo.
 *
 * @param top    polyline of (x, y) screen coords for the formation's
 *               own top, sorted ascending by ``x``
 * @param olders polylines of every formation older than this one, in
 *               age order (immediate-next-older first). May be empty
 *               (oldest formation in the column).
 * @param floor  fallback screen-Y when no older formation has data
 *               at an X position — typically the deepest investigation
 *               bottom in the section. Constant across X.
 * @returns an SVG path string ``"M ... Z"``; empty string when the
 *          top polyline is empty.
 */
export function buildFillBand(
  top: readonly { x: number; y: number }[],
  olders: readonly (readonly { x: number; y: number }[])[],
  floor: number,
): string {
  if (top.length === 0) return ''
  const topMinX = top[0].x
  const topMaxX = top[top.length - 1].x
  // Sample at every X position from the top polyline AND every X
  // position from any older polyline that falls inside the top's
  // domain (so pinch-out edges land on real vertices, not
  // interpolated approximations).
  const xSet = new Set<number>([topMinX, topMaxX])
  for (const p of top) xSet.add(p.x)
  for (const older of olders) {
    for (const p of older) {
      if (p.x >= topMinX && p.x <= topMaxX) xSet.add(p.x)
    }
  }
  const xs = Array.from(xSet).sort((a, b) => a - b)
  let path = ''
  // Top edge — forward along the formation's own slice.
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const y = _interpolatePolylineY(top, x)
    if (y === null) continue
    path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `
  }
  // Bottom edge — reversed. At each X, the bottom is the first
  // older formation that's defined there, or the floor.
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i]
    let bottomY: number | null = null
    for (const older of olders) {
      const y = _interpolatePolylineY(older, x)
      if (y !== null) {
        bottomY = y
        break
      }
    }
    if (bottomY === null) bottomY = floor
    path += `L ${x.toFixed(2)} ${bottomY.toFixed(2)} `
  }
  path += 'Z'
  return path
}

/** Euclidean length of the section line, computed once from
 * endpoints. */
export function sectionLengthM(section: CrossSectionResponse): number {
  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Plate-tectonic "nice number" tick spacing — pick the largest of
 * {1, 2, 5} × 10^k that fits ~5-10 ticks across the range. Matches
 * the chart libraries' standard heuristic and reads cleanly for
 * engineers used to surveyed dimensions. */
export function niceStep(range: number, targetTicks = 6): number {
  if (range <= 0) return 1
  const rough = range / targetTicks
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / magnitude
  let nice: number
  if (norm < 1.5) nice = 1
  else if (norm < 3) nice = 2
  else if (norm < 7) nice = 5
  else nice = 10
  return nice * magnitude
}

/** Generate tick positions for a [min, max] range at a nice step. */
export function ticks(min: number, max: number, targetTicks = 6): number[] {
  const step = niceStep(max - min, targetTicks)
  const first = Math.ceil(min / step) * step
  const out: number[] = []
  // Cap iteration so a bad viewport (e.g. inverted) can't burn the
  // CPU; tick generation is in a render hot path.
  for (let v = first, i = 0; v <= max && i < 200; v += step, i += 1) {
    out.push(v)
  }
  return out
}

/**
 * Return the maximum measurement depth (m below surface) for a placed
 * column. CPTs expose ``max_depth_m``; boreholes expose ``total_depth_m``.
 * Returns ``null`` when the value is absent (column has no depth data yet).
 *
 * Parameters
 * ----------
 * col
 *     A placed column from the section panel's layout pass.
 *
 * Returns
 * -------
 * number | null
 *     Depth in metres below ground surface, or ``null``.
 */
export function columnMaxDepthM(col: PlacedColumn): number | null {
  if (col.kind === 'cpt') {
    return col.proj.item.max_depth_m
  }
  return col.proj.item.total_depth_m
}

// ---------------------------------------------------------------------------
// useElementSize — measure container for SVG viewBox
// ---------------------------------------------------------------------------

/** Observe a DOM element's size; returns ``{ width, height }`` that
 * updates as the container resizes. ``null`` on first render before
 * the ResizeObserver fires. */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): {
  width: number
  height: number
} | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setSize({ width: el.clientWidth, height: el.clientHeight })
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ width, height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
