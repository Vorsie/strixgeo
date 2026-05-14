// Virtuele Boring (DOV synthetic-borehole) overlay state utilities.
//
// Persisted in ``project.view_state.virtuele_boring`` (JSONB on the
// server, JSON in the .gmproj bundle). The shape is owned by the
// desktop client; the backend stores it opaquely.
//
// State shape:
//   { modelA, modelB, maxDepthM }
//
//   * modelA / modelB — DOV lagenmodel codes (``"g3dv3_F"``, …) or
//     null for "off". The two slots drive two side-by-side ghost
//     columns on the section view.
//   * maxDepthM — how many metres below the investigation surface to
//     show. Default 30 m, matches typical CPT / borehole depth so
//     the overlay reads as "what's relevant to this test" rather
//     than "DOV's full crustal column down to bedrock."
//     ``null`` = render the full DOV column (rarely useful in
//     practice, but kept available for deep work).
//
// Per-pane visibility (section view / CPT detail / borehole detail)
// lives in localStorage — it's per-user UI chrome, not a project-
// level engineering decision. The section view defaults to ON when
// either slot is armed; the detail panes default to OFF until the
// user explicitly clicks the toggle button.

export interface VirtueleBoringOverlayState {
  /** First active model code, or ``null`` when this slot is off. */
  modelA: string | null
  /** Second active model code, or ``null`` when this slot is off. */
  modelB: string | null
  /** Vertical clip in metres below each investigation's surface.
   * ``null`` = no clip (render the full DOV column down to bedrock). */
  maxDepthM: number | null
}

export const DEFAULT_VIRTUELE_BORING_OVERLAY: VirtueleBoringOverlayState = {
  modelA: null,
  modelB: null,
  maxDepthM: 30,
}

/** JSON path inside ``project.view_state`` that owns the overlay state. */
export const VIRTUELE_BORING_VIEW_STATE_KEY = 'virtuele_boring'

/** Bounds on the user-entered depth control. 1 m is the minimum
 * meaningful clip; 1000 m covers any realistic mining-depth survey
 * while still bounding a runaway value from a hand-edited .gmproj. */
export const VIRTUELE_BORING_MAX_DEPTH_MIN_M = 1
export const VIRTUELE_BORING_MAX_DEPTH_MAX_M = 1000

/**
 * Pull the Virtuele Boring overlay state out of a project's
 * view_state bag, with sensible defaults when keys are missing.
 *
 * Tolerant of hand-edited / migrated bundles — never throws, always
 * returns a usable shape. Non-string slot values collapse to
 * ``null``; non-numeric or out-of-range depths fall back to the
 * default so a bad value can't render an invisible / endless
 * overlay forever.
 */
export function readVirtueleBoringOverlay(
  viewState: Record<string, unknown> | null | undefined,
): VirtueleBoringOverlayState {
  if (!viewState || typeof viewState !== 'object') {
    return { ...DEFAULT_VIRTUELE_BORING_OVERLAY }
  }
  const raw = (viewState as Record<string, unknown>)[VIRTUELE_BORING_VIEW_STATE_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIRTUELE_BORING_OVERLAY }
  const dict = raw as Record<string, unknown>
  const maxDepthRaw = dict.maxDepthM
  let maxDepthM: number | null
  if (maxDepthRaw === null) {
    maxDepthM = null
  } else if (
    typeof maxDepthRaw === 'number' &&
    Number.isFinite(maxDepthRaw) &&
    maxDepthRaw >= VIRTUELE_BORING_MAX_DEPTH_MIN_M &&
    maxDepthRaw <= VIRTUELE_BORING_MAX_DEPTH_MAX_M
  ) {
    maxDepthM = maxDepthRaw
  } else {
    maxDepthM = DEFAULT_VIRTUELE_BORING_OVERLAY.maxDepthM
  }
  return {
    modelA: typeof dict.modelA === 'string' && dict.modelA ? dict.modelA : null,
    modelB: typeof dict.modelB === 'string' && dict.modelB ? dict.modelB : null,
    maxDepthM,
  }
}

/**
 * Return the list of currently-active (non-null) model codes, in
 * A→B order. Empty when both slots are off — callers can short-
 * circuit the predictions fetch on an empty list rather than hitting
 * the backend with an empty ``?models=`` query.
 */
export function activeOverlayModels(state: VirtueleBoringOverlayState): string[] {
  const out: string[] = []
  if (state.modelA) out.push(state.modelA)
  // De-dup the rare case where the user picks the same model in both
  // slots — the backend would happily fetch twice but the UI gets
  // confused with two identical ghost columns.
  if (state.modelB && state.modelB !== state.modelA) out.push(state.modelB)
  return out
}

// ---------------------------------------------------------------------------
// Per-pane visibility — localStorage-backed (per-user UI chrome).
//
// Three panes can render the overlay independently: the cross-
// section view, the CPT detail panel, the borehole detail panel.
// Each carries its own boolean ON/OFF flag, keyed by project id so
// users can tune the same setting differently per project.
// ---------------------------------------------------------------------------

export type VirtueleBoringPane = 'section' | 'cpt' | 'borehole'

const DEFAULT_PANE_VISIBILITY: Record<VirtueleBoringPane, boolean> = {
  // Section view defaults to ON: when the user picks a model in the
  // section pane's overlay strip the ghost columns appear without a
  // second click on the same surface.
  section: true,
  // Detail panes default to OFF — the engineer opted into the
  // overlay on the section view; we don't assume they also want it
  // bursting into the CPT chart / borelog without an explicit click.
  cpt: false,
  borehole: false,
}

function paneStorageKey(projectId: string | null, pane: VirtueleBoringPane): string | null {
  if (!projectId) return null
  return `virtuele_boring_visibility.${projectId}.${pane}`
}

/**
 * Read whether a given pane currently shows the overlay.
 *
 * Returns the per-pane default when the project id is missing
 * (test mounts, welcome screen) or when localStorage isn't
 * available. Tolerates corrupt values.
 */
export function readPaneVisibility(
  projectId: string | null,
  pane: VirtueleBoringPane,
): boolean {
  const key = paneStorageKey(projectId, pane)
  if (!key || typeof window === 'undefined') return DEFAULT_PANE_VISIBILITY[pane]
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    // localStorage can throw under quota or in private mode — fall
    // through to the default.
  }
  return DEFAULT_PANE_VISIBILITY[pane]
}

/**
 * Persist a pane's overlay visibility. No-ops when project id is
 * missing or localStorage isn't writable; the caller's UI still
 * reflects the new value via React state.
 */
export function writePaneVisibility(
  projectId: string | null,
  pane: VirtueleBoringPane,
  next: boolean,
): void {
  const key = paneStorageKey(projectId, pane)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, next ? '1' : '0')
  } catch {
    // Same fallback as the reader — silently ignore quota / private
    // mode failures. The in-memory state stays consistent.
  }
}

// ---------------------------------------------------------------------------
// Per-pane model override — picks a single specific model for the
// detail pane regardless of what the section pane has armed.
//
// State machine:
//
//   * Empty string in localStorage = "follow section" (default). The
//     pane renders whatever the section pane's modelA + modelB show.
//   * A specific model code = override active. The pane renders ONLY
//     that one ghost column, ignoring the section's selection.
//
// Lets the engineer compare a CPT log against (say) hydrogeology
// while the section pane is focused on formation tops. The detail
// panes' DOV button is enabled when an effective model exists —
// either the override OR at least one section slot.
// ---------------------------------------------------------------------------

function paneModelStorageKey(
  projectId: string | null,
  pane: VirtueleBoringPane,
): string | null {
  if (!projectId) return null
  return `virtuele_boring_model.${projectId}.${pane}`
}

/**
 * Read the active model override for a detail pane. Empty string
 * (the default) means "follow section"; the caller treats that as
 * ``null`` and uses the section's modelA / modelB instead.
 */
export function readPaneModelOverride(
  projectId: string | null,
  pane: VirtueleBoringPane,
): string {
  const key = paneModelStorageKey(projectId, pane)
  if (!key || typeof window === 'undefined') return ''
  try {
    const raw = window.localStorage.getItem(key)
    if (typeof raw === 'string') return raw
  } catch {
    // Same fallback as the visibility reader.
  }
  return ''
}

/**
 * Persist a pane's model override. Empty string clears the override
 * (back to "follow section"). No-ops when project id is missing or
 * localStorage isn't writable.
 */
export function writePaneModelOverride(
  projectId: string | null,
  pane: VirtueleBoringPane,
  next: string,
): void {
  const key = paneModelStorageKey(projectId, pane)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, next)
  } catch {
    // Silently ignore quota / private mode failures.
  }
}
