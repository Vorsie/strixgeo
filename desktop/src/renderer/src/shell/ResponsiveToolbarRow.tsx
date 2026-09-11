// The stage toolbars' verb row — priority-based overflow instead of clipping.
//
// Every stage toolbar renders its verbs through this one component, so the
// responsive behaviour is defined once. A stage declares its controls as
// specs (id, priority, how to render each presentation, and the rows it
// contributes to the ⋯ menu when it folds); this component measures the
// space it was given, asks the pure planner in ``toolbarOverflow.ts`` what
// fits, and renders that.
//
// The invariant the owner cares about: nothing is ever cut mid-word, and
// every verb is reachable at every width — in the bar, or as a labelled row
// in "⋯ More".
//
// WHY the row keeps ``flex-1 min-w-0``: its ``clientWidth`` then equals the
// space the toolbar's scroll zone can give it, which is exactly the planner's
// budget. Its children keep their own ``min-width: auto``, so if the estimate
// were ever short the children overflow the row and the debt #23
// ``toolbar-scrollable`` ancestor answers with a scrollbar. A wrong estimate
// degrades to "scroll", never to "clip".

import { MoreHorizontal } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import {
  measureToolbarItems,
  planToolbarLayout,
  type ToolbarItemSizing,
  type ToolbarPresentation,
} from './toolbarOverflow'
import { DEFAULT_TOOLBAR_METRICS, type ToolbarMetrics } from './toolbarOverflow_constants'
import { PortalMenu, usePortalMenu, type ToolbarDropdownItem } from './ToolbarPrimitives'
import { useT } from '../i18n/translate'

/** Presentations a control can actually be asked to render. */
export type ToolbarRenderPresentation = Exclude<ToolbarPresentation, 'overflow'>

/**
 * One named section of the ⋯ menu.
 *
 * A stage that declares groups gets its folded rows laid out under a small
 * heading per group, in the order declared here (owner 2026-09-11: *"the more
 * menu is too populated"* — the rows did not shrink, they stopped being one
 * undifferentiated list). A stage that declares none keeps the flat menu.
 */
export interface ToolbarOverflowGroup {
  /** Matches ``ToolbarItemSpec.overflowGroup``. */
  id: string
  /** Already-translated heading text. */
  label: string
}

/** One control in a stage toolbar. */
export interface ToolbarItemSpec extends ToolbarItemSizing {
  /**
   * Render the control. Called with the presentation the planner chose:
   * ``full`` (icon + label), ``compact`` (icon + the designed short label),
   * or ``icon`` (icon only — the primitives move the label into the tooltip
   * and the accessible name).
   */
  render: (presentation: ToolbarRenderPresentation) => JSX.Element
  /**
   * The rows this control contributes to the ⋯ menu when it folds. A control
   * with sub-actions (a dropdown, a split button) lists them; a plain button
   * lists itself under a label that reads standalone ("Delete cross-section",
   * not "Delete").
   *
   * An EMPTY list means the control cannot fold — it stays in the bar even
   * when the row overruns. That is the safe failure mode for a spec whose
   * author forgot the menu rows: the verb overflows into the scrollbar
   * instead of vanishing.
   */
  overflowItems: readonly ToolbarDropdownItem[]
  /**
   * Which ⋯-menu group this control's rows belong to — the ``id`` of one of
   * the row's ``overflowGroups``. Omitted (or naming a group the stage did
   * not declare) puts the rows at the TOP of the menu with no heading, which
   * is conspicuous on purpose: a verb is never dropped for a missing label.
   */
  overflowGroup?: string
  /** Draw a vertical rule before this control when it is visible. */
  separatorBefore?: boolean
}

export interface ResponsiveToolbarRowProps {
  /** Controls in render order, left to right. */
  items: readonly ToolbarItemSpec[]
  /** aria-label for the ⋯ menu. Names the stage so two open menus differ. */
  overflowMenuLabel?: string
  /**
   * Headed sections of the ⋯ menu, in the order they should read. Omitted
   * leaves the menu flat and in declaration order (what every stage did
   * before the Sections stage asked for groups).
   */
  overflowGroups?: readonly ToolbarOverflowGroup[]
  /**
   * How the row learns its width. Injected so tests (and any host that
   * measures differently) can drive the planner without a real layout pass.
   * Defaults to the element's own ``clientWidth``; jsdom answers 0, which the
   * planner reads as "not measured yet" and renders everything at full label.
   */
  measureWidth?: (el: HTMLElement) => number
  /** Text + chrome metrics handed to the estimator. */
  metrics?: ToolbarMetrics
}

/**
 * Stage-toolbar verb row with priority-based overflow.
 *
 * Parameters
 * ----------
 * items
 *     The stage's controls, left to right.
 * overflowMenuLabel
 *     Accessible name for the ⋯ menu.
 * overflowGroups
 *     Headed sections of the ⋯ menu, in reading order; see the interface.
 * measureWidth
 *     Width source; see ``ResponsiveToolbarRowProps``.
 * metrics
 *     Width-estimate metrics; see ``toolbarOverflow_constants.ts``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The flex row, plus a "⋯ More" trigger when anything folded.
 */
export default function ResponsiveToolbarRow({
  items,
  overflowMenuLabel,
  overflowGroups,
  measureWidth = defaultMeasureWidth,
  metrics = DEFAULT_TOOLBAR_METRICS,
}: ResponsiveToolbarRowProps): JSX.Element {
  const t = useT()
  // A caller usually names the stage ("More Sections actions"); the generic
  // fallback keeps the ⋯ menu announced even when it does not.
  const menuLabel = overflowMenuLabel ?? t('shell.moreToolbarActions')
  const rowRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [availablePx, setAvailablePx] = useState(0)
  const { open, anchorRect, toggle, close } = usePortalMenu(moreRef)

  useEffect(() => {
    const el = rowRef.current
    if (el === null) return
    const read = (): void => setAvailablePx(measureWidth(el))
    read()
    // jsdom's setup stubs ResizeObserver to a no-op, so the single `read()`
    // above is the only measurement there — and it answers 0, which the
    // planner treats as "unmeasured" and renders at full label.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measureWidth])

  // Re-measured only on resize; re-planned whenever a label changes (a busy
  // verb reading "Subdividing…" is wider than "1 · Subdivide CPTs").
  const sizingKey = items
    .map(i => `${i.id}:${i.label}:${i.compactLabel ?? ''}:${i.overflowItems.length}`)
    .join('|')

  const plan = useMemo(
    () => {
      const measured = measureToolbarItems(
        items.map(spec => ({
          ...spec,
          // A control with no menu rows has nowhere to fold to.
          foldable: spec.foldable !== false && spec.overflowItems.length > 0,
        })),
        metrics,
      )
      return planToolbarLayout(measured, availablePx, metrics)
    },
    // reason: `sizingKey` is the value-identity of `items` for planning
    // purposes — the array itself is rebuilt on every parent render (it holds
    // fresh closures), so depending on it would re-plan every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sizingKey, availablePx, metrics],
  )

  const overflowIds = new Set(plan.overflowIds)
  const visible = items.filter(i => !overflowIds.has(i.id))
  const menuItems = groupOverflowRows(
    items.filter(i => overflowIds.has(i.id)),
    overflowGroups,
  )

  return (
    <div ref={rowRef} className="flex items-center gap-1 flex-1 min-w-0">
      {visible.map((spec, index) => (
        <Fragment key={spec.id}>
          {/* A rule only earns its place between two visible controls — a
              leading rule reads as a stray tick, and two adjacent rules
              would appear the moment the control between them folds. */}
          {spec.separatorBefore === true && index > 0 && (
            <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />
          )}
          {spec.render(
            (plan.presentation.get(spec.id) ?? 'full') as ToolbarRenderPresentation,
          )}
        </Fragment>
      ))}

      {menuItems.length > 0 && (
        <>
          <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />
          <button
            ref={moreRef}
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={menuLabel}
            title={t('shell.moreActionsTitle', {
              n: menuItems.length,
              actionWord:
                menuItems.length === 1 ? t('shell.actionWordOne') : t('shell.actionWordMany'),
            })}
            data-testid="toolbar-overflow-more"
            className={[
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'text-text-secondary hover:bg-surface-app hover:text-text-primary',
            ].join(' ')}
          >
            <MoreHorizontal size={13} aria-hidden="true" />
            {t('shell.more')}
          </button>
          {open && anchorRect !== null && (
            <PortalMenu
              anchorRect={anchorRect}
              ariaLabel={menuLabel}
              items={menuItems}
              onClose={close}
              align="right"
              widthPx={240}
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Default width source — the row's own content box. */
function defaultMeasureWidth(el: HTMLElement): number {
  return el.clientWidth
}

/**
 * Lay the folded controls' rows out as the ⋯ menu's item list.
 *
 * With no groups declared this is the flat concatenation the menu has always
 * been. With groups it is the same rows re-ordered into the declared group
 * order, the first row of each group carrying that group's heading.
 *
 * Rows whose control names no group — or names one the stage did not declare —
 * lead the menu unheaded rather than being dropped: the owner's invariant is
 * that every verb stays reachable at every width, and a forgotten group label
 * must cost a heading, never a verb.
 *
 * Parameters
 * ----------
 * folded
 *     The controls the planner sent to the ⋯ menu, in declaration order.
 * groups
 *     The stage's declared groups, in reading order; ``undefined`` for a
 *     stage that wants the flat menu.
 *
 * Returns
 * -------
 * ToolbarDropdownItem[]
 *     The menu's rows, top to bottom.
 */
function groupOverflowRows(
  folded: readonly ToolbarItemSpec[],
  groups: readonly ToolbarOverflowGroup[] | undefined,
): ToolbarDropdownItem[] {
  const rowsOf = (specs: readonly ToolbarItemSpec[]): ToolbarDropdownItem[] =>
    specs.flatMap(spec => [...spec.overflowItems])

  if (groups === undefined || groups.length === 0) return rowsOf(folded)

  const declared = new Set(groups.map(g => g.id))
  const ungrouped = folded.filter(
    spec => spec.overflowGroup === undefined || !declared.has(spec.overflowGroup),
  )

  const rows = rowsOf(ungrouped)
  for (const group of groups) {
    const groupRows = rowsOf(folded.filter(spec => spec.overflowGroup === group.id))
    if (groupRows.length === 0) continue
    rows.push({ ...groupRows[0], groupHeader: group.label }, ...groupRows.slice(1))
  }
  return rows
}
