// Shared borehole-exclusion toggle for a geological / lithostratigraphic model.
//
// A model's ``excluded_borehole_ids`` is the bundle-portable source of truth
// for "this borehole does not anchor this model". Both the Geology inspector
// (checkbox roster) and the Lithology inspector (debt #65 "Include again" list)
// flip it the same way, so the mechanics live here once rather than as two
// near-identical 60-line handlers welded to their own model + setter.
//
// The write is OPTIMISTIC (local state updates before the PATCH) and REVERSIBLE
// (an undo command is registered on success). A failed PATCH rolls the local
// state back to server truth. Callers pass their own undo-stack labels and an
// optional success toast — the geo checkbox toggles silently, the litho
// "Include again" confirms.

import type { Dispatch, SetStateAction } from 'react'

import { api } from '../api/client'
import type { GeologicalModelResponse } from '../api/client'
import { log } from '../utils/log'
import type { UndoCommand } from './useUndoStack'
import type { MessageKey } from '../i18n/locales/en'

/** Inputs for {@link toggleBoreholeExclusion}. */
export interface BoreholeExclusionToggleArgs {
  /** The open project's id. */
  projectId: string
  /** The model whose exclusion list is being edited (read for id + list). */
  model: GeologicalModelResponse
  /**
   * Setter for the model in composer state — updated optimistically, then
   * rolled back on failure. Typed as the shared model setter so both the
   * geological and litho model setters fit.
   */
  setModel: Dispatch<SetStateAction<GeologicalModelResponse | null>>
  /** The borehole being included / excluded. */
  boreholeId: string
  /**
   * ``true`` = the user wants the borehole IN the model → remove it from the
   * exclusion list. ``false`` = add it (exclude).
   */
  included: boolean
  /** Push a reversible mutation onto the undo stack (only on PATCH success). */
  pushUndo: (cmd: UndoCommand) => void
  /** Mark the project dirty — model membership changed. */
  markMutated: () => void
  /** Undo-stack label KEY for the include direction (ruling 11). */
  includeDescriptionKey: MessageKey
  /** Undo-stack label KEY for the exclude direction (ruling 11). */
  excludeDescriptionKey: MessageKey
  /** Short label distinguishing the model in the error log ("geo" / "litho"). */
  logLabel: string
  /** Optional confirmation toast, fired ONCE after the PATCH resolves. */
  onSuccessToast?: () => void
}

/**
 * Add or remove a borehole from a model's ``excluded_borehole_ids`` and PATCH
 * the model, optimistically and reversibly.
 *
 * Parameters
 * ----------
 * args : BoreholeExclusionToggleArgs
 *     Project id, the model and its setter, the borehole, the direction, the
 *     undo hooks, and the log / toast labels.
 *
 * Returns
 * -------
 * Promise<void>
 *     Resolves once the PATCH (and, on success, the undo registration and
 *     toast) have run. Never rejects — a PATCH failure is logged and rolled
 *     back, not thrown, so a click can never leave an uncaught rejection.
 */
export async function toggleBoreholeExclusion(args: BoreholeExclusionToggleArgs): Promise<void> {
  const {
    projectId,
    model,
    setModel,
    boreholeId,
    included,
    pushUndo,
    markMutated,
    includeDescriptionKey,
    excludeDescriptionKey,
    logLabel,
    onSuccessToast,
  } = args

  const previousExcluded = model.excluded_borehole_ids
  const current = new Set(previousExcluded)
  // ``included`` = wants IN the model → drop from the exclusion set.
  if (included) current.delete(boreholeId)
  else current.add(boreholeId)
  const nextExcluded = Array.from(current)

  // Optimistic first, then PATCH — the contacts overlay redraws without
  // waiting for the round-trip.
  setModel(prev => (prev === null ? null : { ...prev, excluded_borehole_ids: nextExcluded }))
  try {
    await api.geology.updateModel(projectId, model.id, { excluded_borehole_ids: nextExcluded })
    markMutated()
    const modelId = model.id
    const beforeList = previousExcluded.slice()
    const afterList = nextExcluded.slice()
    pushUndo({
      descriptionKey: included ? includeDescriptionKey : excludeDescriptionKey,
      revert: async () => {
        await api.geology.updateModel(projectId, modelId, { excluded_borehole_ids: beforeList })
        setModel(prev => (prev === null ? null : { ...prev, excluded_borehole_ids: beforeList }))
      },
      reapply: async () => {
        await api.geology.updateModel(projectId, modelId, { excluded_borehole_ids: afterList })
        setModel(prev => (prev === null ? null : { ...prev, excluded_borehole_ids: afterList }))
      },
    })
    onSuccessToast?.()
  } catch (err) {
    log.error('geology', `${logLabel} exclude-borehole failed for ${boreholeId}`, err)
    // Roll back the optimistic state so the UI reflects server truth.
    setModel(prev => (prev === null ? null : { ...prev, excluded_borehole_ids: previousExcluded }))
  }
}
