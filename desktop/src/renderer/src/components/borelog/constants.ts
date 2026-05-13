// Geometry + vocabulary constants for the BoreholeLog (debt #4).
//
// Lifted out of BoreholeLog.tsx in one piece so the layout sub-
// components (per-track files added in a follow-on commit) can
// share the same source of truth without re-importing through the
// orchestrator. Lifting them HERE — and not into ``utils.ts`` —
// keeps the pure helpers + Layout fn in utils free of magic
// numbers; the constants file is where the numbers are NAMED, the
// utils file is where they're USED.

// ---------------------------------------------------------------------------
// Zoom + depth scale
// ---------------------------------------------------------------------------

/** Default depth scale: 60 pixels per metre. BoreholeLog owns a
 * ``zoomFactor`` state and broadcasts the effective scale via
 * ``PxPerMContext``. Sub-components consume the context. */
export const BASE_PX_PER_M = 60

export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 4.0
export const ZOOM_STEP = 1.25

// ---------------------------------------------------------------------------
// Per-track widths
// ---------------------------------------------------------------------------

/** Lithology tracks (geotechnical coding, coded lithology,
 * lithological description) carry a lot of per-layer text (soil
 * codes + admixtures), so they get the wider 150 px. */
export const OBS_TRACK_WIDTH_LITHOLOGY = 150

/** Stratigraphy tracks just hold short formation codes
 * (``A`` / ``Q`` / ``HyEg``) — 150 px is wasteful, the column is
 * mostly empty. 90 px gives the borelog a more compact left-to-
 * right footprint when 4-5 stratigraphy interpretations land
 * alongside the lithology stream. */
export const OBS_TRACK_WIDTH_STRATIGRAPHY = 90

export const HEADER_HEIGHT = 72 // px — diagonal track headers
export const M_TAW_AXIS_WIDTH = 64
export const DRILL_TRACK_WIDTH = 90
export const FIELD_LOG_SUB_WIDTH = 36
export const FIELD_LOG_TRACK_WIDTH = FIELD_LOG_SUB_WIDTH * 3
export const SAMPLES_TRACK_WIDTH = 220
export const TRACK_GAP = 1
export const SVG_X_PAD = 16
export const SVG_Y_PAD = 8

// ---------------------------------------------------------------------------
// Observation type vocabulary
// ---------------------------------------------------------------------------

/** Lithology streams render with soil patterns; stratigraphy
 * streams use plain labelled rectangles (formation codes A / Q /
 * HyEg, no soil meaning). */
export const LITHOLOGY_TYPES: ReadonlySet<string> = new Set([
  'coded_lithology',
  'geotechnical_coding',
])

export const STRATIGRAPHY_TYPES: ReadonlySet<string> = new Set([
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
])

// (``lithological_description`` has free text but no soil codes;
//  it renders as a labelled rectangle too.)

/** Stable display order — driller's record first, engineer's
 * reinterpretation next, then text descriptions, then the
 * stratigraphy flavours. */
export const OBSERVATION_TYPE_ORDER: ReadonlyArray<string> = [
  'coded_lithology',
  'geotechnical_coding',
  'lithological_description',
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
]
