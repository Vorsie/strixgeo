// Priority-based overflow planning for the stage toolbars.
//
// THE BUG THIS REPLACES (owner dogfeed 2026-08-26). The stage/axis pill in
// SectionsToolbar carried ``overflow-hidden``, and per CSS Flexbox §4.5 a
// flex item's automatic minimum size is ``min-content`` ONLY while its
// overflow is ``visible``. With ``overflow-hidden`` that minimum collapses to
// zero, so flexbox chose the pill as the single item free to absorb the whole
// width deficit — and the pill's own ``overflow-hidden`` then cut its last
// segment mid-word ("Geology | Litho | Geote"). The debt #23 horizontal-scroll
// fallback never fired either, because the pill had already soaked up the
// overflow before the row could exceed the scroll container. The two
// mechanisms silently cancelled each other.
//
// THE MODEL HERE. Each control declares a priority and what presentations it
// can take. The planner is a pure function of (item widths, available width)
// that answers which controls keep their label, which become an
// icon-with-tooltip, and which fold into a "⋯ More" menu — the GitHub Primer
// action-bar ladder. Nothing is ever clipped and nothing is ever unreachable.
//
// WHY A PURE PLANNER RATHER THAN DOM MEASUREMENT: collapsing a control
// changes its width, so a measure-then-collapse loop feeds its own output
// back into its input and flaps at the boundary. Planning from the FULL
// widths every time makes the layout a stable function of the viewport
// (pinned by TO21/TO22).

import {
  DEFAULT_TOOLBAR_METRICS,
  TOOLBAR_SEPARATOR_PX,
  type ToolbarMetrics,
} from './toolbarOverflow_constants'

/**
 * How hard a control fights to keep its label.
 *
 * ``pinned``
 *     Primary mode control. Never folded, never reduced to an icon. Its only
 *     concession is a DESIGNED short form (``compact``).
 * ``high``
 *     Verbs pressed on nearly every pass through the stage.
 * ``medium``
 *     Regular verbs used several times per section.
 * ``low``
 *     Occasional verbs — escape hatches and maintenance.
 */
export type ToolbarPriority = 'pinned' | 'high' | 'medium' | 'low'

/**
 * The form a control takes in the planned row.
 *
 * ``full``     — icon + full label.
 * ``compact``  — icon + the control's designed short label.
 * ``icon``     — icon only; the label moves into the tooltip + accessible name.
 * ``overflow`` — not in the bar; a labelled row in the "⋯ More" menu.
 */
export type ToolbarPresentation = 'full' | 'compact' | 'icon' | 'overflow'

/** Which toolbar primitive renders the control — drives the width estimate. */
export type ToolbarItemKind = 'button' | 'dropdown' | 'split' | 'custom'

/** What the caller declares; ``measureToolbarItems`` turns it into widths. */
export interface ToolbarItemSizing {
  /** Stable id — the planner keys presentations on it. */
  id: string
  priority: ToolbarPriority
  kind: ToolbarItemKind
  /** The label as rendered. Also the row label in the ⋯ menu. */
  label: string
  /** Designed short label. Only meaningful when the control has one. */
  compactLabel?: string
  /**
   * Explicit widths for a control the estimator cannot model (a segmented
   * pill, a count chip). Required for ``kind: 'custom'``.
   */
  widthPx?: { full: number; compact?: number; icon?: number }
  /**
   * Whether an icon-only form is acceptable. Defaults to true. Set false for
   * destructive verbs (docs/ux.md: a bare trash icon is not an acceptable
   * presentation for an irreversible action) and for controls whose LABEL
   * carries state the user must read without hovering (e.g. ``qc: median``).
   */
  iconOnly?: boolean
  /** Whether the control may fold into the ⋯ menu. Defaults to true. */
  foldable?: boolean
  /**
   * The control owns a leading vertical rule. Its width is charged to the
   * control so that folding the control removes the rule from the budget
   * too — which is exactly what the row renders.
   */
  separatorBefore?: boolean
}

/** A sized control, ready for the planner. */
export interface ToolbarItemMeasure {
  id: string
  priority: ToolbarPriority
  fullPx: number
  /** Present only when the control has a designed short form. */
  compactPx?: number
  /** Present only when an icon-only form is allowed. */
  iconPx?: number
  foldable: boolean
}

/** The planner's answer for one row. */
export interface ToolbarPlan {
  /** Presentation per item id — every input id appears exactly once. */
  presentation: ReadonlyMap<string, ToolbarPresentation>
  /** Ids folded into the ⋯ menu, in the caller's declaration order. */
  overflowIds: readonly string[]
  /** Width the planned row occupies, including gaps and the ⋯ trigger. */
  widthPx: number
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Rendered width of a control's chrome (padding, icon, gaps, caret). */
function chromePx(kind: ToolbarItemKind, m: ToolbarMetrics): number {
  switch (kind) {
    case 'button':
      // px-2.5 both sides + a 13 px icon + the gap-1.5 before the label.
      return m.buttonPaddingPx + m.iconPx + m.intraGapPx
    case 'dropdown':
      // …plus the trailing ChevronDown and its own gap.
      return m.buttonPaddingPx + m.iconPx + m.intraGapPx + m.intraGapPx + m.caretIconPx
    case 'split':
      // Primary half (pl-2.5 pr-2 + icon + gap) welded to a caret half.
      return m.buttonPaddingPx - 2 + m.iconPx + m.intraGapPx + m.splitCaretPx + m.caretIconPx
    case 'custom':
      return 0
  }
}

/**
 * Estimate the rendered widths of a toolbar row.
 *
 * Deliberately conservative — see ``toolbarOverflow_constants.ts`` for why an
 * over-estimate is safe and an under-estimate is the bug.
 *
 * Parameters
 * ----------
 * sizings
 *     The controls in the order they render, left to right.
 * metrics
 *     Text + chrome metrics. Injected so a caller (and the tests) can drive
 *     the planner with measurements from somewhere other than the estimator.
 *
 * Returns
 * -------
 * ToolbarItemMeasure[]
 *     One entry per input, same order.
 *
 * Raises
 * ------
 * Error
 *     When a ``custom`` control supplies no explicit ``widthPx.full`` — the
 *     estimator has no way to model it and a silent 0 would let it clip.
 */
export function measureToolbarItems(
  sizings: readonly ToolbarItemSizing[],
  metrics: ToolbarMetrics = DEFAULT_TOOLBAR_METRICS,
): ToolbarItemMeasure[] {
  return sizings.map(s => {
    if (s.kind === 'custom' && s.widthPx?.full === undefined) {
      throw new Error(`toolbar item "${s.id}": kind "custom" needs an explicit widthPx.full`)
    }
    const chrome = chromePx(s.kind, metrics)
    const textPx = (label: string): number => label.length * metrics.charAdvancePx
    const rule = s.separatorBefore === true ? TOOLBAR_SEPARATOR_PX : 0

    const fullPx = rule + (s.widthPx?.full ?? chrome + textPx(s.label))

    const compactBase =
      s.widthPx?.compact ??
      (s.compactLabel !== undefined ? chrome + textPx(s.compactLabel) : undefined)
    const compactPx = compactBase === undefined ? undefined : rule + compactBase

    // A pinned control never becomes an icon and never folds — its whole job
    // is to say which model the section below is showing.
    const pinned = s.priority === 'pinned'
    const iconAllowed = !pinned && s.iconOnly !== false
    const iconPx = iconAllowed
      ? rule + (s.widthPx?.icon ?? chrome - metrics.intraGapPx)
      : undefined

    return {
      id: s.id,
      priority: s.priority,
      fullPx,
      ...(compactPx !== undefined ? { compactPx } : {}),
      ...(iconPx !== undefined ? { iconPx } : {}),
      foldable: !pinned && s.foldable !== false,
    }
  })
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Degradation order — lower rank degrades first.
 *
 * WHY this order. The engineer's hands live on the pipeline verbs (Suggest /
 * Correlate / Packing pipeline / New cross-section): those are pressed dozens
 * of times per section, so they hold their labels longest. Bodies / Display /
 * Export / Suggest tie-sections are pressed a few times per section. Undo has
 * a keyboard binding, so its button is a discoverability aid rather than the
 * primary path. Admixtures and Recompute bodies are escape hatches reached
 * once in a while — they are the first to give ground.
 */
const PRIORITY_RANK: Record<ToolbarPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  pinned: 3,
}

interface Move {
  index: number
  to: ToolbarPresentation
}

/**
 * The ordered list of concessions, cheapest first.
 *
 * The pinned mode control is short-formed first. That costs the user NOTHING
 * — all three modes stay spelled out ("Geo | Litho | Geotech") — so it
 * happens before any action gives up its label (TO3).
 *
 * After that the row is spent one PRIORITY BAND at a time, lowest first, and
 * a band is exhausted before the next one is touched: every ``low`` control
 * goes to an icon, then every ``low`` control folds into the ⋯ menu, and only
 * then does a ``medium`` control lose its label (TO10).
 *
 * WHY band-at-a-time rather than "every icon first, then every fold". The
 * global form reaches a state where "Packing pipeline" — pressed dozens of
 * times per section — is a bare icon while "Recompute bodies", used once a
 * week, still sits in the bar. The band form buries the occasional verb in
 * the menu and keeps the constant one spelled out, which is what the owner
 * asked for. It also amortises the ⋯ trigger's own width across a whole
 * band instead of paying it to hide one small button.
 *
 * Within one band the LAST-declared control degrades first: a toolbar erodes
 * from its far end so the verbs reached by muscle memory do not move
 * (Primer's action-bar behaviour, TO12).
 */
function degradationOrder(items: readonly ToolbarItemMeasure[]): Move[] {
  const indexed = items.map((item, index) => ({ item, index }))
  const trailingFirst = (a: { index: number }, b: { index: number }): number => b.index - a.index

  const compacts = indexed
    .filter(({ item }) => item.compactPx !== undefined)
    .map(({ index }): Move => ({ index, to: 'compact' }))

  const bands = (['low', 'medium', 'high'] as const).flatMap<Move>(priority => {
    const band = indexed.filter(({ item }) => item.priority === priority).sort(trailingFirst)
    return [
      ...band
        .filter(({ item }) => item.iconPx !== undefined)
        .map(({ index }): Move => ({ index, to: 'icon' })),
      ...band
        .filter(({ item }) => item.foldable)
        .map(({ index }): Move => ({ index, to: 'overflow' })),
    ]
  })

  return [...compacts, ...bands]
}

/** Width of one control in the presentation the plan gave it. */
function presentedPx(item: ToolbarItemMeasure, presentation: ToolbarPresentation): number {
  switch (presentation) {
    case 'overflow':
      return 0
    case 'compact':
      return item.compactPx ?? item.fullPx
    case 'icon':
      return item.iconPx ?? item.fullPx
    case 'full':
      return item.fullPx
  }
}

/** Total width of the row under the current presentations. */
function rowPx(
  items: readonly ToolbarItemMeasure[],
  presentations: ToolbarPresentation[],
  metrics: ToolbarMetrics,
): number {
  let width = 0
  let shown = 0
  let folded = 0
  items.forEach((item, i) => {
    if (presentations[i] === 'overflow') {
      folded += 1
      return
    }
    width += presentedPx(item, presentations[i])
    shown += 1
  })
  if (folded > 0) {
    width += metrics.overflowTriggerPx
    shown += 1
  }
  return shown > 0 ? width + metrics.rowGapPx * (shown - 1) : 0
}

/**
 * Decide how a toolbar row renders in the space it has.
 *
 * Parameters
 * ----------
 * items
 *     Sized controls, left to right. Use ``measureToolbarItems`` to build
 *     them, or supply widths measured some other way — the planner does not
 *     care where the numbers came from.
 * availablePx
 *     Width the row may occupy. **Zero or negative means "not measured yet"**
 *     (a jsdom render, or the frame before the first ResizeObserver
 *     callback), and every control is planned at its full label — collapsing
 *     on an unmeasured container would make the first paint of every toolbar
 *     a menu (TO13).
 * metrics
 *     Gap + ⋯-trigger widths. Injected for the same reason as above.
 *
 * Returns
 * -------
 * ToolbarPlan
 *     Presentation per id, the folded ids in declaration order, and the
 *     width the planned row occupies.
 */
export function planToolbarLayout(
  items: readonly ToolbarItemMeasure[],
  availablePx: number,
  metrics: ToolbarMetrics = DEFAULT_TOOLBAR_METRICS,
): ToolbarPlan {
  const presentations: ToolbarPresentation[] = items.map(() => 'full')

  const buildPlan = (): ToolbarPlan => {
    const presentation = new Map<string, ToolbarPresentation>()
    const overflowIds: string[] = []
    items.forEach((item, i) => {
      presentation.set(item.id, presentations[i])
      if (presentations[i] === 'overflow') overflowIds.push(item.id)
    })
    return { presentation, overflowIds, widthPx: rowPx(items, presentations, metrics) }
  }

  if (items.length === 0 || availablePx <= 0) return buildPlan()

  for (const move of degradationOrder(items)) {
    if (rowPx(items, presentations, metrics) <= availablePx) break
    // A control already further down the ladder is not walked back up: the
    // stages are ordered cheapest-concession-first, so a later stage must
    // never undo an earlier one.
    if (presentations[move.index] === 'overflow') continue
    if (move.to === 'compact' && presentations[move.index] !== 'full') continue
    if (move.to === 'icon' && presentations[move.index] === 'icon') continue
    presentations[move.index] = move.to
  }

  return buildPlan()
}
