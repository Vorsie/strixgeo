/**
 * Hand split / merge / MOVE / lens-ABSORB of packing sub-bands on the geotech axis —
 * preview, then commit.
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
import { apiFailureMessage } from '../../../utils/apiFailureMessage'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'
import type { UndoCommand } from '../../../hooks/useUndoStack'

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
  // The small-lens absorb: host + lens + host collapse in ONE run merge, so the
  // sheet shows one union preview and undo is one step. The two internal
  // boundaries are carried because the union interval no longer records them
  // and the undo has to re-split at exactly those depths.
  | {
      kind: 'absorb'
      upperHostId: string
      lensId: string
      lowerHostId: string
      upperBoundaryDepthM: number
      lowerBoundaryDepthM: number
    }

/** The one slice of the undo stack this hook needs. */
export interface BandEditUndoStack {
  /** Push a command AFTER its edit succeeded (stack invariant). */
  push(command: UndoCommand): void
}

/** Everything the handlers consume from the SectionsCanvas scope. */
export interface UseGeotechBandEditDeps {
  /** Active geotechnical model; null until "Subdivide all bodies" has run. */
  activeGeotechModel: GeologicalModelResponse | null
  /** Current project id. */
  projectId: string
  /** Ask the shell to refetch geotech layers — the edited column's new band stack. */
  requestGeotechLayersRefetch: () => void
  /**
   * Refetch the geotech packing edge list, since a re-derived class can
   * flag/drop ties. Resolves ``false`` when the refetch failed — the ribbons
   * on screen are then older than the write that just landed.
   */
  refetchGeotechPackingEdges: () => Promise<boolean>
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Schedule the geotech model's body-identity recompute (slice 5). Optional so
   *  hand-rolled test fixtures need not supply it; call sites guard with ``?.()``. */
  requestBodyRecompute?: (kind: 'litho' | 'geotech') => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  /** The section undo stack; every committed band edit pushes onto it. */
  undoStack: BandEditUndoStack
  /**
   * Report the accepted ties this edit flagged, once the view matches the server.
   *
   * Flag-not-drop keeps a broken correlation and badges it, which leaves the engineer
   * to find the badge and judge it later. The owner did exactly that once and asked
   * for the question instead: *"check the correlations after merge ... then prompt
   * user, do you want to delete correlation band because packing densities
   * mismatch?"*. The hook does not own that prompt — it only says what happened, and
   * only after the refetch, so the ids can be resolved against a list that matches
   * the server.
   *
   * Only ever ACCEPTED ties: a pending proposal that stops matching is deleted
   * outright, so it never reaches this.
   */
  onAcceptedTiesFlagged?: (edgeIds: readonly string[]) => void
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
  /**
   * Preview absorbing an enclosed lens into its two hosts — one merge over the
   * ``[upperHost, lens, lowerHost]`` run. The two boundary depths are the lens's
   * top and base today (the undo anchors).
   */
  onRequestAbsorbLens?: (
    upperHostId: string,
    lensId: string,
    lowerHostId: string,
    upperBoundaryDepthM: number,
    lowerBoundaryDepthM: number,
  ) => void
  /**
   * Set a BOREHOLE band's NAD class by hand (owner ask 2026-08-18). Commits
   * DIRECTLY — no consequence sheet: the change is one number, fully undoable
   * (``previousClass`` is the undo anchor), and the sheet exists for edits
   * whose re-derived outcome the engineer cannot see coming. Here the outcome
   * IS the choice.
   */
  onRequestSetBandClass?: (
    bandId: string,
    nadClass: number,
    previousClass: number | null,
  ) => void
  /**
   * Split a BOREHOLE band at the right-click depth (owner #35). Commits
   * DIRECTLY — a borehole split keeps the class on both halves, so there is
   * nothing to re-derive and nothing to preview. Undoable (undo re-merges the
   * two halves, which the borehole merge does by keeping the survivor's class).
   */
  onRequestSplitBandHere?: (bandId: string, depthM: number) => void
  /**
   * Clear ONE test's subdivision (owner ask 2026-08-18) — the escape hatch of
   * first-subdivision-wins: the pipeline presses import already-banded
   * columns as-is, so redoing one column is clear-then-press. Fires
   * immediately (his words: "you can fire it"); the toast names the rebuild.
   */
  onRequestClearColumn?: (investigationId: string, name: string) => void
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
    requestBodyRecompute,
    toast,
    undoStack,
    onAcceptedTiesFlagged,
  } = deps

  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [plan, setPlan] = useState<GeotechBandEditPlanResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const modelId = activeGeotechModel?.id ?? null

  /** Report a failed call using the server's own words when it gave any. */
  const reportFailure = useCallback(
    (err: unknown, fallback: string): void => {
      toast('error', apiFailureMessage(err, fallback))
    },
    [toast],
  )

  /**
   * The shared post-write fan-out — commit, revert and reapply all run it, so
   * undo refreshes the render exactly as the original edit did.
   */
  const settleAfterWrite = useCallback(async (): Promise<boolean> => {
    requestGeotechLayersRefetch()
    const fresh = await refetchGeotechPackingEdges()
    markMutated()
    // The band stack changed on this column, so the TIN-divided borehole bands derived
    // from it are out of date — amber the "Divide boreholes" button, as every other
    // geotech write path does.
    markBoreholesStale()
    // Every band verb (split/merge/move/absorb/remove, and every undo closure)
    // funnels through this fan-out, so ONE bump covers them all: the geotech
    // model's body geometry moved — schedule its identity recompute (slice 5).
    requestBodyRecompute?.('geotech')
    return fresh
  }, [requestGeotechLayersRefetch, refetchGeotechPackingEdges, markMutated, requestBodyRecompute])

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
          reportFailure(err, t('sections.bandEdit.splitPlanFailed'))
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
          reportFailure(err, t('sections.bandEdit.mergePlanFailed'))
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
          reportFailure(err, t('sections.bandEdit.movePlanFailed'))
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const onRequestAbsorbLens = useCallback(
    (
      upperHostId: string,
      lensId: string,
      lowerHostId: string,
      upperBoundaryDepthM: number,
      lowerBoundaryDepthM: number,
    ): void => {
      if (modelId === null) return
      log.info(
        'section',
        `lens-absorb preview: run=[${upperHostId}, ${lensId}, ${lowerHostId}]`,
      )
      setBusy(true)
      void api.geology
        .previewMergeGeotechRun(projectId, modelId, [upperHostId, lensId, lowerHostId])
        .then(result => {
          setPlan(result)
          setPending({
            kind: 'absorb',
            upperHostId,
            lensId,
            lowerHostId,
            upperBoundaryDepthM,
            lowerBoundaryDepthM,
          })
        })
        .catch((err: unknown) => {
          log.warn('section', 'lens-absorb preview failed', err)
          reportFailure(err, t('sections.bandEdit.absorbPlanFailed'))
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const onRequestSetBandClass = useCallback(
    (bandId: string, nadClass: number, previousClass: number | null): void => {
      if (modelId === null) return
      log.info(
        'section',
        `band-set-class: band=${bandId} ${previousClass ?? 'unclassified'} → ${nadClass}`,
      )
      setBusy(true)
      // Write + view fan-out, shared by the first commit and both undo
      // closures. Deliberately NOT settleAfterWrite: its markBoreholesStale
      // would amber "Divide boreholes", and a re-divide is exactly what
      // ERASES a hand class (it rebuilds every borehole band from the
      // donors). A class change moves no geometry, so nothing is out of date.
      const commit = async (cls: number): Promise<number> => {
        const result = await api.geology.setGeotechBandClass(projectId, modelId, bandId, cls)
        requestGeotechLayersRefetch()
        await refetchGeotechPackingEdges()
        markMutated()
        requestBodyRecompute?.('geotech')
        const flaggedIds = result.flagged_edge_ids ?? []
        if (flaggedIds.length > 0) onAcceptedTiesFlagged?.(flaggedIds)
        return flaggedIds.length
      }
      void commit(nadClass)
        .then(flagged => {
          // Undo restores the class the band had. A band that had NONE — the
          // state the soil-family clamp leaves where the only evidence belonged
          // to another soil — cannot be restored: ``set-class`` takes a class,
          // and there is no verb that un-classifies a band. Pushing an entry
          // that quietly reverted to some other class would be worse than
          // having no entry, so the first classification of a band is not
          // undoable (a re-divide, or another hand class, is the way back).
          if (previousClass !== null) {
            undoStack.push({
              descriptionKey: 'undo.setPackingClass',
              revert: async () => {
                await commit(previousClass)
              },
              reapply: async () => {
                await commit(nadClass)
              },
            })
          }
          toast(
            'success',
            flagged === 0
              ? t('sections.bandEdit.classSet', { nadClass })
              : t('sections.bandEdit.classSetFlagged', {
                  nadClass,
                  flagged,
                  word: t(
                    flagged === 1
                      ? 'sections.bandEdit.acceptedTieOne'
                      : 'sections.bandEdit.acceptedTieMany',
                  ),
                }),
          )
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-set-class failed', err)
          reportFailure(err, t('sections.bandEdit.setClassFailed'))
        })
        .finally(() => setBusy(false))
    },
    [
      modelId,
      projectId,
      requestGeotechLayersRefetch,
      refetchGeotechPackingEdges,
      markMutated,
      requestBodyRecompute,
      undoStack,
      toast,
      reportFailure,
      onAcceptedTiesFlagged,
    ],
  )

  const onRequestClearColumn = useCallback(
    (investigationId: string, name: string): void => {
      if (modelId === null) return
      log.info('section', `clear-subdivision: investigation=${investigationId} (${name})`)
      setBusy(true)
      void api.geology
        .clearGeotechColumn(projectId, modelId, investigationId)
        .then(async result => {
          toast(
            'success',
            t('sections.bandEdit.cleared', {
              n: result.deleted_band_count,
              word: t(
                result.deleted_band_count === 1
                  ? 'sections.bandEdit.bandWordOne'
                  : 'sections.bandEdit.bandWordMany',
              ),
              name,
            }),
          )
          // The full fan-out fits here (unlike set-class): the column's bands
          // are GONE, so the divide's amber prompt is the honest next step.
          await settleAfterWrite()
        })
        .catch((err: unknown) => {
          log.warn('section', 'clear-subdivision failed', err)
          reportFailure(err, t('sections.bandEdit.clearFailed'))
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, settleAfterWrite, toast, reportFailure],
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
          descriptionKey: 'undo.movePackingBoundary',
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
          descriptionKey: 'undo.splitPackingBand',
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
      if (edit.kind === 'absorb') {
        // Revert = two splits, top down: the first peels the lens+lower
        // composite off the survivor at the upper boundary, the second splits
        // that fresh row at the lower boundary. Same qc, same intervals, same
        // statistic → the exact prior classes come back. Both created ids are
        // closure-mutable so redo cycles keep working on the fresh rows.
        const { upperHostId, upperBoundaryDepthM, lowerBoundaryDepthM } = edit
        let currentLensId = edit.lensId
        let currentLowerId = edit.lowerHostId
        undoStack.push({
          descriptionKey: 'undo.absorbPackingLens',
          revert: async () => {
            const first = await api.geology.splitGeotechBand(
              projectId,
              modelId,
              upperHostId,
              upperBoundaryDepthM,
            )
            currentLensId = first.created_layer_ids[0]
            const second = await api.geology.splitGeotechBand(
              projectId,
              modelId,
              currentLensId,
              lowerBoundaryDepthM,
            )
            currentLowerId = second.created_layer_ids[0]
            await settleAfterWrite()
          },
          reapply: async () => {
            await api.geology.mergeGeotechRun(projectId, modelId, [
              upperHostId,
              currentLensId,
              currentLowerId,
            ])
            await settleAfterWrite()
          },
        })
        return
      }
      // merge (also the drag-absorb and remove-band paths — they commit through
      // the same verb): re-split the survivor at the carried boundary AND restore
      // each half's pre-merge class + source. A bare re-split re-derives from qc,
      // which lost a class the merge had changed or a hand class it never
      // measured (owner #35: "ctrl+z ... doesn't restore the earlier packing
      // suggestion"). The pre-merge state travels on the merge response.
      const { upperBandId, lowerBandId, boundaryDepthM } = edit
      const restore = {
        upperNadClass: result.pre_merge_upper_nad_class ?? null,
        lowerNadClass: result.pre_merge_lower_nad_class ?? null,
        upperSource: result.pre_merge_upper_source ?? null,
        lowerSource: result.pre_merge_lower_source ?? null,
      }
      let currentLowerId = lowerBandId
      undoStack.push({
        descriptionKey: 'undo.mergePackingBands',
        revert: async () => {
          const undone = await api.geology.splitGeotechBand(
            projectId,
            modelId,
            upperBandId,
            boundaryDepthM,
            restore,
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
            : pending.kind === 'absorb'
              ? await api.geology.mergeGeotechRun(projectId, modelId, [
                  pending.upperHostId,
                  pending.lensId,
                  pending.lowerHostId,
                ])
              : await api.geology.moveGeotechBoundary(
                  projectId,
                  modelId,
                  pending.upperBandId,
                  pending.lowerBandId,
                  pending.newDepthM,
                )
      setPlan(null)
      setPending(null)
      // The write has landed. Everything below is bookkeeping for a fact that
      // is already true on the server, so it runs BEFORE the refresh: a failed
      // refetch is a view problem, and letting it fall into the catch below
      // would report a committed edit as a failure (inviting a second, doubled
      // edit) and leave that edit permanently unundoable.
      pushUndoFor(pending, result)
      // Name the tie consequences. Flag-not-drop (owner 2026-08-07): accepted
      // mismatches are FLAGGED for review, never silently gone; only pending
      // claims (and duplicates on an absorb) are removed.
      const flagged = result.flagged_edge_ids?.length ?? 0
      // Two removals that mean opposite things: a withdrawn machine proposal
      // is the engine changing its mind, a deleted ACCEPTED tie is the
      // engineer's own correlation going away (an absorb can hit a self-loop
      // or a true duplicate it cannot re-anchor). Naming the second as the
      // first is the failure the flag-not-drop ruling exists to prevent.
      const removedAccepted = result.deleted_accepted_edge_ids?.length ?? 0
      const removedPending = result.deleted_edge_ids.length - removedAccepted
      const verb =
        pending.kind === 'split'
          ? 'Band split; both halves re-classified'
          : pending.kind === 'merge'
            ? 'Bands merged; the merged band re-classified'
            : pending.kind === 'absorb'
              ? 'Lens absorbed; the merged band re-classified'
              : 'Boundary moved; both bands re-classified'
      const tieClauses = [
        flagged > 0 ? `${flagged} accepted tie${flagged === 1 ? '' : 's'} flagged for review` : '',
        removedAccepted > 0
          ? `${removedAccepted} accepted tie${removedAccepted === 1 ? '' : 's'} deleted`
          : '',
        removedPending > 0
          ? `${removedPending} pending tie${removedPending === 1 ? '' : 's'} removed`
          : '',
      ].filter(Boolean)
      toast('success', tieClauses.length === 0 ? `${verb}.` : `${verb}; ${tieClauses.join(', ')}.`)
      log.success(
        'section',
        `band-${pending.kind} committed on column ${result.investigation_id}: ` +
          `+${result.created_layer_ids.length} rows, -${result.deleted_layer_ids.length} rows, ` +
          `${flagged} flagged, -${removedAccepted} accepted edges, ` +
          `-${removedPending} pending edges`,
      )
      // The edit stands either way; only the VIEW can be behind. The refetch
      // catches its own failures and reports them as ``false`` rather than
      // throwing, so both shapes are handled: a stale section must never sit
      // under a plain success toast, or the engineer judges his model against
      // correlations the server has already changed.
      let fresh = true
      try {
        fresh = await settleAfterWrite()
      } catch (err) {
        log.warn('section', `band-${pending.kind} refresh after commit failed`, err)
        fresh = false
      }
      if (!fresh) {
        toast('warning', t('sections.bandEdit.savedNotRefreshed'))
      }
      // Ask about the broken correlations while the engineer still has the context of
      // the edit that broke them. After the refetch on purpose: the listener resolves
      // these ids against the on-screen edge list, which has just been re-read.
      const flaggedIds = result.flagged_edge_ids ?? []
      if (flaggedIds.length > 0) onAcceptedTiesFlagged?.(flaggedIds)
    } catch (err) {
      log.warn('section', `band-${pending.kind} commit failed`, err)
      reportFailure(err, t('sections.bandEdit.applyFailed'))
    } finally {
      setBusy(false)
    }
  }, [
    modelId,
    pending,
    projectId,
    settleAfterWrite,
    pushUndoFor,
    toast,
    reportFailure,
    onAcceptedTiesFlagged,
  ])

  const onRequestSplitBandHere = useCallback(
    (bandId: string, depthM: number): void => {
      if (modelId === null) return
      log.info('section', `band-split-here: band=${bandId} depth=${depthM.toFixed(3)} m`)
      setBusy(true)
      // Commit directly — a borehole split keeps the class on both halves, so
      // there is no re-derivation to preview (unlike the CPT split's sheet).
      void api.geology
        .splitGeotechBand(projectId, modelId, bandId, depthM)
        .then(async result => {
          // Undo re-merges the two halves; the borehole merge keeps the
          // survivor's class, so the original band comes back intact.
          pushUndoFor({ kind: 'split', bandId, depthM }, result)
          toast('success', t('sections.bands.toast.splitHere'))
          await settleAfterWrite()
          const flaggedIds = result.flagged_edge_ids ?? []
          if (flaggedIds.length > 0) onAcceptedTiesFlagged?.(flaggedIds)
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-split-here failed', err)
          reportFailure(err, t('sections.bandEdit.applyFailed'))
        })
        .finally(() => setBusy(false))
    },
    [
      modelId,
      projectId,
      pushUndoFor,
      settleAfterWrite,
      toast,
      reportFailure,
      onAcceptedTiesFlagged,
    ],
  )

  return {
    onRequestSplitBand: modelId === null ? undefined : onRequestSplitBand,
    onRequestMergeBands: modelId === null ? undefined : onRequestMergeBands,
    onRequestMoveBoundary: modelId === null ? undefined : onRequestMoveBoundary,
    onRequestAbsorbLens: modelId === null ? undefined : onRequestAbsorbLens,
    onRequestSetBandClass: modelId === null ? undefined : onRequestSetBandClass,
    onRequestSplitBandHere: modelId === null ? undefined : onRequestSplitBandHere,
    onRequestClearColumn: modelId === null ? undefined : onRequestClearColumn,
    plan,
    busy,
    confirm,
    cancel,
  }
}
