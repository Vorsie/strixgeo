// Per-project defaults applied at new-cross-section creation time.
//
// Stored in ``project.view_state.section_defaults`` — same mechanism as
// the litho-segmenter prefs (see ``lithoSegmenterPrefs.ts``). The bag
// rides in the .gmproj bundle so a colleague opening the same file
// creates sections with the project's tuning.
//
// These are CREATE-TIME defaults: editing an existing section's buffer
// or V-exag uses the inline controls on the section header and writes
// to that section's row, not these prefs. Changing the project default
// AFTER existing sections were created does NOT retroactively patch
// them — that would surprise the user.

export interface SectionDefaults {
  /** Half-width of the projection corridor in metres for new
   *  sections. Backend default 50 m; the dogfeed project uses
   *  ±35 m. Engineers shrink it for tight foundation footprints
   *  (±15 m) or widen for regional studies (±100 m). */
  bufferM: number
  /** Vertical exaggeration multiplier for new sections. 1.0 is
   *  geometrically honest; regional studies use 2-5x to make thin
   *  layers legible. */
  verticalExaggeration: number
}

export const SECTION_DEFAULTS: SectionDefaults = {
  bufferM: 50.0,
  verticalExaggeration: 1.0,
}

export const SECTION_DEFAULTS_BOUNDS = {
  bufferM: { min: 1.0, max: 1000.0 },
  verticalExaggeration: { min: 0.1, max: 50.0 },
} as const

const VIEW_STATE_KEY = 'section_defaults'

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
 * Read the per-project section-defaults out of ``view_state``. Each
 * field is bounds-checked independently and falls back to the global
 * default on missing / malformed values.
 */
export function readSectionDefaults(
  viewState: Record<string, unknown> | null | undefined,
): SectionDefaults {
  if (!viewState || typeof viewState !== 'object') {
    return { ...SECTION_DEFAULTS }
  }
  const raw = (viewState as Record<string, unknown>)[VIEW_STATE_KEY]
  if (!raw || typeof raw !== 'object') {
    return { ...SECTION_DEFAULTS }
  }
  const dict = raw as Record<string, unknown>
  return {
    bufferM: readBoundedNumber(
      dict.buffer_m,
      SECTION_DEFAULTS_BOUNDS.bufferM,
      SECTION_DEFAULTS.bufferM,
    ),
    verticalExaggeration: readBoundedNumber(
      dict.vertical_exaggeration,
      SECTION_DEFAULTS_BOUNDS.verticalExaggeration,
      SECTION_DEFAULTS.verticalExaggeration,
    ),
  }
}

/**
 * Build the patch payload for ``applyViewStatePatch`` so the defaults
 * survive the next save.
 */
export function buildSectionDefaultsPatch(
  defaults: SectionDefaults,
): Record<string, unknown> {
  return {
    [VIEW_STATE_KEY]: {
      buffer_m: defaults.bufferM,
      vertical_exaggeration: defaults.verticalExaggeration,
    },
  }
}
