// The ghost workspace — the pending (not yet accepted) litho suggestions a
// column carries, and the three rules that govern them. Extracted from
// ``useLithoSuggestions`` (debt #201 — that file is already far past the
// 500-line mark) because these rules are one subject:
//
//   1. HOW A WRITE HAPPENS. ``ghostsByAnchor`` reaches the hook as a prop, so
//      within one tick it is a render SNAPSHOT. The boundary drag commits two
//      edits in a single mouseup (the dragger, then its shared-boundary
//      partner) before React re-renders, so the second read needs a
//      synchronous mirror. Every write goes through ``writeGhostColumn``,
//      which updates the mirror and the React state together.
//
//   2. EVERY GESTURE IS UNDOABLE. Ghost gestures are pure transitions on a
//      snapshot-able value and touch no server row (pending suggestions live
//      only in the renderer until they are accepted), so one undo command is
//      just "restore the column as it was" / "as it became". Owner dogfeed
//      2026-09-11: "a whole suggestion disappeared and i can't redo it any
//      more". A boundary drag costs ONE Ctrl+Z, not two — the follow-up edit
//      folds into the command its primary opened.
//
//   3. GHOSTS BELONG TO THE MODEL THEY WERE SUGGESTED FOR. Switching the
//      active litho model sets the outgoing model's columns aside instead of
//      deleting them, and brings them back when the user returns to it. The
//      live map is emptied on a real switch so a ghost can never be accepted
//      onto the wrong model (the B-1 data-integrity guard this replaces only
//      dropped the FOCUSED anchor, leaving bulk ghosts exposed).
//
// Refusals are never silent: a pure helper that returns its input unchanged
// means "I cannot honour this", and that gets a warning log plus a toast.

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

import type { GeologicalModelResponse } from '../api/client'
import type { BulkAnchorGhost } from './useGeologicalModel'
import type { UndoCommand } from './useUndoStack'
import { log } from '../utils/log'
import { t } from '../i18n/translate'

/**
 * One ghost gesture on the undo stack.
 *
 * ``after`` is mutable: a drag's shared-boundary follow-up extends the command
 * its primary emission opened rather than pushing a second one. The command
 * closes over the entry and reads it at revert / reapply time — the same
 * mutable-capture pattern ``pushAcceptLithoUndo`` uses for its freshly-minted
 * row ids.
 */
interface GhostUndoEntry {
  anchorId: string
  /**
   * The litho model the column belonged to. A command from model A must never
   * write its column into model B's live map while B is active — that is the
   * B-1 data-integrity hazard (a ghost accepted onto the wrong model) arriving
   * through the undo stack instead of the overlay.
   */
  modelId: string | null
  /** The column before the gesture, or ``null`` when the anchor had none. */
  before: BulkAnchorGhost | null
  /** The column after it, mutated when a follow-up folds in. */
  after: BulkAnchorGhost | null
}

/** One model's columns, held while another model is active. */
interface SetAsideGhosts {
  ghosts: ReadonlyMap<string, BulkAnchorGhost>
  focusedAnchorId: string | null
}

export interface UseLithoGhostWorkspaceParams {
  /** The live ghost map (a render snapshot — see the module header). */
  ghostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
  setGhostsByAnchor: Dispatch<SetStateAction<ReadonlyMap<string, BulkAnchorGhost>>>
  setFocusedSuggestAnchorId: Dispatch<SetStateAction<string | null>>
  setLithoSuggesting: Dispatch<SetStateAction<boolean>>
  /** Reads the focused anchor synchronously, for the set-aside snapshot. */
  focusedSuggestAnchorIdRef: { current: string | null }
  /** The model the live ghosts belong to. */
  activeLithoModel: GeologicalModelResponse | null
  pushUndo: (cmd: UndoCommand) => void
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

export interface UseLithoGhostWorkspaceResult {
  /**
   * Run one gesture on an anchor's column: transform, write, make it undoable.
   * A transform that returns its input unchanged is reported as a refusal and
   * nothing is written.
   */
  runGhostGesture: (
    anchorId: string,
    description: string,
    verb: string,
    detail: string,
    transform: (ghost: BulkAnchorGhost) => BulkAnchorGhost,
    options?: { coalesceWithPrevious?: boolean; leaveOpenForFollowUp?: boolean },
  ) => void
}

/**
 * Own the ghost workspace: synchronous writes, undoable gestures, and
 * model-scoped ownership of the pending suggestions.
 *
 * Parameters
 * ----------
 * params : UseLithoGhostWorkspaceParams
 *     The ghost state atoms, the active litho model, and the undo / toast
 *     sinks. See the interface for the per-field contract.
 *
 * Returns
 * -------
 * UseLithoGhostWorkspaceResult
 *     ``runGhostGesture`` — the one entry point every structural verb uses.
 */
export function useLithoGhostWorkspace(
  params: UseLithoGhostWorkspaceParams,
): UseLithoGhostWorkspaceResult {
  const {
    ghostsByAnchor,
    setGhostsByAnchor,
    setFocusedSuggestAnchorId,
    setLithoSuggesting,
    focusedSuggestAnchorIdRef,
    activeLithoModel,
    pushUndo,
    toast,
  } = params

  // Synchronous mirror of the ghost map — see rule 1 in the module header. The
  // authority for a state transition is still the setState updater (it works
  // off ``prev``); the mirror resolves the reads that happen before the next
  // render: the undo snapshots and the refusal check.
  const ghostsRef = useRef<ReadonlyMap<string, BulkAnchorGhost>>(ghostsByAnchor)
  useEffect(() => {
    ghostsRef.current = ghostsByAnchor
  }, [ghostsByAnchor])

  const writeGhostColumn = useCallback(
    (anchorId: string, ghost: BulkAnchorGhost | null): void => {
      const build = (
        prev: ReadonlyMap<string, BulkAnchorGhost>,
      ): ReadonlyMap<string, BulkAnchorGhost> => {
        const next = new Map(prev)
        if (ghost === null) next.delete(anchorId)
        else next.set(anchorId, ghost)
        return next
      }
      ghostsRef.current = build(ghostsRef.current)
      setGhostsByAnchor(build)
    },
    [setGhostsByAnchor],
  )

  /**
   * Report a transform the pure helper REFUSED.
   *
   * A silent refusal is how the owner's 2026-09-11 dogfeed became a mystery,
   * so every one of them gets a warning log AND a toast (his ruling on the
   * round-1 report: "give a notification toast yeah").
   */
  const reportRefusal = useCallback(
    (verb: string, anchorId: string, detail: string): void => {
      log.warn(
        'geology',
        `litho ghost ${verb} refused on anchor=${anchorId} ${detail} — layers kept unchanged`,
      )
      toast('warning', t('litho.ghostEditRefused'))
    },
    [toast],
  )

  // ---- Rule 3: ghosts belong to the model they were suggested for ---------
  //
  // Held in a ref, not state: the set-aside columns are not rendered, and they
  // are session-scoped exactly like the live ones (pending suggestions are
  // renderer-only until accepted).
  const setAsideByModelRef = useRef<Map<string, SetAsideGhosts>>(new Map())
  // The model the live ghosts currently belong to. ``null`` until the first
  // model arrives, which is what tells the effect "this is the first run, there
  // is nothing to switch away FROM".
  const ownerModelRef = useRef<{ id: string; name: string } | null>(null)

  // The most recent gesture pushed onto the undo stack, while it can still
  // absorb a shared-boundary follow-up.
  const openUndoRef = useRef<GhostUndoEntry | null>(null)

  const runGhostGesture = useCallback(
    (
      anchorId: string,
      description: string,
      verb: string,
      detail: string,
      transform: (ghost: BulkAnchorGhost) => BulkAnchorGhost,
      options: { coalesceWithPrevious?: boolean; leaveOpenForFollowUp?: boolean } = {},
    ): void => {
      // Every call consumes the entry the previous gesture left open: only a
      // successful boundary primary opens a new one (below), so a refused or
      // unrelated gesture can never be folded into a stale command.
      const open = openUndoRef.current
      openUndoRef.current = null
      const before = ghostsRef.current.get(anchorId)
      if (before === undefined) return
      const after = transform(before)
      if (after === before) {
        reportRefusal(verb, anchorId, detail)
        return
      }
      writeGhostColumn(anchorId, after)

      if (options.coalesceWithPrevious === true && open !== null && open.anchorId === anchorId) {
        // Same gesture, second emission — the one command now ends here.
        open.after = after
        return
      }
      const entry: GhostUndoEntry = {
        anchorId,
        modelId: ownerModelRef.current?.id ?? null,
        before,
        after,
      }
      openUndoRef.current = options.leaveOpenForFollowUp === true ? entry : null
      const applyIfStillOurModel = (column: BulkAnchorGhost | null): void => {
        // Resolve WITHOUT throwing when the model has moved on: the undo
        // stack's safety net clears the entire history on a thrown revert, and
        // losing every other undo step over a model switch is worse than
        // declining this one.
        if (entry.modelId !== (ownerModelRef.current?.id ?? null)) {
          log.warn(
            'geology',
            `litho ghost undo skipped: step belongs to model ${entry.modelId ?? '(none)'}, active is ${ownerModelRef.current?.id ?? '(none)'}`,
          )
          toast('warning', t('litho.ghostUndoOtherModel'))
          return
        }
        writeGhostColumn(entry.anchorId, column)
      }
      pushUndo({
        description,
        revert: async () => {
          applyIfStillOurModel(entry.before)
        },
        reapply: async () => {
          applyIfStillOurModel(entry.after)
        },
      })
    },
    [pushUndo, reportRefusal, toast, writeGhostColumn],
  )

  // The switch itself. The refs it drives are declared above, next to the undo
  // entry that reads them.
  const activeLithoModelId = activeLithoModel?.id ?? null
  const activeLithoModelName = activeLithoModel?.name ?? null
  useEffect(() => {
    const previous = ownerModelRef.current
    ownerModelRef.current =
      activeLithoModelId === null
        ? null
        : { id: activeLithoModelId, name: activeLithoModelName ?? activeLithoModelId }
    // Keyed on the model ID (a primitive), so a refreshModels that returns a
    // new-but-same model object never reaches this branch.
    if (previous === null || previous.id === activeLithoModelId) return

    const outgoing = ghostsRef.current
    // No incoming model (project closed, model deleted): the live map is
    // cleared as before, but nothing is set aside and nothing is promised —
    // a "comes back when that model is active again" for a model that is
    // gone would be a false promise.
    if (outgoing.size > 0 && activeLithoModelId !== null) {
      setAsideByModelRef.current.set(previous.id, {
        ghosts: outgoing,
        focusedAnchorId: focusedSuggestAnchorIdRef.current,
      })
      log.info(
        'geology',
        `litho ghosts set aside: ${outgoing.size} column(s) on model ${previous.id}`,
      )
      toast(
        'warning',
        outgoing.size === 1
          ? t('litho.ghostsSetAsideOne', { model: previous.name })
          : t('litho.ghostsSetAsideMany', { n: outgoing.size, model: previous.name }),
      )
    }

    const incoming =
      activeLithoModelId === null ? undefined : setAsideByModelRef.current.get(activeLithoModelId)
    if (incoming !== undefined && activeLithoModelId !== null) {
      setAsideByModelRef.current.delete(activeLithoModelId)
      log.info(
        'geology',
        `litho ghosts restored: ${incoming.ghosts.size} column(s) on model ${activeLithoModelId}`,
      )
      toast(
        'success',
        incoming.ghosts.size === 1
          ? t('litho.ghostsRestoredOne', { model: activeLithoModelName ?? activeLithoModelId })
          : t('litho.ghostsRestoredMany', {
              n: incoming.ghosts.size,
              model: activeLithoModelName ?? activeLithoModelId,
            }),
      )
    }

    // Replace the live map wholesale. Emptying it on a switch with nothing to
    // restore is the data-integrity half: a ghost on screen while another model
    // is active would accept onto THAT model.
    const nextGhosts = incoming?.ghosts ?? new Map<string, BulkAnchorGhost>()
    ghostsRef.current = nextGhosts
    setGhostsByAnchor(nextGhosts)
    setFocusedSuggestAnchorId(incoming?.focusedAnchorId ?? null)
    // A suggest fetch in flight against the old model must not leave the button
    // spinning on the new one.
    setLithoSuggesting(false)
    // An undo command captured against the outgoing model would write its
    // column back onto the new model's map. Close the open entry so a stray
    // follow-up cannot extend it either.
    openUndoRef.current = null
    // reason: the setState setters are stable by React contract and the two
    // refs are refs; listing them would only churn this effect's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLithoModelId, activeLithoModelName, toast])

  return { runGhostGesture }
}
