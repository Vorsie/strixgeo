// Per-project preferences for the litho-segmenter ("Suggest" verb).
//
// Persists in ``project.view_state.litho_segmenter`` — same pattern as
// ``cpt_channels`` / ``snap_to_stratigraphy`` (see SectionPanel + #40).
// The bag lives in the .gmproj bundle so the user's tuning round-trips
// across save/reload and travels with the project file.
//
// Why a per-project knob (not per-user / per-machine):
//   * Different projects have different sampling resolutions and
//     geological scales — a 30 m harbour CPT and a 15 m Boom-Klei CPT
//     want different minimum thicknesses. Project-scoped lets the
//     setting follow the data.
//   * .gmproj is the unit of sharing (CLAUDE.md "Project files"). A
//     user-machine pref would be invisible to a colleague opening the
//     same file.
//
// Forward-compat note. ``gunsat_kNm3`` is a single project-wide value
// today; per-soil γunsat (γ_ZAND / γ_KLEI / ...) is the geotechnically
// correct future shape. When that lands, a new ``gunsat_by_lithology``
// key joins the bag and readers prefer it over the scalar. The current
// scalar then becomes the catch-all "site default" — no breaking change.

export interface LithoSegmenterPrefs {
  /** Minimum output layer thickness in metres for the segmenter
   *  greedy-merge step. Backend range: 0.05 – 10.0 m (enforced by
   *  ``LithoSuggestionRequest`` Field constraints). Default 0.15 m
   *  matches the typical CPT sampling resolution. */
  minimumLayerThicknessM: number
  /** Soil unit weight above the water table, kN/m³. Project-wide
   *  scalar until per-lithology γ table arrives. Backend range
   *  8.0 – 25.0 (peat to dense gravel). Default 16. */
  gunsatKNm3: number
  /** Sand relative-density compression factor for the Robertson Dr
   *  correlation. Default 0.675 (Jamiolkowski "average quartz");
   *  range 0.5 – 0.8 across quartz / feldspar / calcareous sands.
   *  Backend range 0.1 – 2.0 (defensive — we tighten in the UI). */
  drCompressionFactor: number
  /** When true (default per owner directive 2026-05-25), adjacent
   *  CPT segments that share the same lithology are collapsed into
   *  one layer after Robertson-SBT segmentation. The packing-density
   *  signal returns at the right layer: the Geotech stage's future
   *  "Suggest packing split" gesture. CPT path only. */
  mergeSameLithology: boolean
  /** Inclusive snap tolerance (metres) used by the litho↔geological
   *  contact-drag prompt (debt #134).  When a litho contact is
   *  dragged within ±tolerance of any geological contact on the
   *  same investigation, the snap dialog opens and offers the
   *  three resolution options (snap litho / move geo / keep
   *  separate).  Same threshold drives the post-accept check
   *  (#134-C).  Backend range: 0.01 – 5.0 m.  Default 0.20 m
   *  matches the MVP that shipped 2026-05-27. */
  lithoSnapToleranceM: number
}

export const LITHO_SEGMENTER_DEFAULTS: LithoSegmenterPrefs = {
  minimumLayerThicknessM: 0.15,
  gunsatKNm3: 16.0,
  drCompressionFactor: 0.675,
  mergeSameLithology: true,
  lithoSnapToleranceM: 0.20,
}

export const LITHO_SEGMENTER_BOUNDS = {
  minimumLayerThicknessM: { min: 0.05, max: 10.0 },
  gunsatKNm3: { min: 8.0, max: 25.0 },
  drCompressionFactor: { min: 0.1, max: 2.0 },
  lithoSnapToleranceM: { min: 0.01, max: 5.0 },
} as const

const VIEW_STATE_KEY = 'litho_segmenter'

function readBoundedNumber(
  v: unknown,
  bounds: { min: number; max: number },
  fallback: number,
): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= bounds.min && v <= bounds.max
    ? v
    : fallback
}

/**
 * Read the litho-segmenter prefs out of a project's ``view_state`` bag.
 *
 * Missing key, malformed value, or out-of-range numbers all fall back
 * to the per-field default — the bag is best-effort persistence, not
 * a contract. Each field defaults independently so a corrupted γunsat
 * doesn't wipe a valid min-thickness setting.
 */
export function readLithoSegmenterPrefs(
  viewState: Record<string, unknown> | null | undefined,
): LithoSegmenterPrefs {
  if (!viewState || typeof viewState !== 'object') {
    return { ...LITHO_SEGMENTER_DEFAULTS }
  }
  const raw = (viewState as Record<string, unknown>)[VIEW_STATE_KEY]
  if (!raw || typeof raw !== 'object') {
    return { ...LITHO_SEGMENTER_DEFAULTS }
  }
  const dict = raw as Record<string, unknown>
  return {
    minimumLayerThicknessM: readBoundedNumber(
      dict.minimum_layer_thickness_m,
      LITHO_SEGMENTER_BOUNDS.minimumLayerThicknessM,
      LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM,
    ),
    gunsatKNm3: readBoundedNumber(
      dict.gunsat_kNm3,
      LITHO_SEGMENTER_BOUNDS.gunsatKNm3,
      LITHO_SEGMENTER_DEFAULTS.gunsatKNm3,
    ),
    drCompressionFactor: readBoundedNumber(
      dict.dr_compression_factor,
      LITHO_SEGMENTER_BOUNDS.drCompressionFactor,
      LITHO_SEGMENTER_DEFAULTS.drCompressionFactor,
    ),
    // Boolean field — undefined/missing defaults to true (owner directive
    // 2026-05-25: merge is on by default). Only explicit false disables.
    mergeSameLithology:
      typeof dict.merge_same_lithology === 'boolean'
        ? dict.merge_same_lithology
        : LITHO_SEGMENTER_DEFAULTS.mergeSameLithology,
    lithoSnapToleranceM: readBoundedNumber(
      dict.litho_snap_tolerance_m,
      LITHO_SEGMENTER_BOUNDS.lithoSnapToleranceM,
      LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM,
    ),
  }
}

/**
 * Build the patch payload for ``applyViewStatePatch`` so the segmenter
 * prefs survive the next save. Shallow-merge contract: only the
 * ``litho_segmenter`` key is overwritten, sibling keys (cpt_channels,
 * dem_overlay, ...) are preserved by the server-side merge.
 */
export function buildLithoSegmenterPatch(
  prefs: LithoSegmenterPrefs,
): Record<string, unknown> {
  return {
    [VIEW_STATE_KEY]: {
      minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
      gunsat_kNm3: prefs.gunsatKNm3,
      dr_compression_factor: prefs.drCompressionFactor,
      merge_same_lithology: prefs.mergeSameLithology,
      litho_snap_tolerance_m: prefs.lithoSnapToleranceM,
    },
  }
}
