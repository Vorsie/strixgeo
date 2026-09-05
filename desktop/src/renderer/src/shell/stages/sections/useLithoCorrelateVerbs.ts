// The litho-axis correlation review flow (auto-correlate / re-correlate / accept).
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). Owns the two busy
// flags, the re-correlate confirmation state and the five handlers behind the
// litho Correlate caret: the pre-check that opens the overwrite dialog, its
// three resolvers, and the Accept-correlations verb. Bodies are byte-identical
// to the inline originals; only the surrounding declaration moved.

import { useCallback, useState } from 'react'

import { api } from '../../../api/client'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'
import type { GeologicalModelResponse, ProjectResponse } from '../../../api/client'
import type { Coordinator } from '../../ShellContext'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'

/** What the litho correlation verbs need from the shell bus. */
export interface UseLithoCorrelateVerbsDeps {
  project: ProjectResponse
  activeLithoModel: GeologicalModelResponse | null
  selectedSectionId: string | null
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  handleAutoCorrelate: UseGeologicalModelResult['handleAutoCorrelate']
  requestCorrelationEdgesRefetch: UseGeologicalModelResult['requestCorrelationEdgesRefetch']
  requestBodyRecompute: Coordinator['requestBodyRecompute']
}

/** The two busy flags, the re-correlate dialog state + the five verbs. */
export interface UseLithoCorrelateVerbsResult {
  autoCorrelating: boolean
  acceptingCorrelations: boolean
  reCorrelateConfirmOpen: boolean
  reCorrelateAutoEdgeCount: number
  handleAutoCorrelateWithCheck: () => Promise<void>
  handleReCorrelateCancel: () => void
  handleReCorrelateSkip: () => void
  handleReCorrelateConfirm: () => Promise<void>
  handleAcceptCorrelations: () => Promise<void>
}

/**
 * Own the litho auto-correlate / re-correlate / accept-correlations verbs.
 *
 * Parameters
 * ----------
 * deps : UseLithoCorrelateVerbsDeps
 *     Project, active litho model, the open section, toast, and the three
 *     shell actions the verbs fire.
 *
 * Returns
 * -------
 * UseLithoCorrelateVerbsResult
 *     The busy flags, re-correlate dialog state and the five async / sync verbs.
 */
export function useLithoCorrelateVerbs({
  project,
  activeLithoModel,
  selectedSectionId,
  toast,
  handleAutoCorrelate,
  requestCorrelationEdgesRefetch,
  requestBodyRecompute,
}: UseLithoCorrelateVerbsDeps): UseLithoCorrelateVerbsResult {
  const [autoCorrelating, setAutoCorrelating] = useState(false)
  const [acceptingCorrelations, setAcceptingCorrelations] = useState(false)
  // Re-correlate dialog (Slice 4 Half-A): shown when the user clicks
  // Auto-correlate and source='auto' edges already exist.
  const [reCorrelateConfirmOpen, setReCorrelateConfirmOpen] = useState(false)
  const [reCorrelateAutoEdgeCount, setReCorrelateAutoEdgeCount] = useState(0)

  // Re-correlate flow (Slice 4 Half-A):
  //   1. GET the model's correlation edges.
  //   2. Count source='auto' edges.
  //   3. If 0 → fire handleAutoCorrelate immediately (no dialog, first-time users).
  //   4. If >0 → open the ReCorrelateConfirmDialog.
  async function handleAutoCorrelateWithCheck(): Promise<void> {
    if (!project || !activeLithoModel) return
    log.info('sections', 'autoCorrelate check start')
    setAutoCorrelating(true)
    let openedDialog = false
    try {
      // Section-scoped (debt #3): count only THIS section's auto edges, not the
      // whole model's — so re-correlating section A doesn't report section B's
      // suggestions (the confusing "57 edges but I didn't correlate here" bug).
      const edges = await api.geology.listContactCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      // Count only UNAPPROVED auto suggestions — the edges re-correlate would
      // actually delete. Accepted auto-correlations (source='auto' but
      // user_approved=true) are committed and survive a re-run, so warning about
      // them pops a spurious "overwrite?" dialog on a section the user already
      // accepted / never suggested on (dogfeed 2026-06-08).
      const autoCount = edges.filter(
        (e: { source: string; user_approved?: boolean }) =>
          e.source === 'auto' && !e.user_approved,
      ).length
      if (autoCount === 0) {
        // No pending auto suggestions — fire immediately (no dialog).
        // Pass the section so adjacency follows its column order, not map-plane RNG.
        await handleAutoCorrelate(selectedSectionId)
      } else {
        // Existing auto edges found — ask the user what to do.
        // autoCorrelating stays true while the dialog is open so the button
        // remains disabled; the dialog close handlers clear it.
        setReCorrelateAutoEdgeCount(autoCount)
        setReCorrelateConfirmOpen(true)
        openedDialog = true
      }
    } catch (err) {
      log.error('sections', 'autoCorrelate pre-check failed', err)
      toast('error', t('sections.lithoCorr.precheckFailed'))
    } finally {
      // Clear the busy state only when we did NOT open the dialog.
      // The dialog close handlers (cancel/skip/reCorrelate) own the cleanup
      // when openedDialog is true.
      if (!openedDialog) setAutoCorrelating(false)
    }
  }

  function handleReCorrelateCancel(): void {
    setReCorrelateConfirmOpen(false)
    setAutoCorrelating(false)
  }

  function handleReCorrelateSkip(): void {
    setReCorrelateConfirmOpen(false)
    setAutoCorrelating(false)
  }

  async function handleReCorrelateConfirm(): Promise<void> {
    if (!project || !activeLithoModel) return
    setReCorrelateConfirmOpen(false)
    log.info(
      'sections',
      `reCorrelate: deleting ${reCorrelateAutoEdgeCount} auto edge(s) then re-running`,
    )
    try {
      // Section-scoped delete (debt #3): clear only THIS section's auto edges,
      // never a neighbouring section's (the cross-section data-loss bug).
      const del = await api.geology.deleteAutoCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      toast(
        'success',
        t('sections.lithoCorr.cleared', {
          n: del.deleted,
          word: t(
            del.deleted === 1
              ? 'sections.lithoCorr.autoEdgeOne'
              : 'sections.lithoCorr.autoEdgeMany',
          ),
        }),
      )
      await handleAutoCorrelate(selectedSectionId)
    } catch (err) {
      log.error('sections', 'reCorrelate failed', err)
      toast('error', t('sections.lithoCorr.reCorrelateFailed'))
    } finally {
      setAutoCorrelating(false)
    }
  }

  // Accept correlations (#133 Task 19): approve all unapproved contact-level
  // correlation edges in the active section, commit lens bodies, recompute
  // ordinals.  Scoped to the active section so only the engineer's current
  // working section is affected.  SectionsCanvas refreshes contact edges on
  // the next axis / section switch; contact edges are also re-fetched
  // automatically when the section re-mounts.
  const handleAcceptCorrelations = useCallback(async (): Promise<void> => {
    if (!activeLithoModel || !selectedSectionId || acceptingCorrelations) return
    log.info('sections', `acceptCorrelations: section=${selectedSectionId} model=${activeLithoModel.id}`)
    setAcceptingCorrelations(true)
    try {
      const result = await api.geology.acceptContactCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      // The toast only reports the accept count. Lens rows are re-detected
      // automatically inside this accept transaction (the ordinal resolver +
      // lens detector run server-side after the flip); there is no hand-run
      // "Detect lenses" verb (retired 2026-06-06).
      log.success(
        'sections',
        `acceptCorrelations: ${result.edges_accepted} accepted`,
      )
      // The edges flipped to approved server-side; force the canvas to re-GET
      // them so they render as solid ribbons instead of stale dashed
      // suggestions (the canvas's edge state is otherwise only refreshed on a
      // section reselect or auto-correlate). Without this the user sees the
      // suggestion unchanged even though the accept succeeded.
      requestCorrelationEdgesRefetch?.()
      // Newly-approved ties band geometry — schedule the litho identity recompute (slice 5).
      if (result.edges_accepted > 0) requestBodyRecompute('litho')
      toast(
        'success',
        t('sections.lithoCorr.accepted', {
          n: result.edges_accepted,
          word: t(
            result.edges_accepted === 1
              ? 'sections.lithoCorr.correlationOne'
              : 'sections.lithoCorr.correlationMany',
          ),
        }),
      )
    } catch (err) {
      log.error('sections', 'acceptCorrelations: failed', err)
      toast('error', t('sections.lithoCorr.acceptFailed'))
    } finally {
      setAcceptingCorrelations(false)
    }
  }, [
    activeLithoModel,
    selectedSectionId,
    acceptingCorrelations,
    project.id,
    toast,
    requestCorrelationEdgesRefetch,
    requestBodyRecompute,
  ])

  return {
    autoCorrelating,
    acceptingCorrelations,
    reCorrelateConfirmOpen,
    reCorrelateAutoEdgeCount,
    handleAutoCorrelateWithCheck,
    handleReCorrelateCancel,
    handleReCorrelateSkip,
    handleReCorrelateConfirm,
    handleAcceptCorrelations,
  }
}
