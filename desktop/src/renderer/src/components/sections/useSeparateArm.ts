// The "Separate" arm state machine (debt #278 R5) — extracted from SectionPanel
// so its lifecycle rules are unit-testable and off the god-component (debt #201).
//
// A Separate arm is the body the engineer picked to separate FROM, one of its
// anchor layers, and its label for the hint chip. It is AXIS-SCOPED and stale-
// prone, so three rules retire it automatically:
//
//   1. ANY axis change — the anchor layer belongs to the arming axis's model, and
//      ``onSeparatePick`` is now wired on BOTH the litho and geotech axes (piece
//      B), so an arm that outlived a switch would commit a cross-axis pick against
//      the wrong model (backend 422 → a phantom "Failed to separate").
//   2. Correlate mode taking over — mutual exclusion, the arm yields the canvas
//      (the Esc cascade only peels one direction).
//   3. Its anchor layer vanishing — a refetch / model change left the arm stale.
//      The functional update leaves a LIVE arm untouched, so an ordinary refetch
//      that still carries the anchor never clears mid-gesture.

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** The body the engineer armed to separate FROM, plus its anchor + hint label. */
export interface SeparateArm {
  /** The armed body's id. */
  bodyId: string
  /** The deterministic anchor layer the separation POSTs through. */
  anchorLayerId: string
  /** The body's display label for the hint chip. */
  label: string
}

/** What the arm's automatic-retire rules read. */
export interface UseSeparateArmOptions {
  /** The active section axis; a change to it clears the arm (rule 1). */
  axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /** Whether contact-correlate mode owns the canvas; true clears the arm (rule 2). */
  correlateMode: boolean
  /** ``layer id → body_id`` over both axes' layers; a vanished anchor clears (rule 3). */
  armBodyIdByLayerId: ReadonlyMap<string, string | null>
}

/** The arm state + the setters the arm/pick handlers drive. */
export interface UseSeparateArmResult {
  /** The live arm, or ``null`` when none is in flight. */
  separateArm: SeparateArm | null
  /** Set / replace the arm (the "Separate from…" handler calls this). */
  setSeparateArm: Dispatch<SetStateAction<SeparateArm | null>>
  /** Clear the arm (Esc, and a committed / cancelled pick). */
  clearSeparateArm: () => void
}

/**
 * Hold the Separate arm and retire it on the three staleness rules above.
 *
 * The arm/pick GESTURE handlers stay in the caller (they need the body-resolution
 * map and the notice/commit callbacks); this hook owns only the state and its
 * automatic-clear lifecycle.
 *
 * Parameters
 * ----------
 * opts : UseSeparateArmOptions
 *     The axis, correlate-mode flag, and layer→body map the retire rules read.
 *
 * Returns
 * -------
 * UseSeparateArmResult
 *     ``separateArm`` + ``setSeparateArm`` + ``clearSeparateArm``.
 */
export function useSeparateArm(opts: UseSeparateArmOptions): UseSeparateArmResult {
  const { axisMode, correlateMode, armBodyIdByLayerId } = opts
  const [separateArm, setSeparateArm] = useState<SeparateArm | null>(null)
  const clearSeparateArm = useCallback(() => setSeparateArm(null), [])

  // Rule 1 — drop the arm on ANY axis change (cross-axis pick guard).
  useEffect(() => {
    setSeparateArm(null)
  }, [axisMode])

  // Rule 2 — yield to correlate mode. Its own effect so each fires on its own dep.
  useEffect(() => {
    if (correlateMode) {
      setSeparateArm(null)
    }
  }, [correlateMode])

  // Rule 3 — drop an arm whose anchor layer no longer exists (stale after a
  // refetch / model change); a live arm whose anchor still resolves is untouched.
  useEffect(() => {
    setSeparateArm(prev => (prev && !armBodyIdByLayerId.has(prev.anchorLayerId) ? null : prev))
  }, [armBodyIdByLayerId])

  return { separateArm, setSeparateArm, clearSeparateArm }
}
