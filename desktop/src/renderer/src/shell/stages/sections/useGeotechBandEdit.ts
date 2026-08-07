/**
 * Hand split / merge / MOVE of packing sub-bands on the geotech axis — preview, then commit.
 *
 * Owns the two-step the owner's rulings force (docs/debt.md #227, 2026-08-01). Ruling 6
 * says the consequence must be stated before the edit lands; ruling 5 says the consequence
 * must never stop it. So a gesture never writes directly: it previews, the sheet says which
 * way the representative qc moves and what class results, and the commit only goes out if
 * the owner asks for it a second time — at which point nothing in here can refuse.
 *
 * Ruling 4 ("recalculation is local") is enforced server-side, by the column-scoped query
 * behind these endpoints. It shows up here only as a shape: one call, one band pair, no sweep.
 *
 * Ruling 2 is the one refusal that is correct rather than a defect. A depth outside the
 * band's own litho body comes back 422 and is surfaced VERBATIM — the server's message names
 * which wall was hit and which axis to fix it on, and paraphrasing would lose that.
 *
 * UNDO (owner rule "destructive user actions should be undoable"; wired 2026-08-07 with the
 * drag verb): every committed edit pushes a command onto the section undo stack AFTER it
 * succeeds. The inverses are the verbs themselves — a move moves back, a split merges its
 * two halves, a merge re-splits at the carried boundary — and each re-derivation is
 * deterministic (same qc, same interval, same statistic), so undo restores the exact prior
 * classes. Split/merge change row ids across redo cycles; a closure-mutable ``currentLowerId``
 * re-anchors them, the litho delete-undo pattern.
 *
 * FLAG-NOT-DROP (owner 2026-08-07): the server never silently deletes an ACCEPTED tie — a
 * class mismatch flags it for review instead, and this hook's toast names the count. This
 * hook still never creates or deletes a correlation itself.
 */
import { useCallback, useState } from 'react'

import { api } from '../../../api/client'
import type {
  GeologicalModelResponse,
  GeotechBandEditPlanResponse,
  GeotechBandEditResponse,
} from '../../../api/client'
import { markBoreholesStale } from '../../../utils/boreholesStaleStore'
import { log } from '../../../utils/log'

/** The edit being previewed, kept so the commit repeats it exactly. */
type PendingEdit =
  | { kind: 'split'; bandId: string; depthM: number }
  // ``boundaryDepthM`` is the shared boundary BEFORE the merge — the overlay
  // carries it because the plan's single union interval no longer records it,
  // and the undo needs it to re-split exactly there.
  | { kind: 'merge'; upperBandId: string; lowerBandId: string; boundaryDepthM: number }
  | {
      kind: 'move'
      upperBandId: string
      lowerBandId: string
      newDepthM: number
      /** The boundary before the drag — the undo anchor. */
      preDragDepthM: number
    }

/** The one slice of the undo stack this hook needs. */
export interface BandEditUndoStack {
  /** Push a command AFTER its edit succeeded (stack invariant). */
  push(command: {
    description: string
    revert: () => Promise<void>
    reapply: () => Promise<void>
  }): void
}

/** Everything the handlers consume from the SectionsCanvas scope. */
export interface UseGeotechBandEditDeps {
  /** Active geotechnical model; null until "Subdivide all bodies" has run. */
  activeGeotechModel: GeologicalModelResponse | null
  /** Current project id. */
  projectId: string
  /** Ask the shell to refetch geotech layers — the edited column's new band stack. */
  requestGeotechLayersRefetch: () => void
  /** Refetch the geotech packing edge list, since a re-derived class can flag/drop ties. */
  refetchGeotechPackingEdges: () => Promise<void>
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  /** The section undo stack; every committed band edit pushes onto it. */
  undoStack: BandEditUndoStack
}

/** The preview lifecycle plus the request handlers. */
export interface UseGeotechBandEditResult {
  /** Preview splitting a band at a depth. Undefined when there is no geotech model. */
  onRequestSplitBand?: (bandId: string, depthM: number) => void
  /**
   * Preview merging two adjacent bands. ``boundaryDepthM`` is their shared
   * boundary today (the undo anchor). Undefined when there is no geotech model.
   */
  onRequestMergeBands?: (upperBandId: string, lowerBandId: string, boundaryDepthM: number) => void
  /**
   * Preview dragging the pair's shared boundary to ``newDepthM``.
   * ``preDragDepthM`` is where it started (the undo anchor).
   */
  onRequestMoveBoundary?: (
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
    preDragDepthM: number,
  ) => void
  /** What the pending edit would do; null when no sheet is open. */
  plan: GeotechBandEditPlanResponse | null
  /** True while a preview or a commit is in flight. */
  busy: boolean
  /** Commit the previewed edit. Never refuses on qc grounds — that is ruling 5. */
  confirm: () => Promise<void>
  /** Dismiss the sheet without writing. */
  cancel: () => void
}

/**
 * Wire the packing-band hand edits to their endpoints.
 *
 * Parameters
 * ----------
 * deps : UseGeotechBandEditDeps
 *     Shell state and actions the handlers close over.
 *
 * Returns
 * -------
 * UseGeotechBandEditResult
 *     The request handlers, the pending plan, and the confirm / cancel pair.
 */
export function useGeotechBandEdit(deps: UseGeotechBandEditDeps): UseGeotechBandEditResult {
  const {
    activeGeotechModel,
    projectId,
    requestGeotechLayersRefetch,
    refetchGeotechPackingEdges,
    markMutated,
    toast,
    undoStack,
  } = deps

  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [plan, setPlan] = useState<GeotechBandEditPlanResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const modelId = activeGeotechModel?.id ?? null

  /** Report a failed call using the server's own words when it gave any. */
  const reportFailure = useCallback(
    (err: unknown, fallback: string): void => {
      // ``post()`` throws ``new Error(detail.detail)`` for non-2xx, so on a 422 the message
      // IS the domain message — the one that names the wall and the axis to fix it on.
      const message = err instanceof Error ? err.message : fallback
      toast('error', message)
    },
    [toast],
  )

  /**
   * The shared post-write fan-out — commit, revert and reapply all run it, so
   * undo refreshes the render exactly as the original edit did.
   */
  const settleAfterWrite = useCallback(async (): Promise<void> => {
    requestGeotechLayersRefetch()
    await refetchGeotechPackingEdges()
    markMutated()
    // The band stack changed on this column, so the TIN-divided borehole bands derived
    // from it are out of date — amber the "Divide boreholes" button, as every other
    // geotech write path does.
    markBoreholesStale()
  }, [requestGeotechLayersRefetch, refetchGeotechPackingEdges, markMutated])

  const onRequestSplitBand = useCallback(
    (bandId: string, depthM: number): void => {
      if (modelId === null) return
      log.info('section', `band-split preview: band=${bandId} depth=${depthM.toFixed(3)} m`)
      setBusy(true)
      void api.geology
        .previewSplitGeotechBand(projectId, modelId, bandId, depthM)
        .then(result => {
          setPlan(result)
          setPending({ kind: 'split', bandId, depthM })
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-split preview failed', err)
          reportFailure(err, 'Could not work out what that split would do — try again.')
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const onRequestMergeBands = useCallback(
    (upperBandId: string, lowerBandId: string, boundaryDepthM: number): void => {
      if (modelId === null) return
      log.info('section', `band-merge preview: upper=${upperBandId} lower=${lowerBandId}`)
      setBusy(true)
      void api.geology
        .previewMergeGeotechBands(projectId, modelId, upperBandId, lowerBandId)
        .then(result => {
          setPlan(result)
          setPending({ kind: 'merge', upperBandId, lowerBandId, boundaryDepthM })
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-merge preview failed', err)
          reportFailure(err, 'Could not work out what that merge would do — try again.')
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const onRequestMoveBoundary = useCallback(
    (
      upperBandId: string,
      lowerBandId: string,
      newDepthM: number,
      preDragDepthM: number,
    ): void => {
      if (modelId === null) return
      log.info(
        'section',
        `boundary-move preview: upper=${upperBandId} lower=${lowerBandId} ` +
          `${preDragDepthM.toFixed(3)} → ${newDepthM.toFixed(3)} m`,
      )
      setBusy(true)
      void api.geology
        .previewMoveGeotechBoundary(projectId, modelId, upperBandId, lowerBandId, newDepthM)
        .then(result => {
          setPlan(result)
          setPending({ kind: 'move', upperBandId, lowerBandId, newDepthM, preDragDepthM })
        })
        .catch((err: unknown) => {
          log.warn('section', 'boundary-move preview failed', err)
          reportFailure(err, 'Could not work out what that move would do — try again.')
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const cancel = useCallback((): void => {
    setPlan(null)
    setPending(null)
  }, [])

  /** Push the committed edit's inverse pair onto the section undo stack. */
  const pushUndoFor = useCallback(
    (edit: PendingEdit, result: GeotechBandEditResponse): void => {
      if (modelId === null) return
      if (edit.kind === 'move') {
        const { upperBandId, lowerBandId, newDepthM, preDragDepthM } = edit
        undoStack.push({
          description: 'Move packing boundary',
          revert: async () => {
            await api.geology.moveGeotechBoundary(
              projectId,
              modelId,
              upperBandId,
              lowerBandId,
              preDragDepthM,
            )
            await settleAfterWrite()
          },
          reapply: async () => {
            await api.geology.moveGeotechBoundary(
              projectId,
              modelId,
              upperBandId,
              lowerBandId,
              newDepthM,
            )
            await settleAfterWrite()
          },
        })
        return
      }
      if (edit.kind === 'split') {
        // The merge-back needs the FRESH lower row's id, which changes on every
        // redo cycle — the closure-mutable re-anchor of the litho delete-undo.
        let currentLowerId = result.created_layer_ids[0]
        const { bandId, depthM } = edit
        undoStack.push({
          description: 'Split packing band',
          revert: async () => {
            await api.geology.mergeGeotechBands(projectId, modelId, bandId, currentLowerId)
            await settleAfterWrite()
          },
          reapply: async () => {
            const redo = await api.geology.splitGeotechBand(projectId, modelId, bandId, depthM)
            currentLowerId = redo.created_layer_ids[0]
            await settleAfterWrite()
          },
        })
        return
      }
      // merge (also the drag-absorb and remove-band paths — they commit through
      // the same verb): re-split the survivor at the carried boundary.
      const { upperBandId, lowerBandId, boundaryDepthM } = edit
      let currentLowerId = lowerBandId
      undoStack.push({
        description: 'Merge packing bands',
        revert: async () => {
          const undone = await api.geology.splitGeotechBand(
            projectId,
            modelId,
            upperBandId,
            boundaryDepthM,
          )
          currentLowerId = undone.created_layer_ids[0]
          await settleAfterWrite()
        },
        reapply: async () => {
          await api.geology.mergeGeotechBands(projectId, modelId, upperBandId, currentLowerId)
          await settleAfterWrite()
        },
      })
    },
    [modelId, projectId, undoStack, settleAfterWrite],
  )

  const confirm = useCallback(async (): Promise<void> => {
    if (modelId === null || pending === null) return
    setBusy(true)
    try {
      const result: GeotechBandEditResponse =
        pending.kind === 'split'
          ? await api.geology.splitGeotechBand(projectId, modelId, pending.bandId, pending.depthM)
          : pending.kind === 'merge'
            ? await api.geology.mergeGeotechBands(
                projectId,
                modelId,
                pending.upperBandId,
                pending.lowerBandId,
              )
            : await api.geology.moveGeotechBoundary(
                projectId,
                modelId,
                pending.upperBandId,
                pending.lowerBandId,
                pending.newDepthM,
              )
      setPlan(null)
      setPending(null)
      await settleAfterWrite()
      pushUndoFor(pending, result)
      // Name the tie consequences. Flag-not-drop (owner 2026-08-07): accepted
      // mismatches are FLAGGED for review, never silently gone; only pending
      // claims (and duplicates on an absorb) are removed.
      const flagged = result.flagged_edge_ids?.length ?? 0
      const removed = result.deleted_edge_ids.length
      const verb =
        pending.kind === 'split'
          ? 'Band split; both halves re-classified'
          : pending.kind === 'merge'
            ? 'Bands merged; the merged band re-classified'
            : 'Boundary moved; both bands re-classified'
      const tieClauses = [
        flagged > 0 ? `${flagged} accepted tie${flagged === 1 ? '' : 's'} flagged for review` : '',
        removed > 0 ? `${removed} pending tie${removed === 1 ? '' : 's'} removed` : '',
      ].filter(Boolean)
      toast('success', tieClauses.length === 0 ? `${verb}.` : `${verb}; ${tieClauses.join(', ')}.`)
      log.success(
        'section',
        `band-${pending.kind} committed on column ${result.investigation_id}: ` +
          `+${result.created_layer_ids.length} rows, -${result.deleted_layer_ids.length} rows, ` +
          `${flagged} flagged, -${removed} edges`,
      )
    } catch (err) {
      log.warn('section', `band-${pending.kind} commit failed`, err)
      reportFailure(err, 'Could not apply the edit — try again.')
    } finally {
      setBusy(false)
    }
  }, [modelId, pending, projectId, settleAfterWrite, pushUndoFor, toast, reportFailure])

  return {
    onRequestSplitBand: modelId === null ? undefined : onRequestSplitBand,
    onRequestMergeBands: modelId === null ? undefined : onRequestMergeBands,
    onRequestMoveBoundary: modelId === null ? undefined : onRequestMoveBoundary,
    plan,
    busy,
    confirm,
    cancel,
  }
}
