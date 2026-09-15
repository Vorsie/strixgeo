/**
 * useCopyLithoContact — orchestrates one "Shift-drag accepted litho contacts onto
 * another test" drop (installer #35 owner ask, verbatim: *"can't i drag and drop
 * an accepted litho contact onto a new cptm for example. just like the litho
 * boundaries?"* / *"b, both units."*; extended in installer #40 to a MULTI-boundary
 * selection: *"when i select two boundaries, it should put both on the column i
 * drag onto and also the litho body in between"*).
 *
 * It plans the drop with the pure ``planLithoContactCopy`` and then fires the
 * EXISTING litho endpoints — no new API surface:
 *   - empty target → ``bulkCreateLayers`` with the whole copied stack (the unit
 *     above the topmost boundary from the collar, each between-unit, the unit below
 *     the deepest boundary to the terminal), each reusing the source layer's
 *     ``formation_id`` so the copy lands on the SAME litho unit (never a duplicate).
 *   - target with layers → ``splitLayer`` at each boundary (re-finding the spanning
 *     layer after every cut) + ``batchUpdateLayers`` to recompose the units between
 *     consecutive boundaries to the source composition — the "litho body in between".
 *   - the deepest boundary below the target terminal → a warning toast, no write.
 * Each successful drop pushes ONE undo step (``undo.copyLithoContact``).
 *
 * The new accepted layers change the target column's litho stack, so its geotech
 * parent reads stale on the next staleness read (derived, no explicit flag needed).
 *
 * The hook takes its collaborators as params (api slice, litho layer state, the
 * terminal-depth resolver, the undo push, the toast, and a ``settle`` fan-out) so
 * it is testable off the section god-component via ``renderHook``.
 */

import { useCallback } from 'react'

import { t } from '../i18n/translate'
import { log } from '../utils/log'
import {
  planLithoContactCopy,
  type CopySourceLayer,
  type CopyTargetLayer,
} from '../utils/planLithoContactCopy'
import {
  buildCopyLithoContactUndoCommand,
  type CopyLithoContactUndoApi,
} from './copyLithoContactUndo'
import {
  executeLithoContactSplitCopy,
  type SplitCopyTargetLayer,
} from './executeLithoContactSplitCopy'
import type { UndoCommand } from './useUndoStack'
import type { LithoLayerCreateItem, LithoLayerResponse } from '../api/client'

/** One drop the gesture requests. Depths are m below the SOURCE collar. */
export interface CopyLithoContactRequest {
  sourceInvestigationId: string
  /** Every selected boundary's depth below the source collar (a single-element
   *  array is the original single-boundary drop). */
  contactDepthsM: readonly number[]
  targetInvestigationId: string
  targetKind: 'cpt' | 'borehole'
}

/** The endpoints the copy + its undo use — a subset of ``api.geology``. */
export interface CopyLithoContactApi extends CopyLithoContactUndoApi {}

export interface UseCopyLithoContactParams {
  projectId: string
  /** The active litho model id, or null when no litho model is active. */
  modelId: string | null
  /** Every litho layer in the model (both columns are filtered out of this). */
  lithoLayers: readonly LithoLayerResponse[]
  /** Terminal depth (m) of an investigation — CPT ``max_depth_m`` / borehole
   *  ``total_depth_m`` — or null when unknown. */
  terminalDepthM: (investigationId: string, kind: 'cpt' | 'borehole') => number | null
  api: CopyLithoContactApi
  /** Push the one undo step after a successful drop. */
  pushUndo: (cmd: UndoCommand) => void
  /** Toast surface (success / warning / error). */
  toast: (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
  /** Post-write fan-out: mark dirty + refetch litho + request body recompute. */
  settle: () => Promise<void> | void
}

export interface UseCopyLithoContactResult {
  copyLithoContact: (req: CopyLithoContactRequest) => Promise<void>
}

/** One toast never stacks with the previous copy toast. */
const COPY_TOAST_KEY = 'litho-contact-copy'

/**
 * The success toast for a copy: the single-boundary wordings for one boundary, a
 * counted "N boundaries and M units copied" for a multi-boundary drop (owner ask).
 *
 * @param boundaries - How many boundaries were placed.
 * @param units - How many units carry a source composition.
 * @param split - Whether the drop split a target (true) or created a stack (false).
 * @returns The translated toast string.
 */
function copySuccessMessage(boundaries: number, units: number, split: boolean): string {
  if (boundaries <= 1 && units <= (split ? 0 : 2)) {
    return split
      ? t('sections.canvasToast.lithoBoundaryCopied')
      : t('sections.canvasToast.lithoContactCopied')
  }
  return units === 1
    ? t('sections.canvasToast.lithoContactsCopiedOneUnit', { boundaries })
    : t('sections.canvasToast.lithoContactsCopiedManyUnits', { boundaries, units })
}

/**
 * Wire the litho-contact copy orchestration.
 *
 * @param params - The api slice, litho state, terminal-depth resolver, undo push,
 *   toast, and settle fan-out.
 * @returns ``{ copyLithoContact }`` — the drop handler.
 */
export function useCopyLithoContact(
  params: UseCopyLithoContactParams,
): UseCopyLithoContactResult {
  const {
    projectId,
    modelId,
    lithoLayers,
    terminalDepthM,
    api,
    pushUndo,
    toast,
    settle,
  } = params

  const copyLithoContact = useCallback(
    async (req: CopyLithoContactRequest): Promise<void> => {
      if (modelId === null) return
      const { sourceInvestigationId, contactDepthsM, targetInvestigationId, targetKind } = req

      // Accepted layers on each column (a contact/layer is anchored to one XOR).
      const onColumn = (invId: string): LithoLayerResponse[] =>
        lithoLayers.filter(
          l => l.status === 'accepted' && (l.cpt_id === invId || l.borehole_id === invId),
        )
      const sourceLayers: CopySourceLayer[] = onColumn(sourceInvestigationId).map(l => ({
        formation_id: l.formation_id,
        depth_top_m: l.depth_top_m,
        depth_base_m: l.depth_base_m,
      }))
      const targetAccepted = onColumn(targetInvestigationId)
      const targetLayers: CopyTargetLayer[] = targetAccepted.map(l => ({
        id: l.id,
        depth_top_m: l.depth_top_m,
        depth_base_m: l.depth_base_m,
      }))

      const plan = planLithoContactCopy({
        sourceInvestigationId,
        targetInvestigationId,
        contactDepthsM,
        sourceLayers,
        targetLayers,
        targetTerminalDepthM: terminalDepthM(targetInvestigationId, targetKind),
      })

      log.info(
        'section',
        `copy-litho-contact: ${sourceInvestigationId}@[${contactDepthsM
          .map(d => d.toFixed(3))
          .join(', ')}]m → ${targetInvestigationId} plan=${plan.kind}`,
      )

      if (plan.kind === 'noop') {
        // same_column / boundary_exists — nothing changed, nothing to say.
        return
      }
      if (plan.kind === 'refused') {
        if (plan.reason === 'below_terminal') {
          toast('warning', t('sections.canvasToast.lithoContactCopyBelowTerminal'), COPY_TOAST_KEY)
        } else {
          toast('warning', t('sections.canvasToast.lithoContactCopyFailed'), COPY_TOAST_KEY)
        }
        return
      }

      try {
        if (plan.kind === 'create') {
          const createItems: LithoLayerCreateItem[] = plan.items.map(it => ({
            formation_id: it.formation_id,
            depth_top_m: it.depth_top_m,
            depth_base_m: it.depth_base_m,
            status: 'accepted',
            source: 'manual',
            confidence: 'medium',
            cpt_id: targetKind === 'cpt' ? targetInvestigationId : null,
            borehole_id: targetKind === 'borehole' ? targetInvestigationId : null,
          }))
          const created = await api.bulkCreateLayers(projectId, modelId, createItems)
          await settle()
          toast(
            'success',
            copySuccessMessage(plan.depthsM.length, plan.items.length, false),
            COPY_TOAST_KEY,
          )
          pushUndo(
            buildCopyLithoContactUndoCommand(
              {
                kind: 'create',
                projectId,
                modelId,
                createItems,
                createdLayers: created.map(r => ({ id: r.id, depthTopM: r.depth_top_m })),
              },
              api,
              settle,
            ),
          )
        } else {
          // Split at each boundary + recompose the between-units. The executor
          // tracks the evolving column so several boundaries in one target layer
          // all land, and recomposes only the split-created rows (delete-only undo).
          const executorTargetLayers: SplitCopyTargetLayer[] = targetAccepted.map(l => ({
            id: l.id,
            depth_top_m: l.depth_top_m,
            depth_base_m: l.depth_base_m,
            formation_id: l.formation_id,
          }))
          const result = await executeLithoContactSplitCopy(
            api,
            projectId,
            modelId,
            executorTargetLayers,
            plan.splits,
            plan.recomposes,
          )
          await settle()
          toast(
            'success',
            copySuccessMessage(plan.splits.length, result.recomposedCount, true),
            COPY_TOAST_KEY,
          )
          pushUndo(
            buildCopyLithoContactUndoCommand(
              {
                kind: 'split',
                projectId,
                modelId,
                targetLayers: executorTargetLayers,
                splits: plan.splits,
                recomposes: plan.recomposes,
                createdLayers: result.createdLayers,
              },
              api,
              settle,
            ),
          )
        }
      } catch (err) {
        log.warn('section', 'copy-litho-contact: failed', err)
        toast('error', t('sections.canvasToast.lithoContactCopyFailed'), COPY_TOAST_KEY)
      }
    },
    [projectId, modelId, lithoLayers, terminalDepthM, api, pushUndo, toast, settle],
  )

  return { copyLithoContact }
}
