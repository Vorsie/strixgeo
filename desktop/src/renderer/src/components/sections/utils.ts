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
export interface PlacedColumnInput {
  kind: 'cpt' | 'borehole'
  proj: ProjectedInvestigation<CptListItem | BoreholeListItem>
  trueX: number
  width: number
}

/** Output of the column collision-handling pass — nudged X plus a
 * displacement flag the renderer uses to draw a tie-back diagonal
 * back to the true projected X. */
export interface PlacedColumn {
  kind: 'cpt' | 'borehole'
  proj: ProjectedInvestigation<CptListItem | BoreholeListItem>
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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
