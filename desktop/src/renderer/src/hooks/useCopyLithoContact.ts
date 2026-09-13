/**
 * useCopyLithoContact — orchestrates one "Shift-drag an accepted litho contact
 * onto another test" drop (installer #35 owner ask, verbatim: *"can't i drag and
 * drop an accepted litho contact onto a new cptm for example. just like the litho
 * boundaries?"* and, on what the drop should create, *"b, both units."*).
 *
 * It plans the drop with the pure ``planLithoContactCopy`` and then fires the
 * EXISTING litho endpoints — no new API surface:
 *   - empty target → ``bulkCreateLayers`` with the two units, each reusing the
 *     source layer's ``formation_id`` so the copy lands on the SAME litho unit
 *     (never a duplicate). The new accepted layers change the target column's
 *     litho stack, so its geotech parent reads stale on the next staleness read
 *     (derived, no explicit flag needed).
 *   - target with layers → ``splitLayer`` at z; both halves keep their
 *     composition, and the toast says so.
 *   - z below the target terminal → a warning toast, no write.
 * Each successful drop pushes ONE undo step (``undo.copyLithoContact``).
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
import type { UndoCommand } from './useUndoStack'
import type { LithoLayerCreateItem, LithoLayerResponse } from '../api/client'

/** One drop the gesture requests. Depths are m below the SOURCE collar. */
export interface CopyLithoContactRequest {
  sourceInvestigationId: string
  contactDepthM: number
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
      const { sourceInvestigationId, contactDepthM, targetInvestigationId, targetKind } = req

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
      const targetLayers: CopyTargetLayer[] = onColumn(targetInvestigationId).map(l => ({
        id: l.id,
        depth_top_m: l.depth_top_m,
        depth_base_m: l.depth_base_m,
      }))

      const plan = planLithoContactCopy({
        sourceInvestigationId,
        targetInvestigationId,
        contactDepthM,
        sourceLayers,
        targetLayers,
        targetTerminalDepthM: terminalDepthM(targetInvestigationId, targetKind),
      })

      log.info(
        'section',
        `copy-litho-contact: ${sourceInvestigationId}@${contactDepthM.toFixed(3)}m → ${targetInvestigationId} plan=${plan.kind}`,
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
          toast('success', t('sections.canvasToast.lithoContactCopied'), COPY_TOAST_KEY)
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
          const result = await api.splitLayer(projectId, modelId, plan.layerId, plan.depthM)
          await settle()
          // Owner: the toast names that the units were NOT recomposed.
          toast('success', t('sections.canvasToast.lithoBoundaryCopied'), COPY_TOAST_KEY)
          pushUndo(
            buildCopyLithoContactUndoCommand(
              {
                kind: 'split',
                projectId,
                modelId,
                topLayerId: result.top.id,
                bottomLayerId: result.bottom.id,
                splitDepthM: plan.depthM,
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
