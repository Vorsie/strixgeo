// The body-identity "pair arm" state machine (debt #278) — one armed
// pick-the-other-body gesture at a time, shared by the "Separate" and "Join with…"
// verbs. Extracted from SectionPanel so its lifecycle rules are unit-testable and
// off the god-component (debt #201).
//
// A pair arm is the verb (``kind``), the body the engineer picked to act FROM,
// one of its anchor layers, and its label for the hint chip. It is AXIS-SCOPED
// and stale-prone, so three rules retire it automatically:
//
//   1. ANY axis change — the anchor layer belongs to the arming axis's model, and
//      the pick is now wired on more than one axis, so an arm that outlived a
//      switch would commit a cross-axis pick against the wrong model (backend 422
//      → a phantom "Failed to …"). Clears on ANY axis change, including
//      geotech → litho.
//   2. Correlate mode taking over — mutual exclusion, the arm yields the canvas
//      (the Esc cascade only peels one direction).
//   3. Its anchor layer vanishing — a refetch / model change left the arm stale.
//      The functional update leaves a LIVE arm untouched, so an ordinary refetch
//      that still carries the anchor never clears mid-gesture.
//
// Only ONE arm exists at a time: arming a Join replaces a live Separate arm and
// vice versa, so verb mutual-exclusion is free — no cross-verb bookkeeping.

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** Which body-identity verb the arm is driving. */
export type PairArmKind = 'separate' | 'join'

/** The body the engineer armed to act FROM, plus the verb, anchor + hint label. */
export interface PairArm {
  /** The verb this arm is driving — routes the armed left-click to its resolver. */
  kind: PairArmKind
  /** The armed body's id. */
  bodyId: string
  /** The deterministic anchor layer the separation / union POSTs through. */
  anchorLayerId: string
  /** The body's display label for the hint chip. */
  label: string
}

/** What the arm's automatic-retire rules read. */
export interface UsePairArmOptions {
  /** The active section axis; a change to it clears the arm (rule 1). */
  axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /** Whether contact-correlate mode owns the canvas; true clears the arm (rule 2). */
  correlateMode: boolean
  /** ``layer id → body_id`` over both axes' layers; a vanished anchor clears (rule 3). */
  armBodyIdByLayerId: ReadonlyMap<string, string | null>
}

/** The arm state + the setters the arm/pick handlers drive. */
export interface UsePairArmResult {
  /** The live arm, or ``null`` when none is in flight. */
  pairArm: PairArm | null
  /** Set / replace the arm (the "Separate from…" / "Join with…" handlers call this). */
  setPairArm: Dispatch<SetStateAction<PairArm | null>>
  /** Clear the arm (Esc, and a committed / cancelled pick). */
  clearPairArm: () => void
}

/**
 * Hold the pair arm and retire it on the three staleness rules above.
 *
 * The arm/pick GESTURE handlers stay in the caller (they need the body-resolution
 * map and the notice/commit callbacks); this hook owns only the state and its
 * automatic-clear lifecycle.
 *
 * Parameters
 * ----------
 * opts : UsePairArmOptions
 *     The axis, correlate-mode flag, and layer→body map the retire rules read.
 *
 * Returns
 * -------
 * UsePairArmResult
 *     ``pairArm`` + ``setPairArm`` + ``clearPairArm``.
 */
export function usePairArm(opts: UsePairArmOptions): UsePairArmResult {
  const { axisMode, correlateMode, armBodyIdByLayerId } = opts
  const [pairArm, setPairArm] = useState<PairArm | null>(null)
  const clearPairArm = useCallback(() => setPairArm(null), [])

  // Rule 1 — drop the arm on ANY axis change (cross-axis pick guard).
  useEffect(() => {
    setPairArm(null)
  }, [axisMode])

  // Rule 2 — yield to correlate mode. Its own effect so each fires on its own dep.
  useEffect(() => {
    if (correlateMode) {
      setPairArm(null)
    }
  }, [correlateMode])

  // Rule 3 — drop an arm whose anchor layer no longer exists (stale after a
  // refetch / model change); a live arm whose anchor still resolves is untouched.
  useEffect(() => {
    setPairArm(prev => (prev && !armBodyIdByLayerId.has(prev.anchorLayerId) ? null : prev))
  }, [armBodyIdByLayerId])

  return { pairArm, setPairArm, clearPairArm }
}
