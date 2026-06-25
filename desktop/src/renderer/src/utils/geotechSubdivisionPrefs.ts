// Per-project preferences for the geotech NAD subdivision ("Subdivide all
// bodies"). Persists in ``project.view_state.geotech_subdivision`` — SEPARATE
// from the litho ``litho_segmenter`` bag so tuning packing never moves
// lithology. Same best-effort read pattern as lithoSegmenterPrefs.ts.

export interface GeotechSubdivisionPrefs {
  /** Thinnest NAD packing band kept; also the persistence a qc change must hold
   *  to move a boundary. Range 0.1–3.0 m. Default 0.35. */
  minimumLayerThicknessM: number
  /** Snap a boundary to a nearby sharp qc break (never less conservative). */
  gradientSnapEnabled: boolean
  /** Max distance a boundary may snap. Range 0.1–2.0 m. Default 0.5. */
  gradientSnapWindowM: number
}

export const GEOTECH_SUBDIVISION_DEFAULTS: GeotechSubdivisionPrefs = {
  minimumLayerThicknessM: 0.35,
  gradientSnapEnabled: true,
  gradientSnapWindowM: 0.5,
}

export const GEOTECH_SUBDIVISION_BOUNDS = {
  minimumLayerThicknessM: { min: 0.1, max: 3.0 },
  gradientSnapWindowM: { min: 0.1, max: 2.0 },
} as const

const VIEW_STATE_KEY = 'geotech_subdivision'

function readBounded(v: unknown, b: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max ? v : fallback
}

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
  const raw =
    viewState && typeof viewState === 'object'
      ? (viewState as Record<string, unknown>)[VIEW_STATE_KEY]
      : null
  if (!raw || typeof raw !== 'object') return { ...GEOTECH_SUBDIVISION_DEFAULTS }
  const d = raw as Record<string, unknown>
  return {
    minimumLayerThicknessM: readBounded(
      d.minimum_layer_thickness_m,
      GEOTECH_SUBDIVISION_BOUNDS.minimumLayerThicknessM,
      GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
    ),
    gradientSnapEnabled:
      typeof d.gradient_snap_enabled === 'boolean'
        ? d.gradient_snap_enabled
        : GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapEnabled,
    gradientSnapWindowM: readBounded(
      d.gradient_snap_window_m,
      GEOTECH_SUBDIVISION_BOUNDS.gradientSnapWindowM,
      GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapWindowM,
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
    },
  }
}
