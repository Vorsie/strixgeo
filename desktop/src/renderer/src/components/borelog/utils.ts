/**
 * Pure helpers + Layout for the BoreholeLog (debt #4).
 *
 * Three groups live here:
 *
 *   * **Layout** — ``computeLayout`` walks a borehole's observation /
 *     drill-segment / sample / field-log streams and decides where each
 *     track sits horizontally and how tall the canvas needs to be.
 *     Single source of truth so per-track sub-components don't have to
 *     re-derive x offsets.
 *   * **Pure helpers** — string formatters + small math utilities used
 *     across multiple track components. No React, no I/O, no closures.
 *   * **PxPerMContext** — React Context for the effective px-per-metre
 *     scale. BoreholeLog owns the state; sub-components consume it via
 *     the ``usePxPerM`` hook.
 *
 * Constants live in the sibling ``constants.ts`` so the numeric
 * vocabulary stays separate from the logic that uses it.
 */

import { createContext, useContext } from 'react'

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import type { ToggleableTrackId } from '../../hooks/useHiddenBoreholeLogTracks'
import type { Translator } from '../../i18n/translate'
import {
  BASE_PX_PER_M,
  DRILL_TRACK_WIDTH,
  FIELD_LOG_TRACK_WIDTH,
  HEADER_HEIGHT,
  M_TAW_AXIS_WIDTH,
  OBS_TRACK_WIDTH_LITHOLOGY,
  OBS_TRACK_WIDTH_STRATIGRAPHY,
  OBSERVATION_TYPE_ORDER,
  SAMPLES_TRACK_WIDTH,
  STRATIGRAPHY_TYPES,
  SVG_X_PAD,
  SVG_Y_PAD,
  TRACK_GAP,
} from './constants'

// ---------------------------------------------------------------------------
// Px-per-metre context
// ---------------------------------------------------------------------------

/** Effective px-per-metre scale, broadcast from BoreholeLog to every
 * track sub-component via React Context. */
export const PxPerMContext = createContext<number>(BASE_PX_PER_M)

/** Hook for the effective px-per-metre scale (see ``PxPerMContext``). */
export function usePxPerM(): number {
  return useContext(PxPerMContext)
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface ObservationTrackLayout {
  observation: ObservationResponse
  x: number
  width: number
}

export interface Layout {
  totalWidth: number
  totalHeight: number
  totalDepth: number
  canvasHeight: number
  /** x where the first track starts (for the groundwater horizontal). */
  canvasLeft: number
  /** x where the last track ends (for the groundwater horizontal). */
  canvasRight: number
  observationTracks: ObservationTrackLayout[]
  drillMethodX: number | null
  fieldLogX: number | null
  samplesX: number | null
}

/** Per-type width: lithology gets the wider track (per-layer
 * admixture chips need room); stratigraphy gets the narrower one
 * (single formation code per layer).
 */
export function widthForObservationType(observationType: string): number {
  return STRATIGRAPHY_TYPES.has(observationType)
    ? OBS_TRACK_WIDTH_STRATIGRAPHY
    : OBS_TRACK_WIDTH_LITHOLOGY
}

/**
 * Walk the borehole's child streams and decide where each track sits.
 *
 * Single source of truth for x positions + canvas dimensions so the
 * per-track sub-components stay in sync without re-deriving the
 * layout. Called once per render at the top of ``BoreholeLog``.
 *
 * Parameters
 * ----------
 * borehole : BoreholeDetailResponse
 *     Full borehole detail including observations, drill segments,
 *     field-log intervals, and samples.
 * pxPerM : number
 *     Effective pixels-per-metre scale (affected by zoom factor).
 * hiddenTracks : ReadonlySet<ToggleableTrackId>
 *     Track ids currently hidden by the user. Tracks in this set are
 *     excluded from the layout so no gap is left behind. Defaults to
 *     the empty set (show all tracks) — backward-compatible with
 *     call sites that don't supply it.
 *
 * Returns
 * -------
 * Layout
 *     Computed layout describing x-positions and total dimensions.
 */
export function computeLayout(
  borehole: BoreholeDetailResponse,
  pxPerM: number,
  hiddenTracks: ReadonlySet<ToggleableTrackId> = new Set(),
): Layout {
  // Observations to render — only those with at least one layer, in
  // stable display order (driller's record first, engineer's next,
  // then the stratigraphy flavours), excluding user-hidden tracks.
  const observationsToShow = [...borehole.observations]
    .filter(o => o.layers.length > 0 && !hiddenTracks.has(o.observation_type as ToggleableTrackId))
    .sort((a, b) => {
      const ai = OBSERVATION_TYPE_ORDER.indexOf(a.observation_type)
      const bi = OBSERVATION_TYPE_ORDER.indexOf(b.observation_type)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

  // Total depth: take the deepest extent across header + every layer +
  // every drill segment + every sample so the canvas covers everything
  // that needs drawing.
  const candidates: number[] = [borehole.total_depth_m ?? 0]
  for (const o of observationsToShow) {
    for (const l of o.layers) candidates.push(l.base_m)
  }
  for (const s of borehole.drill_segments) candidates.push(s.base_m)
  for (const sa of borehole.samples) candidates.push(sa.depth_base_m)
  const totalDepth = Math.max(...candidates, 1)

  const canvasHeight = totalDepth * pxPerM

  // X cursor — start with mTAW axis (always reserved, even when
  // elevation is null, so headers align consistently), then accumulate
  // per-track widths.
  let cursor = SVG_X_PAD + M_TAW_AXIS_WIDTH + TRACK_GAP
  const canvasLeft = cursor

  const observationTracks: ObservationTrackLayout[] = []
  for (const o of observationsToShow) {
    const width = widthForObservationType(o.observation_type)
    observationTracks.push({ observation: o, x: cursor, width })
    cursor += width + TRACK_GAP
  }

  let drillMethodX: number | null = null
  if (borehole.drill_segments.length > 0 && !hiddenTracks.has('drill_method')) {
    drillMethodX = cursor
    cursor += DRILL_TRACK_WIDTH + TRACK_GAP
  }

  let fieldLogX: number | null = null
  if (borehole.field_log_intervals.length > 0 && !hiddenTracks.has('field_log')) {
    fieldLogX = cursor
    cursor += FIELD_LOG_TRACK_WIDTH + TRACK_GAP
  }

  let samplesX: number | null = null
  if (borehole.samples.length > 0 && !hiddenTracks.has('samples_lab')) {
    samplesX = cursor
    cursor += SAMPLES_TRACK_WIDTH + TRACK_GAP
  }

  const canvasRight = cursor - TRACK_GAP
  const totalWidth = canvasRight + SVG_X_PAD
  const totalHeight = SVG_Y_PAD + HEADER_HEIGHT + canvasHeight + SVG_Y_PAD

  return {
    totalWidth,
    totalHeight,
    totalDepth,
    canvasHeight,
    canvasLeft,
    canvasRight,
    observationTracks,
    drillMethodX,
    fieldLogX,
    samplesX,
  }
}

// ---------------------------------------------------------------------------
// Pure formatters / math
// ---------------------------------------------------------------------------

/** Map an observation-type token to a human-readable, translated label.
 *
 * Used by ``TrackHeader`` and the legend so the user sees "Formal
 * stratigraphy" instead of ``formal_stratigraphy``. The token is a raw DOV
 * ``observation_type`` value and is never altered — only the rendered label is
 * translated. An unknown token is returned verbatim.
 *
 * @param t - Active-language translator.
 * @param token - Raw DOV ``observation_type`` token.
 */
export function humanizeObservationType(t: Translator, token: string): string {
  switch (token) {
    case 'coded_lithology':
      return t('borelog.obs.coded_lithology')
    case 'geotechnical_coding':
      return t('borelog.obs.geotechnical_coding')
    case 'lithological_description':
      return t('borelog.obs.lithological_description')
    case 'informal_stratigraphy':
      return t('borelog.obs.informal_stratigraphy')
    case 'formal_stratigraphy':
      return t('borelog.obs.formal_stratigraphy')
    case 'quaternary_stratigraphy':
      return t('borelog.obs.quaternary_stratigraphy')
    case 'hydrogeological_stratigraphy':
      return t('borelog.obs.hydrogeological_stratigraphy')
    case 'informal_hydrogeological_stratigraphy':
      return t('borelog.obs.informal_hydrogeological_stratigraphy')
    default:
      return token
  }
}

/** Truncate ``s`` to at most ``max`` characters, appending ``…``
 * when it had to be shortened. Used by per-layer label rendering. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/** Round ``value`` to ``decimals`` places. Standard
 * ``Math.round * 10^n / 10^n`` recipe.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

/** Approximate admixture-amount → percent. DOV's admixture vocab is
 * "veel" (a lot) / "matig" (moderate) / "weinig" (little); render
 * width on the admixture chip's percentage track scales by this.
 * Missing / unknown amount falls back to 5 % (matches the "weinig"
 * baseline so chips with no amount don't disappear).
 */
export function pctForAmount(amount: string | null | undefined): number {
  const a = (amount || '').toLowerCase()
  if (a.includes('veel')) return 15
  if (a.includes('matig')) return 10
  if (a.includes('weinig')) return 5
  return 5
}

/** Format an absolute level (mTAW / NAP / ...) for axis labels —
 * 2 decimals, leading ``+`` when positive so users can scan signed
 * levels at a glance.
 */
export function formatMtaw(lvl: number): string {
  return `${lvl >= 0 ? '+' : ''}${lvl.toFixed(2)}`
}
