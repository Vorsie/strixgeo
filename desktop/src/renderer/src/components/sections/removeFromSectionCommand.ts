// Pure factory for the "Remove from section" undo command (debt
// 2026-05-23 dogfeed — Ctrl+Z to undo a remove-test-from-section
// gesture). Extracted from ``SectionPanel.handleRemoveFromSection``
// so the wiring is unit-testable without spinning up the whole
// section-render path (column glyphs, ResizeObserver, context-menu
// portal).
//
// The command is closure-captured against the pre-remove list — if
// the user adds OTHER exclusions between this remove and a later
// Ctrl+Z, undo restores the snapshot from THIS removal (the
// intermediate adds are lost). Acceptable for v1; a more surgical
// "remove just id from the live list" undo would need an always-
// fresh read of the section state and isn't worth the wiring for
// the common single-remove-then-undo case.

import type { UndoCommand } from '../../hooks/useUndoStack'

export interface RemoveFromSectionPatch {
  excluded_cpt_ids?: string[]
  excluded_borehole_ids?: string[]
}

export interface RemoveFromSectionCommand {
  /** Execute the remove — fires ``onPatch`` with the next excluded
   *  list. Called once by the gesture handler before the undo
   *  command is pushed onto the stack. */
  firstApply: () => Promise<void>
  /** The undo command to push onto the shared undo stack. ``revert``
   *  restores the pre-remove list; ``reapply`` re-runs the remove. */
  undoCmd: UndoCommand
}

/**
 * Build the firstApply + undo command pair for a "Remove from
 * section" gesture.
 *
 * Parameters
 * ----------
 * kind
 *     Investigation kind being removed.
 * id
 *     Id of the CPT / borehole being removed.
 * section
 *     The section row's CURRENT excluded_*_ids lists. Captured by
 *     reference into the command closures so ``revert`` can PATCH
 *     back to the pre-remove snapshot.
 * onPatch
 *     The section PATCH handler — typically wired to the section
 *     state setter at the App / shell layer.
 *
 * Returns
 * -------
 * RemoveFromSectionCommand
 *     ``firstApply`` to execute the remove, ``undoCmd`` to push onto
 *     the undo stack.
 */
export function buildRemoveFromSectionCommand(
  kind: 'cpt' | 'borehole',
  id: string,
  section: { excluded_cpt_ids: string[]; excluded_borehole_ids: string[] },
  onPatch: (patch: RemoveFromSectionPatch) => Promise<void>,
): RemoveFromSectionCommand {
  if (kind === 'cpt') {
    const prev = [...section.excluded_cpt_ids]
    const next = Array.from(new Set([...prev, id]))
    return {
      firstApply: () => onPatch({ excluded_cpt_ids: next }),
      undoCmd: {
        descriptionKey: 'undo.removeFromSection',
        descriptionParams: { id },
        revert: () => onPatch({ excluded_cpt_ids: prev }),
        reapply: () => onPatch({ excluded_cpt_ids: next }),
      },
    }
  }
  const prev = [...section.excluded_borehole_ids]
  const next = Array.from(new Set([...prev, id]))
  return {
    firstApply: () => onPatch({ excluded_borehole_ids: next }),
    undoCmd: {
      descriptionKey: 'undo.removeFromSection',
      descriptionParams: { id },
      revert: () => onPatch({ excluded_borehole_ids: prev }),
      reapply: () => onPatch({ excluded_borehole_ids: next }),
    },
  }
}
