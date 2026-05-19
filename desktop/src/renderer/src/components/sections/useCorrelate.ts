/**
 * Correlate-mode state for the litho cross-section connect gesture (Slice 4).
 *
 * Owns the two-step "arm source → click target → POST edge" interaction.
 * Mirrors the shape of ``useFocusColumn`` — transient UI state, never
 * persisted to the bundle.
 *
 * State machine
 * -------------
 * Idle   → enterMode()          → Mode (no armed source)
 * Mode   → arm(source)          → Armed (source band highlighted)
 * Armed  → clearArmed()         → Mode  (Esc layer 1; also fired by a
 *                                 click on the armed source band —
 *                                 click-to-un-arm, review C1)
 * Armed  → arm(other source)    → Armed (re-armed on the new source)
 * Mode   → exitMode()           → Idle  (Esc layer 2)
 * Idle   → (no transitions out until enterMode)
 *
 * The hook does NOT call the API — callers (SectionsCanvas) own the
 * network call so the hook stays testable without fetch mocks.
 */

import { useCallback, useState } from 'react'

/** The investigation + formation that is armed as the correlation source. */
export interface CorrelationSource {
  /** Formation id on the litho model. */
  formationId: string
  /** Id of the investigation the unit band sits on. */
  investigationId: string
  /** Human-readable label for the floating tooltip. */
  label: string
}

export interface UseCorrelateResult {
  /** Whether correlate mode is active. */
  correlateMode: boolean
  /** The currently armed source unit, or null when mode is active but nothing is armed. */
  correlationSource: CorrelationSource | null
  /** Enter correlate mode (no-op when already in mode). */
  enterMode: () => void
  /** Exit correlate mode and clear armed state. */
  exitMode: () => void
  /** Arm a source unit. Replaces any prior source (switching investigations). */
  arm: (source: CorrelationSource) => void
  /** Clear the armed source without exiting mode (Esc layer 1). */
  clearArmed: () => void
}

/**
 * Correlate-mode state + callbacks for the litho section connect gesture.
 *
 * Parameters
 * ----------
 * onAxisSwitch : () => void, optional
 *     Called by ``clearAll`` when the section axis switches so the
 *     toolbar can reset mode without the hook knowing the axis value.
 *     Pass ``exitMode`` as the axis-switch handler in the toolbar.
 *
 * Returns
 * -------
 * UseCorrelateResult
 *     All correlate-mode state + action callbacks.
 */
export function useCorrelate(): UseCorrelateResult {
  const [correlateMode, setCorrelateMode] = useState(false)
  const [correlationSource, setCorrelationSource] = useState<CorrelationSource | null>(null)

  const enterMode = useCallback(() => {
    setCorrelateMode(true)
  }, [])

  const exitMode = useCallback(() => {
    setCorrelateMode(false)
    setCorrelationSource(null)
  }, [])

  const arm = useCallback((source: CorrelationSource) => {
    setCorrelationSource(source)
  }, [])

  const clearArmed = useCallback(() => {
    setCorrelationSource(null)
  }, [])

  return { correlateMode, correlationSource, enterMode, exitMode, arm, clearArmed }
}
