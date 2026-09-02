// Tutorial progress persistence (spec §Architecture).
//
// Per-device UI chrome — where the user is in the tutorial — so it lives in
// localStorage, not the .strix bundle (project_decisions_in_bundle.md). Every
// accessor degrades gracefully and never throws: a profile with storage
// disabled, or a corrupt value from an older catalogue, must still boot. Same
// try/catch discipline as onboardingSeen.ts.

import type { TutorialProgress } from './tutorialMachine'

/** The localStorage key. Versioned so a future catalogue re-key can reset. */
export const TUTORIAL_PROGRESS_KEY = 'strix.tutorial.progress.v1'

/**
 * Whether a parsed value is a well-formed {@link TutorialProgress}.
 *
 * Only the SHAPE is validated here (stepId is a string or null; completed is a
 * string array). Whether `stepId` still names a real step is the machine's job
 * (`advance` resets an unknown id), so a catalogue change never bricks storage.
 *
 * @param value  The parsed JSON value.
 * @returns  True when the shape matches.
 */
function isProgress(value: unknown): value is TutorialProgress {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const stepOk = v.stepId === null || typeof v.stepId === 'string'
  const completedOk =
    Array.isArray(v.completed) && v.completed.every(id => typeof id === 'string')
  return stepOk && completedOk
}

/**
 * Load the persisted tutorial progress.
 *
 * Returns
 * -------
 * TutorialProgress | null
 *     The stored progress, or `null` when absent, unparseable, wrong-shaped, or
 *     storage is unavailable — the caller seeds a fresh start.
 */
export function loadTutorialProgress(): TutorialProgress | null {
  try {
    const raw = globalThis.localStorage?.getItem(TUTORIAL_PROGRESS_KEY)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    return isProgress(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Persist the tutorial progress.
 *
 * @param progress  The progress to store. Storage failures are swallowed — a
 *     lost write only means the tutorial does not resume next launch, never a
 *     throw mid-gesture.
 */
export function saveTutorialProgress(progress: TutorialProgress): void {
  try {
    globalThis.localStorage?.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // Storage unavailable — resume is best-effort, never worth a throw.
  }
}

/** Clear the persisted progress (the "Restart tutorial" gesture). */
export function clearTutorialProgress(): void {
  try {
    globalThis.localStorage?.removeItem(TUTORIAL_PROGRESS_KEY)
  } catch {
    // Nothing to do — a failed clear just leaves stale progress, which the
    // machine's unknown-id reset already tolerates.
  }
}
