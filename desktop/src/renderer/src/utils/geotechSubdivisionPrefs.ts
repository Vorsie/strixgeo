// Per-project preferences for the geotech NAD subdivision ("Subdivide all
// bodies"). Persists in ``project.view_state.geotech_subdivision`` — SEPARATE
// from the litho ``litho_segmenter`` bag so tuning packing never moves
// lithology. Same best-effort read pattern as lithoSegmenterPrefs.ts.

import { readBoundedNumber, readViewStateBag } from './viewStatePrefs'

export interface GeotechSubdivisionPrefs {
  /** Thinnest NAD packing band kept; also the persistence a qc change must hold
   *  to move a boundary. Range 0.1–3.0 m. Default 0.35. */
  minimumLayerThicknessM: number
  /** Snap a boundary to a nearby sharp qc break (never less conservative). */
  gradientSnapEnabled: boolean
  /** Max distance a boundary may snap. Range 0.1–2.0 m. Default 0.5. */
  gradientSnapWindowM: number
  /**
   * Geotech geo↔litho snap tolerance, m. A geological surface crossing a litho
   * unit within this distance of a litho contact snaps to the contact instead
   * of dividing it (no sliver). Range 0.01–2.0 m. Default 0.30.
   *
   * Read by the BACKEND planner (``DivideBoreholes.plan`` /
   * ``SubdivideAllBodies`` via ``_read_geotech_snap_tolerance_m``), which is
   * why it is mirrored here even though no settings control edits it yet: the
   * patch below overwrites the whole ``geotech_subdivision`` bag, so a key this
   * module does not know about is silently dropped on the next prefs save —
   * which would reset the planner's tolerance behind the engineer's back. It
   * also lets the borehole packing preview refetch when the value changes.
   */
  lithoSnapToleranceM: number
}

export const GEOTECH_SUBDIVISION_DEFAULTS: GeotechSubdivisionPrefs = {
  minimumLayerThicknessM: 0.35,
  gradientSnapEnabled: true,
  gradientSnapWindowM: 0.5,
  // Matches _DEFAULT_GEOTECH_SNAP_TOLERANCE_M in the backend materialiser.
  lithoSnapToleranceM: 0.3,
}

export const GEOTECH_SUBDIVISION_BOUNDS = {
  minimumLayerThicknessM: { min: 0.1, max: 3.0 },
  gradientSnapWindowM: { min: 0.1, max: 2.0 },
  lithoSnapToleranceM: { min: 0.01, max: 2.0 },
} as const

const VIEW_STATE_KEY = 'geotech_subdivision'

/**
 * Read the geotech-subdivision prefs out of a project's ``view_state`` bag.
 *
 * Missing key, malformed value, or out-of-range numbers all fall back to the
 * per-field default — best-effort persistence, not a contract. Each field
 * defaults independently so a corrupt snap-window doesn't wipe a valid
 * min-thickness setting.
 */
export function readGeotechSubdivisionPrefs(
  viewState: Record<string, unknown> | null | undefined,
): GeotechSubdivisionPrefs {
  const d = readViewStateBag(viewState, VIEW_STATE_KEY)
  if (!d) return { ...GEOTECH_SUBDIVISION_DEFAULTS }
  return {
    minimumLayerThicknessM: readBoundedNumber(
      d.minimum_layer_thickness_m,
      GEOTECH_SUBDIVISION_BOUNDS.minimumLayerThicknessM,
      GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
    ),
    gradientSnapEnabled:
      typeof d.gradient_snap_enabled === 'boolean'
        ? d.gradient_snap_enabled
        : GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapEnabled,
    gradientSnapWindowM: readBoundedNumber(
      d.gradient_snap_window_m,
      GEOTECH_SUBDIVISION_BOUNDS.gradientSnapWindowM,
      GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapWindowM,
    ),
    lithoSnapToleranceM: readBoundedNumber(
      d.litho_snap_tolerance_m,
      GEOTECH_SUBDIVISION_BOUNDS.lithoSnapToleranceM,
      GEOTECH_SUBDIVISION_DEFAULTS.lithoSnapToleranceM,
    ),
  }
}

/**
 * Build the patch payload for ``applyViewStatePatch`` so the prefs survive
 * the next save. Shallow-merge contract: only the ``geotech_subdivision`` key
 * is overwritten; sibling keys (litho_segmenter, cpt_channels, …) are
 * preserved by the server-side merge.
 */
export function buildGeotechSubdivisionPatch(
  prefs: GeotechSubdivisionPrefs,
): Record<string, unknown> {
  return {
    [VIEW_STATE_KEY]: {
      minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
      gradient_snap_enabled: prefs.gradientSnapEnabled,
      gradient_snap_window_m: prefs.gradientSnapWindowM,
      // Echoed back deliberately: the merge replaces this whole bag, so
      // omitting a key the BACKEND reads would reset the planner's tolerance
      // to its default the first time any other geotech pref is saved.
      litho_snap_tolerance_m: prefs.lithoSnapToleranceM,
    },
  }
}
