/**
 * The geotech admixture NAD-family question, as a reusable gate.
 *
 * Owner ruling 2026-09-04: before the subdivide classifies a sand unit that
 * carries an admixture the NAD table can read two ways (pure sand 5-8 vs
 * with-admixture 9-12), the engineer must answer "pure or with admixture". The
 * answer is a PERSISTED per-formation column (``nad_admixture_choice``), not a
 * subdivide request field.
 *
 * Both geotech-subdivision entry points must ask (owner ruling walk22b): the
 * Geotech-stage **Build** press (``useGeotechBuildPreflight``) and the
 * Sections-stage **Subdivide** press (``useGeotechSubdivideVerbs``). This hook
 * is the ONE place that logic lives — it owns the dialog state, the persist,
 * and the "run this once everything is answered" continuation — so the two
 * callers cannot drift (extract-on-the-second-copy, CLAUDE.md).
 *
 * The caller supplies its continuation to {@link UseAdmixtureChoiceGateResult.runGated}:
 * when nothing is unanswered the continuation runs immediately; otherwise the
 * dialog opens and the continuation runs after the answers are saved.
 *
 * @module hooks/useAdmixtureChoiceGate
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import type {
  GeologicalFormationResponse,
  LithoLayerResponse,
  NadAdmixtureChoice,
} from '../api/clients/geology.types'
import {
  ambiguousAdmixtureUnits,
  hasUnansweredAdmixtureUnits,
  type AdmixtureUnit,
} from '../utils/admixtureNadChoice'

/** Per-unit answer while the prompt is open (null = not yet chosen). */
export type AdmixtureSelections = Record<string, NadAdmixtureChoice | null>

/** The persist handler shape (from ``useGeologicalModel``). */
type SetNadAdmixtureChoices = (
  entries: readonly { formationId: string; choice: NadAdmixtureChoice }[],
) => Promise<void>

/** What the gate needs from the shell bus + the subdivide scope. */
export interface UseAdmixtureChoiceGateDeps {
  /** Every project formation (from ``geoModel.formations``). May be undefined
   *  under hand-rolled stubs — treated as "nothing to ask". */
  formations: readonly GeologicalFormationResponse[] | undefined
  /** The active model's litho layers — the ACCEPTED picks' formations are the
   *  scope the classifier sees, so this is exactly what to ask about. */
  lithoLayers: readonly LithoLayerResponse[] | undefined
  /** Persist the per-formation answers. Absent under some stubs → no persist. */
  handleSetNadAdmixtureChoices: SetNadAdmixtureChoices | undefined
}

/** The dialog state + actions the toolbar renders and drives. */
export interface UseAdmixtureChoiceGateResult {
  /** True when the model has at least one admixture-ambiguous unit in scope. */
  hasAmbiguousAdmixtureUnits: boolean
  /** Units the prompt is open on, or ``null`` when closed. */
  askingAdmixtures: readonly AdmixtureUnit[] | null
  /** The prompt's current per-unit selection. */
  admixtureSelections: AdmixtureSelections
  /** True while the answers are being saved. */
  admixtureBusy: boolean
  /** Pick a NAD family for one unit in the open prompt. */
  selectAdmixture: (formationId: string, choice: NadAdmixtureChoice) => void
  /**
   * Run ``onProceed`` now if nothing is unanswered; otherwise open the prompt
   * and run ``onProceed`` once the answers are confirmed and saved.
   */
  runGated: (onProceed: () => void) => void
  /** Open the prompt to review / change answers; confirm then runs ``onProceed``. */
  openAdmixtureChoices: (onProceed: () => void) => void
  /** Persist changed answers, then run the stored continuation. Gated on all-answered. */
  confirmAdmixtures: () => Promise<void>
  /** Close the prompt without running the continuation. */
  cancelAdmixtures: () => void
}

/** Where the gate currently is. */
type GatePhase =
  | { kind: 'closed' }
  | {
      kind: 'choosing'
      units: readonly AdmixtureUnit[]
      selections: AdmixtureSelections
      /** What to run once every unit is answered and saved. */
      onProceed: () => void
    }

/** Seed the prompt's per-unit selection from each unit's stored answer. */
function initSelections(units: readonly AdmixtureUnit[]): AdmixtureSelections {
  return Object.fromEntries(units.map(u => [u.formationId, u.choice]))
}

/**
 * Own the admixture NAD-family gate for a geotech-subdivision press.
 *
 * Parameters
 * ----------
 * deps : UseAdmixtureChoiceGateDeps
 *     The project formations, the active model's litho layers (for the scope),
 *     and the persist handler.
 *
 * Returns
 * -------
 * UseAdmixtureChoiceGateResult
 *     The dialog state, the per-unit actions, and the ``runGated`` entry point.
 */
export function useAdmixtureChoiceGate({
  formations,
  lithoLayers,
  handleSetNadAdmixtureChoices,
}: UseAdmixtureChoiceGateDeps): UseAdmixtureChoiceGateResult {
  const [phase, setPhase] = useState<GatePhase>({ kind: 'closed' })
  const [admixtureBusy, setAdmixtureBusy] = useState(false)

  // The formation ids the subdivide will actually classify: the ACCEPTED litho
  // picks' formations, so this is exactly the scope the classifier sees.
  const scopeFormationIds = useMemo(
    () =>
      new Set((lithoLayers ?? []).filter(l => l.status === 'accepted').map(l => l.formation_id)),
    [lithoLayers],
  )
  // The admixture-ambiguous litho units in scope, each with its stored answer.
  const admixtureUnits = useMemo(
    () => ambiguousAdmixtureUnits(formations ?? [], scopeFormationIds),
    [formations, scopeFormationIds],
  )
  // Read through a ref inside the callbacks so a press always acts on the
  // current units without every callback changing identity on each pan.
  const admixtureUnitsRef = useRef(admixtureUnits)
  admixtureUnitsRef.current = admixtureUnits

  const runGated = useCallback((onProceed: () => void) => {
    const units = admixtureUnitsRef.current
    if (hasUnansweredAdmixtureUnits(units)) {
      setPhase({ kind: 'choosing', units, selections: initSelections(units), onProceed })
      return
    }
    onProceed()
  }, [])

  const openAdmixtureChoices = useCallback((onProceed: () => void) => {
    const units = admixtureUnitsRef.current
    if (units.length === 0) return
    setPhase({ kind: 'choosing', units, selections: initSelections(units), onProceed })
  }, [])

  const selectAdmixture = useCallback((formationId: string, choice: NadAdmixtureChoice) => {
    setPhase(p =>
      p.kind === 'choosing'
        ? { ...p, selections: { ...p.selections, [formationId]: choice } }
        : p,
    )
  }, [])

  const confirmAdmixtures = useCallback(async () => {
    if (phase.kind !== 'choosing') return
    const { units, selections, onProceed } = phase
    // Gate: every listed unit must have an answer (the dialog also disables the
    // button, but never trust the view for a write).
    if (!units.every(u => selections[u.formationId] != null)) return
    // Persist only the units whose answer CHANGED — a re-open that changes
    // nothing writes nothing.
    const entries = units
      .filter(u => selections[u.formationId] !== u.choice)
      .map(u => ({
        formationId: u.formationId,
        choice: selections[u.formationId] as NadAdmixtureChoice,
      }))
    if (entries.length > 0 && handleSetNadAdmixtureChoices) {
      setAdmixtureBusy(true)
      try {
        await handleSetNadAdmixtureChoices(entries)
      } catch {
        // The action toasted; keep the prompt open so the answers are not lost.
        setAdmixtureBusy(false)
        return
      }
      setAdmixtureBusy(false)
    }
    setPhase({ kind: 'closed' })
    onProceed()
  }, [phase, handleSetNadAdmixtureChoices])

  const cancelAdmixtures = useCallback(() => {
    setPhase({ kind: 'closed' })
  }, [])

  return {
    hasAmbiguousAdmixtureUnits: admixtureUnits.length > 0,
    askingAdmixtures: phase.kind === 'choosing' ? phase.units : null,
    admixtureSelections: phase.kind === 'choosing' ? phase.selections : {},
    admixtureBusy,
    selectAdmixture,
    runGated,
    openAdmixtureChoices,
    confirmAdmixtures,
    cancelAdmixtures,
  }
}
