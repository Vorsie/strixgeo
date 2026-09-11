/**
 * The per-test COLUMN verbs of the section's right-click menu — one builder,
 * two renderers.
 *
 * Two surfaces offer these verbs since the owner's 2026-09-11 ruling that a
 * right-click on a test opens ONE menu:
 *
 *   * ``ColumnContextMenu`` — the menu that opens where the pointer is on a
 *     column but on no accepted litho unit (every axis).
 *   * ``ContactsLayer``'s litho menu — the menu the litho axis opens on a
 *     test, which now carries these verbs ABOVE its accepted-unit verbs.
 *
 * Extracting them here is the "extract on the second copy" rule: the labels,
 * the order and which verb is destructive are decided once, so the two menus
 * cannot drift into offering different things for the same test.
 *
 * Pure — no hooks, no DOM. The caller passes its own translator and the
 * handlers it has wired; a verb whose handler is absent is not built at all
 * (the no-affordance rule: never a disabled row for a verb the engineer
 * cannot reach here).
 */

import type { Translator } from '../../i18n/translate'

/** The handlers a caller can wire; an absent one drops its verb. */
export interface ColumnMenuVerbHandlers {
  /** Enter focus mode on this column (always offered — no gate). */
  onFocus: () => void
  /** Open the test's full chart / borelog detail. */
  onOpenDetail?: () => void
  /** Clear this test's packing subdivision (geotech axis only). */
  onClearSubdivision?: () => void
  /** Hide this column from the section (reversible, project-local). */
  onRemoveFromSection?: () => void
}

/** One built row, renderer-agnostic. */
export interface ColumnMenuVerb {
  /** Stable identity — also the React key. */
  key: 'focusTest' | 'openDetail' | 'clearSubdivision' | 'removeFromSection'
  /** Translated label. */
  label: string
  /** Render in the danger palette (destructive / hiding verbs). */
  danger: boolean
  /** Draw a separating rule above this row. */
  topBorder: boolean
  /** ``data-testid`` for the rendered row. */
  testid: string
  /** The action to run. */
  onClick: () => void
}

/**
 * Build the column verbs for one test, in menu order.
 *
 * @param t - Active-language translator.
 * @param handlers - The verbs the caller has wired.
 * @returns The rows to render, in order; never empty (Focus is ungated).
 */
export function buildColumnMenuVerbs(
  t: Translator,
  handlers: ColumnMenuVerbHandlers,
): ColumnMenuVerb[] {
  const { onFocus, onOpenDetail, onClearSubdivision, onRemoveFromSection } = handlers
  const verbs: ColumnMenuVerb[] = [
    {
      key: 'focusTest',
      label: t('sections.menu.focusTest'),
      danger: false,
      topBorder: false,
      testid: 'column-menu-focus-test',
      onClick: onFocus,
    },
  ]
  if (onOpenDetail) {
    verbs.push({
      key: 'openDetail',
      label: t('sections.menu.openDetail'),
      danger: false,
      topBorder: true,
      testid: 'column-menu-open-detail',
      onClick: onOpenDetail,
    })
  }
  if (onClearSubdivision) {
    verbs.push({
      key: 'clearSubdivision',
      label: t('sections.menu.clearSubdivision'),
      danger: true,
      topBorder: true,
      testid: 'column-menu-clear-subdivision',
      onClick: onClearSubdivision,
    })
  }
  if (onRemoveFromSection) {
    verbs.push({
      key: 'removeFromSection',
      label: t('sections.menu.removeFromSection'),
      danger: true,
      topBorder: true,
      testid: 'column-menu-remove-from-section',
      onClick: onRemoveFromSection,
    })
  }
  return verbs
}
