// Geology inspector — formation drag-reorder command (pure logic + undo).
//
// Extracted verbatim from GeologyInspector.tsx's ``reorderFormations``
// useCallback (debt #201 god-component decomposition round) so the
// ``useGeologyFormations`` hook stays under the 500-line file cap. The hook
// keeps a thin ``useCallback`` wrapper that builds the deps bag and delegates
// here; behaviour is byte-identical.
//
// The reorder runs in the DISPLAYED (youngest-first) space and inverts the
// index back to ``display_order = (N-1 - i)`` so the data contract and every
// renderer are unchanged — only the human-facing list flips. Debt #35: every
// reordered formation is pinned so the next Build leaves the ordering intact,
// and the undo command restores each row's pre-drag pin state exactly.

import type { Dispatch, SetStateAction } from 'react'

import { api } from '../../../api/client'
import type { GeologicalFormationResponse } from '../../../api/client'
import { log } from '../../../utils/log'
import { compareFormationsOldestFirst } from '../../../utils/formationOrder'
import type { UndoCommand } from '../../../hooks/useUndoStack'

/** Everything the reorder command reads or writes — supplied per-call by the
 *  hook's ``useCallback`` wrapper (the setters are stable ``useState`` ones). */
export interface ReorderFormationsDeps {
  projectId: string
  /** The local formation mirror at call time (the reorder source of truth). */
  formations: GeologicalFormationResponse[]
  /** Visible-formation manifest — the reorder derives its visible list inline. */
  manifestFormationIds: ReadonlySet<string>
  setFormations: Dispatch<SetStateAction<GeologicalFormationResponse[]>>
  setReorderBusy: Dispatch<SetStateAction<boolean>>
  handleFormationUpdated: () => void
  pushUndoCommand: (cmd: UndoCommand) => void
  refetchFormations: () => Promise<void>
}

/**
 * Persist a formation drag-reorder and push its undo command.
 *
 * Derives the visible list INLINE from ``formations`` + ``manifestFormationIds``
 * (the original TDZ-safe form), reorders in youngest-first display space,
 * inverts back to ``display_order``, optimistically updates the local mirror,
 * PATCHes each changed row (pinned), then registers a revert/reapply command
 * that restores both order and the pre-drag pin state.
 *
 * Parameters
 * ----------
 * deps
 *     Local state + bus notifiers (see {@link ReorderFormationsDeps}).
 * sourceId
 *     Id of the dragged formation.
 * targetId
 *     Id of the drop-target formation, or ``'end'`` for the bottom drop zone.
 *
 * Returns
 * -------
 * Promise<void>
 *     Resolves once the PATCHes settle (or the failure path refetches).
 */
export async function reorderFormationsCommand(
  deps: ReorderFormationsDeps,
  sourceId: string,
  targetId: string | 'end',
): Promise<void> {
  const {
    projectId,
    formations,
    manifestFormationIds,
    setFormations,
    setReorderBusy,
    handleFormationUpdated,
    pushUndoCommand,
    refetchFormations,
  } = deps

  if (sourceId === targetId) return
  setReorderBusy(true)
  // Derive visible list inline — cannot close over ``visibleFormations`` (TDZ).
  const previous =
    manifestFormationIds === undefined
      ? formations
      : formations.filter(f => manifestFormationIds.has(f.id))
  // The inspector presents formations YOUNGEST-first (borehole-log /
  // stratigraphic-column reading order), which is the REVERSE of
  // ``display_order`` (ascending = older = the section/3D paint order;
  // see CLAUDE.md "Stratigraphic order"). Run the reorder in this
  // displayed space, then map the displayed index back to
  // ``display_order = (N-1 - i)`` so the data contract and every
  // renderer are unchanged — only the human-facing list flips.
  const displayed = [...previous].reverse()
  const sourceIndex = displayed.findIndex(f => f.id === sourceId)
  if (sourceIndex < 0) {
    setReorderBusy(false)
    return
  }
  const without = displayed.filter(f => f.id !== sourceId)
  const insertAt =
    targetId === 'end' ? without.length : without.findIndex(f => f.id === targetId)
  if (insertAt < 0) {
    setReorderBusy(false)
    return
  }
  const reordered = [
    ...without.slice(0, insertAt),
    displayed[sourceIndex],
    ...without.slice(insertAt),
  ]
  const total = reordered.length
  const changes = reordered
    .map((f, i) => ({
      id: f.id,
      oldOrder: f.display_order,
      newOrder: total - 1 - i,
      // Debt #35: remember the pre-drag pin state so undo can
      // restore it exactly (a formation that was NOT pinned must
      // go back to unpinned on undo, so Build can re-infer it).
      wasPinned: f.pinned_order,
    }))
    .filter(c => c.oldOrder !== c.newOrder)
  if (changes.length === 0) {
    setReorderBusy(false)
    return
  }
  // Optimistic local update (same displayed→display_order
  // inversion). Reordered rows are also pinned locally (debt #35)
  // so the UI matches what the PATCH persists.
  const changedIds = new Set(changes.map(c => c.id))
  setFormations(prev => {
    const byId = new Map(reordered.map((f, i) => [f.id, total - 1 - i]))
    return sortFormations(
      prev.map(f => {
        const idx = byId.get(f.id)
        if (idx === undefined) return f
        return {
          ...f,
          display_order: idx,
          pinned_order: changedIds.has(f.id) ? true : f.pinned_order,
        }
      }),
    )
  })
  try {
    await Promise.all(
      changes.map(c =>
        // Debt #35: pin every reordered formation so the next
        // "Build 3D model" leaves this deliberate ordering intact
        // instead of reverting it via age inference.
        api.geology.updateFormation(projectId, c.id, {
          display_order: c.newOrder,
          pinned_order: true,
        }),
      ),
    )
    for (const c of changes) handleFormationUpdated()
    log.success('geology', `reorderFormations ok updates=${changes.length}`)
    const snapshot = changes.slice()
    pushUndoCommand({
      description: `Reorder ${snapshot.length} formation${snapshot.length === 1 ? '' : 's'}`,
      revert: async () => {
        // Restore BOTH order and the pre-drag pin state (debt #35):
        // a formation that wasn't pinned before the drag must go
        // back to unpinned so Build can re-infer its age order.
        await Promise.all(
          snapshot.map(c =>
            api.geology.updateFormation(projectId, c.id, {
              display_order: c.oldOrder,
              pinned_order: c.wasPinned,
            }),
          ),
        )
        setFormations(prev => {
          const byId = new Map(
            snapshot.map(c => [c.id, { order: c.oldOrder, pinned: c.wasPinned }]),
          )
          return sortFormations(
            prev.map(f => {
              const s = byId.get(f.id)
              return s === undefined
                ? f
                : { ...f, display_order: s.order, pinned_order: s.pinned }
            }),
          )
        })
        handleFormationUpdated()
      },
      reapply: async () => {
        // Redo re-applies the reorder, so re-pin (mirrors forward).
        await Promise.all(
          snapshot.map(c =>
            api.geology.updateFormation(projectId, c.id, {
              display_order: c.newOrder,
              pinned_order: true,
            }),
          ),
        )
        setFormations(prev => {
          const byId = new Map(snapshot.map(c => [c.id, c.newOrder]))
          return sortFormations(
            prev.map(f => {
              const ord = byId.get(f.id)
              return ord === undefined
                ? f
                : { ...f, display_order: ord, pinned_order: true }
            }),
          )
        })
        handleFormationUpdated()
      },
    })
  } catch (err) {
    log.error('geology', 'reorderFormations failed — refetching', err)
    refetchFormations()
  } finally {
    setReorderBusy(false)
  }
}

/**
 * Sort formations oldest-first (``display_order`` ascending, name tiebreak)
 * via the shared ``compareFormationsOldestFirst`` comparator.
 *
 * Parameters
 * ----------
 * rows
 *     Unsorted formation list.
 *
 * Returns
 * -------
 * GeologicalFormationResponse[]
 *     Sorted copy.
 */
export function sortFormations(
  rows: GeologicalFormationResponse[],
): GeologicalFormationResponse[] {
  return [...rows].sort(compareFormationsOldestFirst)
}
