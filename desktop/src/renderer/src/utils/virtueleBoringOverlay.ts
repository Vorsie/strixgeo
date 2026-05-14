// Virtuele Boring (DOV synthetic-borehole) overlay state utilities.
//
// Persisted in ``project.view_state.virtuele_boring`` (JSONB on the
// server, JSON in the .gmproj bundle). The shape is owned by the
// desktop client; the backend stores it opaquely.
//
// State shape:
//   { modelA: "g3dv3_F" | null, modelB: "hcovv2_H" | null }
//
// Two independent dropdowns drive two ghost columns per investigation
// on the section view. ``null`` for either slot = "off" — the user
// can drive either / both. We keep them as an A/B pair (rather than
// an array) so the rendering side has stable column slots even when
// one is toggled off and on.

export interface VirtueleBoringOverlayState {
  /** First active model code, or ``null`` when this slot is off. */
  modelA: string | null
  /** Second active model code, or ``null`` when this slot is off. */
  modelB: string | null
}

export const DEFAULT_VIRTUELE_BORING_OVERLAY: VirtueleBoringOverlayState = {
  modelA: null,
  modelB: null,
}

/** JSON path inside ``project.view_state`` that owns the overlay state. */
export const VIRTUELE_BORING_VIEW_STATE_KEY = 'virtuele_boring'

/**
 * Pull the Virtuele Boring overlay state out of a project's
 * view_state bag, with sensible defaults when keys are missing.
 *
 * Tolerant of hand-edited / migrated bundles — never throws, always
 * returns a usable shape. Non-string slot values collapse to ``null``
 * so a bad value can't render a malformed dropdown selection.
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
  return {
    modelA: typeof dict.modelA === 'string' && dict.modelA ? dict.modelA : null,
    modelB: typeof dict.modelB === 'string' && dict.modelB ? dict.modelB : null,
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
