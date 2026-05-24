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

export interface LithoSegmenterPrefs {
  /** Minimum output layer thickness in metres for the segmenter
   *  greedy-merge step. Backend range: 0.05 – 10.0 m (enforced by
   *  ``LithoSuggestionRequest`` Field constraints). Default 0.15 m
   *  matches the typical CPT sampling resolution. */
  minimumLayerThicknessM: number
}

export const LITHO_SEGMENTER_DEFAULTS: LithoSegmenterPrefs = {
  minimumLayerThicknessM: 0.15,
}

export const LITHO_SEGMENTER_MIN_THICKNESS_BOUNDS = {
  min: 0.05,
  max: 10.0,
} as const

const VIEW_STATE_KEY = 'litho_segmenter'

/**
 * Read the litho-segmenter prefs out of a project's ``view_state`` bag.
 *
 * Missing key, malformed value, or out-of-range numbers all fall back
 * to the defaults — the bag is best-effort persistence, not a contract.
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
  const t = dict.minimum_layer_thickness_m
  const thickness =
    typeof t === 'number' &&
    Number.isFinite(t) &&
    t >= LITHO_SEGMENTER_MIN_THICKNESS_BOUNDS.min &&
    t <= LITHO_SEGMENTER_MIN_THICKNESS_BOUNDS.max
      ? t
      : LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM
  return { minimumLayerThicknessM: thickness }
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
    },
  }
}
