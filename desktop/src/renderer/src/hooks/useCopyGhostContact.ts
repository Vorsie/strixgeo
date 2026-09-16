/**
 * useCopyGhostContact — orchestrates one "Shift-drag a ghost boundary onto
 * another test" drop (installer #42 owner ask, verbatim: *"copying litho's on
 * cptm is still clunky (can we drag copy ghosts also?)"*).
 *
 * The accepted-litho copy (``useCopyLithoContact``) writes ACCEPTED layers via
 * the litho endpoints. This is its sibling for PENDING suggestions: it plans the
 * drop with the pure ``planGhostContactCopy`` and, on a create, builds the
 * target's GHOST column and hands it to ``createGhostColumn`` — the undo-aware
 * ghost-workspace writer (``runGhostCreation``), so the copy is renderer-only,
 * touches no server row, and is ONE Ctrl+Z step like every other ghost gesture.
 * The user then accepts on the target as usual.
 *
 * The hook takes its collaborators as params (the ghost map, the terminal-depth
 * and surface-elevation resolvers, the undo-aware writer, and the toast) so it
 * is testable off the section god-component via ``renderHook``.
 */

import { useCallback } from 'react'

import { t } from '../i18n/translate'
import { log } from '../utils/log'
import {
  planGhostContactCopy,
  type GhostContactCopyPlan,
  type GhostCopySourceSuggestion,
} from '../utils/planGhostContactCopy'
import type { BulkAnchorGhost } from './useGeologicalModel'
import type { LithoLayerSuggestion } from '../api/client'

/** One drop the gesture requests. The whole source ghost column is copied. */
export interface CopyGhostContactRequest {
  sourceInvestigationId: string
  targetInvestigationId: string
  targetKind: 'cpt' | 'borehole'
}

export interface UseCopyGhostContactParams {
  /** Every anchor's ghost column (the unified suggestion map). */
  ghostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
  /** Terminal depth (m) of an investigation — CPT ``max_depth_m`` / borehole
   *  ``total_depth_m`` — or null when unknown. Used to clip a shallow target. */
  terminalDepthM: (investigationId: string, kind: 'cpt' | 'borehole') => number | null
  /** Surface elevation (mTAW) of an investigation — the copied ghost column
   *  renders depth-below-collar against the TARGET's collar, not the source's. */
  surfaceElevationM: (investigationId: string, kind: 'cpt' | 'borehole') => number | null
  /** Write the copied ghost column onto the target as ONE undo step (wired to
   *  the ghost workspace's ``runGhostCreation``). */
  createGhostColumn: (targetAnchorId: string, ghost: BulkAnchorGhost) => void
  /** Toast surface (success / warning / error). */
  toast: (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
}

export interface UseCopyGhostContactResult {
  copyGhostContact: (req: CopyGhostContactRequest) => void
}

/** One toast never stacks with the previous ghost-copy toast. */
const COPY_TOAST_KEY = 'ghost-contact-copy'

/**
 * The success toast: a singular / plural unit count, with the accepted-copy's
 * clipped-boundary note appended when a shallow target dropped units below its
 * own depth (owner 2026-09-16: clip, don't refuse).
 *
 * @param units - How many units landed on the target ghost column.
 * @param dropped - How many units were clipped off below the target's depth.
 * @returns The translated toast string.
 */
function copySuccessMessage(units: number, dropped: number): string {
  const landed =
    units === 1
      ? t('sections.canvasToast.ghostColumnCopiedOne')
      : t('sections.canvasToast.ghostColumnCopiedMany', { units })
  if (dropped <= 0) return landed
  const note =
    dropped === 1
      ? t('sections.canvasToast.lithoContactCopyClippedOne')
      : t('sections.canvasToast.lithoContactCopyClippedMany', { dropped })
  return `${landed} ${note}`
}

/** The warning toast for a refused ghost copy, worded per reason. */
function refusalMessage(reason: Extract<GhostContactCopyPlan, { kind: 'refused' }>['reason']): string {
  switch (reason) {
    case 'target_has_ghost':
      return t('sections.canvasToast.ghostCopyTargetHasGhost')
    case 'mixed_accepted_ghost':
      return t('sections.canvasToast.ghostCopyMixedSelection')
    case 'below_terminal':
      return t('sections.canvasToast.lithoContactCopyBelowTerminal')
    case 'no_pending_ghost':
    default:
      return t('sections.canvasToast.ghostCopyNoPending')
  }
}

/** Project one planned unit onto a fresh manual-pick ghost suggestion — the same
 *  shape ``insertManualGhostLayer`` mints: composition kept, the source test's
 *  measured qc / Dr / NAD nulled (they belong to the source, not the target). */
function toGhostSuggestion(planned: {
  depthTopM: number
  depthBaseM: number
  lithology: string
  admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
}): LithoLayerSuggestion {
  return {
    depth_top_m: planned.depthTopM,
    depth_base_m: planned.depthBaseM,
    suggested_lithology: planned.lithology,
    suggested_admixtures: planned.admixtures.map(a => ({ ...a })),
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'manual_pick',
    parent_formation_id: null,
    spans_boundary: false,
  }
}

/**
 * Wire the ghost-contact copy orchestration.
 *
 * @param params - The ghost map, resolvers, undo-aware writer, and toast.
 * @returns ``{ copyGhostContact }`` — the drop handler.
 */
export function useCopyGhostContact(
  params: UseCopyGhostContactParams,
): UseCopyGhostContactResult {
  const { ghostsByAnchor, terminalDepthM, surfaceElevationM, createGhostColumn, toast } = params

  const copyGhostContact = useCallback(
    (req: CopyGhostContactRequest): void => {
      const { sourceInvestigationId, targetInvestigationId, targetKind } = req

      // A drop on the source column itself does nothing (the overlay filters this
      // too; belt and suspenders).
      if (sourceInvestigationId === targetInvestigationId) return

      const source = ghostsByAnchor.get(sourceInvestigationId)
      if (source === undefined || source.suggestions.length === 0) {
        toast('warning', t('sections.canvasToast.ghostCopyNoPending'), COPY_TOAST_KEY)
        return
      }

      // Effective suggestions — raw depths + composition merged with any user edit
      // (a Strip-admixtures edit, a drag-resize, an Edit-composition change), so
      // the copy carries what the user sees, not the segmenter's raw output.
      const sourceSuggestions: GhostCopySourceSuggestion[] = source.suggestions.map((raw, idx) => {
        const edit = source.edits.get(idx)
        return {
          depthTopM: edit?.depth_top_m ?? raw.depth_top_m,
          depthBaseM: edit?.depth_base_m ?? raw.depth_base_m,
          lithology: edit?.suggested_lithology ?? raw.suggested_lithology,
          admixtures: (edit?.suggested_admixtures ?? raw.suggested_admixtures).map(a => ({ ...a })),
          accepted: source.accepted.has(idx),
          rejected: source.rejected.has(idx),
        }
      })

      // The segmenter leaves a ghost RECORD on every column it ran on, also
      // when it suggested nothing (owner, installer #44: "this test already
      // has suggestions when it clearly does not"). A target is taken only
      // when it holds a PENDING suggestion: one neither accepted nor rejected.
      const target = ghostsByAnchor.get(targetInvestigationId)
      const targetHasPending =
        target !== undefined &&
        target.suggestions.some((_, idx) => !target.accepted.has(idx) && !target.rejected.has(idx))

      const plan = planGhostContactCopy({
        sourceInvestigationId,
        targetInvestigationId,
        sourceSuggestions,
        targetHasGhost: targetHasPending,
        targetTerminalDepthM: terminalDepthM(targetInvestigationId, targetKind),
      })

      log.info(
        'section',
        `copy-ghost-contact: ${sourceInvestigationId} -> ${targetInvestigationId} plan=${plan.kind}`,
      )

      if (plan.kind === 'noop') return
      if (plan.kind === 'refused') {
        toast('warning', refusalMessage(plan.reason), COPY_TOAST_KEY)
        return
      }

      // Build the target's GHOST column (nothing accepted / rejected / edited —
      // the composition is baked into the copied suggestions).
      const targetGhost: BulkAnchorGhost = {
        kind: targetKind,
        surfaceElevationM: surfaceElevationM(targetInvestigationId, targetKind),
        suggestions: plan.suggestions.map(toGhostSuggestion),
        accepted: new Set<number>(),
        rejected: new Set<number>(),
        edits: new Map(),
      }
      createGhostColumn(targetInvestigationId, targetGhost)
      toast(
        'success',
        copySuccessMessage(plan.suggestions.length, plan.droppedBelowTerminalCount),
        COPY_TOAST_KEY,
      )
    },
    [ghostsByAnchor, terminalDepthM, surfaceElevationM, createGhostColumn, toast],
  )

  return { copyGhostContact }
}
