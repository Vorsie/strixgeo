// Pins for the priority-based toolbar-overflow planner.
//
// The owner's dogfeed (2026-08-26) was a stage/axis pill reading
// "Geology | Litho | Geote" on a fullscreen laptop — the mode control
// truncated mid-word while every action around it kept its label. These
// pins are written in the owner's terms, not the planner's:
//
//   * the mode pill NEVER truncates mid-word — it has a designed short
//     form and no third state,
//   * every action the toolbar offers stays REACHABLE at every width the
//     product ships on — in the bar or in the ⋯ More menu,
//   * the verbs the engineer presses constantly keep their labels longest.
//
// Measurement is injected: the planner never touches the DOM, so these
// tests drive it with realistic label widths straight from the estimator.

import { describe, expect, it } from 'vitest'

import {
  measureToolbarItems,
  planToolbarLayout,
  type ToolbarItemMeasure,
  type ToolbarItemSizing,
} from './toolbarOverflow'
import { DEFAULT_TOOLBAR_METRICS } from './toolbarOverflow_constants'

// ---------------------------------------------------------------------------
// Fixture — mirrors the SHIPPED sections toolbar, litho axis, worst case
// (a section with pending suggestions, so the transient Accept/Clear pills
// are up too). Labels are copied verbatim from SectionsToolbar.tsx; if a
// label there changes, this fixture should follow so the width pins keep
// describing the real bar.
// ---------------------------------------------------------------------------

const SECTIONS_LITHO_SIZING: ToolbarItemSizing[] = [
  { id: 'sections-undo', priority: 'medium', kind: 'button', label: 'Undo' },
  {
    id: 'sections-axis-pill',
    priority: 'pinned',
    kind: 'custom',
    label: 'Section model axis',
    // Three segments: px-2 (16) + text, plus the group's 1 px border ×2.
    widthPx: { full: 172, compact: 146 },
  },
  { id: 'litho-suggest', priority: 'high', kind: 'split', label: 'Suggest all (24)' },
  { id: 'litho-accept-all', priority: 'high', kind: 'button', label: 'Accept all' },
  { id: 'litho-clear', priority: 'high', kind: 'button', label: 'Clear' },
  { id: 'correlate-mode', priority: 'high', kind: 'split', label: 'Correlate' },
  { id: 'litho-bodies-dropdown', priority: 'medium', kind: 'dropdown', label: 'Bodies' },
  { id: 'litho-admixtures-dropdown', priority: 'low', kind: 'dropdown', label: 'Admixtures' },
  { id: 'sections-new', priority: 'high', kind: 'button', label: 'New cross-section' },
  { id: 'suggest-tie-sections', priority: 'medium', kind: 'split', label: 'Suggest tie-sections' },
  // Destructive: no icon-only form (docs/ux.md — a bare trash icon is not an
  // acceptable presentation for an irreversible verb), but it may fold into
  // the menu where it is a clearly-labelled row.
  {
    id: 'sections-delete',
    priority: 'medium',
    kind: 'button',
    label: 'Delete',
    iconOnly: false,
  },
  { id: 'sections-toolbar-export-dropdown', priority: 'medium', kind: 'dropdown', label: 'Export' },
  { id: 'sections-recompute-bodies', priority: 'low', kind: 'button', label: 'Recompute bodies' },
]

const SECTIONS_GEOTECH_SIZING: ToolbarItemSizing[] = [
  { id: 'sections-undo', priority: 'medium', kind: 'button', label: 'Undo' },
  {
    id: 'sections-axis-pill',
    priority: 'pinned',
    kind: 'custom',
    label: 'Section model axis',
    widthPx: { full: 172, compact: 146 },
  },
  // The qc token is IN the label by owner ruling (2026-08-09) — the engineer
  // must see which statistic the next subdivide reads without opening
  // anything. An icon-only form would destroy exactly that, so iconOnly is
  // false; it folds straight to a labelled menu row instead.
  {
    id: 'geotech-statistic-menu',
    priority: 'high',
    kind: 'dropdown',
    label: 'qc: median',
    iconOnly: false,
  },
  { id: 'geotech-pipeline', priority: 'high', kind: 'dropdown', label: 'Packing pipeline' },
  {
    id: 'geotech-correlate-packing',
    priority: 'high',
    kind: 'button',
    label: 'Correlate packing',
  },
  { id: 'geotech-display-menu', priority: 'medium', kind: 'dropdown', label: 'Display' },
  { id: 'sections-new', priority: 'high', kind: 'button', label: 'New cross-section' },
  { id: 'suggest-tie-sections', priority: 'medium', kind: 'split', label: 'Suggest tie-sections' },
  {
    id: 'sections-delete',
    priority: 'medium',
    kind: 'button',
    label: 'Delete',
    iconOnly: false,
  },
  { id: 'sections-toolbar-export-dropdown', priority: 'medium', kind: 'dropdown', label: 'Export' },
  { id: 'sections-recompute-bodies', priority: 'low', kind: 'button', label: 'Recompute bodies' },
]

const LITHO_ITEMS = measureToolbarItems(SECTIONS_LITHO_SIZING, DEFAULT_TOOLBAR_METRICS)
const GEOTECH_ITEMS = measureToolbarItems(SECTIONS_GEOTECH_SIZING, DEFAULT_TOOLBAR_METRICS)

// The stage toolbar's left zone is the viewport minus the right cluster
// (project name ≤ 220 + save + theme + close + separator + inspector ≈ 340)
// and the row's own px-2. These are the budgets the owner's screens hand
// the planner.
function leftZoneFor(viewportPx: number): number {
  return viewportPx - 340
}

const SHIPPING_WIDTHS = [1280, 1366, 1920, 2560, 5120]

describe('planToolbarLayout — the axis pill never truncates', () => {
  it('TO1 — the pill is never folded away and never reduced to an icon, at any width', () => {
    // The pill is the primary mode control: the whole toolbar below it
    // changes meaning with it. It may take its DESIGNED short form and
    // nothing else. Swept far below anything that ships, to prove the
    // guarantee is structural rather than "wide enough today".
    for (let width = 120; width <= 5120; width += 20) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      const pill = plan.presentation.get('sections-axis-pill')
      expect(
        ['full', 'compact'],
        `pill presentation at ${width}px`,
      ).toContain(pill)
    }
  })

  it('TO2 — the pill keeps its full labels when the row fits, and takes the short form only when it does not', () => {
    const roomy = planToolbarLayout(LITHO_ITEMS, 5000)
    expect(roomy.presentation.get('sections-axis-pill')).toBe('full')
    expect(roomy.overflowIds).toEqual([])

    // A laptop at 1366 cannot hold the full litho bar, so the pill takes
    // the designed short form ("Geo | Litho | Geotech") rather than being
    // cut mid-word.
    const laptop = planToolbarLayout(LITHO_ITEMS, leftZoneFor(1366))
    expect(laptop.presentation.get('sections-axis-pill')).toBe('compact')
  })

  it('TO3 — shortening the pill is the FIRST thing tried: no action loses its label while the pill is still full-length', () => {
    // A designed short form costs the user nothing (all three modes stay
    // spelled out). Turning "Admixtures" into a bare icon costs
    // recognition. So the free move happens first.
    for (const width of [900, 1000, 1100, 1200, 1400, 1600]) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      const anyActionDegraded = LITHO_ITEMS.some(
        i => i.id !== 'sections-axis-pill' && plan.presentation.get(i.id) !== 'full',
      )
      if (anyActionDegraded) {
        expect(plan.presentation.get('sections-axis-pill'), `at ${width}px`).toBe('compact')
      }
    }
  })
})

describe('planToolbarLayout — every action stays reachable', () => {
  for (const viewport of SHIPPING_WIDTHS) {
    it(`TO4 — at ${viewport}px every litho action is visible in the bar or listed in the ⋯ menu`, () => {
      const plan = planToolbarLayout(LITHO_ITEMS, leftZoneFor(viewport))
      for (const item of LITHO_ITEMS) {
        const p = plan.presentation.get(item.id)
        expect(p, `${item.id} has no presentation`).toBeDefined()
        // 'overflow' is reachable — it is a labelled row in the ⋯ menu.
        expect(['full', 'compact', 'icon', 'overflow']).toContain(p)
      }
      const folded = new Set(plan.overflowIds)
      const shown = LITHO_ITEMS.filter(i => plan.presentation.get(i.id) !== 'overflow')
      expect(shown.length + folded.size).toBe(LITHO_ITEMS.length)
    })

    it(`TO5 — at ${viewport}px the geotech bar also keeps every action reachable`, () => {
      const plan = planToolbarLayout(GEOTECH_ITEMS, leftZoneFor(viewport))
      const seen = new Set([...plan.presentation.keys()])
      expect(seen.size).toBe(GEOTECH_ITEMS.length)
      for (const item of GEOTECH_ITEMS) {
        expect(plan.presentation.get(item.id), item.id).toBeDefined()
      }
    })

    it(`TO6 — at ${viewport}px the planned row fits the space it was given`, () => {
      for (const items of [LITHO_ITEMS, GEOTECH_ITEMS]) {
        const budget = leftZoneFor(viewport)
        const plan = planToolbarLayout(items, budget)
        expect(plan.widthPx).toBeLessThanOrEqual(budget)
      }
    })
  }

  it('TO7 — at 1920 and above nothing folds into the ⋯ menu', () => {
    // The overflow menu is a cost (an extra click); it must not appear on
    // a screen that can hold the bar.
    for (const viewport of [1920, 2560, 5120]) {
      for (const items of [LITHO_ITEMS, GEOTECH_ITEMS]) {
        expect(
          planToolbarLayout(items, leftZoneFor(viewport)).overflowIds,
          `viewport ${viewport}`,
        ).toEqual([])
      }
    }
  })

  it('TO8 — on an ultra-wide screen every control keeps its full label', () => {
    const plan = planToolbarLayout(LITHO_ITEMS, leftZoneFor(5120))
    for (const item of LITHO_ITEMS) {
      expect(plan.presentation.get(item.id), item.id).toBe('full')
    }
  })
})

describe('planToolbarLayout — priority order', () => {
  it('TO9 — the pipeline verbs the engineer presses constantly outlive the occasional ones', () => {
    // Squeeze until something folds, then check WHAT folded: the low-value
    // occasional verbs (Recompute bodies, Admixtures) go before the
    // high-value pipeline verbs (Packing pipeline, Correlate packing).
    const plan = planToolbarLayout(GEOTECH_ITEMS, 520)
    const folded = new Set(plan.overflowIds)
    expect(folded.has('sections-recompute-bodies')).toBe(true)
    expect(folded.has('geotech-pipeline')).toBe(false)
    expect(folded.has('geotech-statistic-menu')).toBe(false)
  })

  it('TO10 — a band is spent before the next one is touched: no medium verb gives ground while a low verb still shows its label', () => {
    // The whole point of the priority order. If "Recompute bodies" (low) is
    // still fully labelled, nothing more important has been sacrificed for
    // it. Swept across every width the bar can be squeezed to.
    const rank: Record<string, number> = { overflow: 0, icon: 1, compact: 2, full: 3 }
    for (let width = 200; width <= 1600; width += 10) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      const worstIn = (priority: string): number =>
        Math.min(
          ...LITHO_ITEMS.filter(i => i.priority === priority).map(
            i => rank[plan.presentation.get(i.id) as string],
          ),
        )
      const low = worstIn('low')
      const medium = worstIn('medium')
      const high = worstIn('high')
      // A more important band is never degraded further than a less
      // important one. (Equal is fine — a band can be mid-way through.)
      expect(medium, `medium outran low at ${width}px`).toBeGreaterThanOrEqual(low)
      expect(high, `high outran medium at ${width}px`).toBeGreaterThanOrEqual(medium)
    }
  })

  it('TO10b — inside one band, labels are traded for icons before anything folds', () => {
    // Primer's ladder at band scope: an icon with a tooltip is one click
    // away, a menu row is two. Nothing in a band folds while a sibling in
    // the SAME band still shows its label.
    for (let width = 200; width <= 1600; width += 10) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      for (const priority of ['low', 'medium', 'high']) {
        const band = LITHO_ITEMS.filter(i => i.priority === priority)
        const anyFolded = band.some(i => plan.presentation.get(i.id) === 'overflow')
        if (!anyFolded) continue
        const stillLabelled = band.filter(
          i => i.iconPx !== undefined && plan.presentation.get(i.id) === 'full',
        )
        expect(stillLabelled.map(i => i.id), `${priority} band at ${width}px`).toEqual([])
      }
    }
  })

  it('TO11 — the destructive Delete never becomes a bare icon; it keeps its label or becomes a labelled menu row', () => {
    for (let width = 200; width <= 2000; width += 10) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      expect(plan.presentation.get('sections-delete'), `at ${width}px`).not.toBe('icon')
    }
  })

  it('TO12 — the bar degrades from its far end: the rightmost verb of a priority band goes first', () => {
    // Two 'low' items exist in the litho bar: Admixtures (index 7) and
    // Recompute bodies (last). The trailing one is the first to lose its
    // label, so the leading verbs the user reaches for stay stable.
    let sawSplit = false
    for (let width = 400; width <= 1500; width += 5) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      const recompute = plan.presentation.get('sections-recompute-bodies')
      const admixtures = plan.presentation.get('litho-admixtures-dropdown')
      if (recompute !== 'full' && admixtures === 'full') sawSplit = true
      // The reverse must never happen.
      expect(
        admixtures !== 'full' && recompute === 'full',
        `Admixtures degraded before Recompute bodies at ${width}px`,
      ).toBe(false)
    }
    expect(sawSplit).toBe(true)
  })
})

describe('planToolbarLayout — degenerate inputs', () => {
  it('TO13 — an unmeasured container (0 px, e.g. jsdom before layout) renders everything at full label', () => {
    // A zero width means "not measured yet", NOT "no room". Collapsing on
    // it would make the first paint of every toolbar a menu.
    const plan = planToolbarLayout(LITHO_ITEMS, 0)
    expect(plan.overflowIds).toEqual([])
    for (const item of LITHO_ITEMS) {
      expect(plan.presentation.get(item.id)).toBe('full')
    }
  })

  it('TO14 — an impossibly narrow bar still keeps the pill and still lists everything else', () => {
    const plan = planToolbarLayout(LITHO_ITEMS, 60)
    expect(plan.presentation.get('sections-axis-pill')).toBe('compact')
    const reachable = new Set([
      ...plan.overflowIds,
      ...LITHO_ITEMS.filter(i => plan.presentation.get(i.id) !== 'overflow').map(i => i.id),
    ])
    expect(reachable.size).toBe(LITHO_ITEMS.length)
  })

  it('TO15 — an empty toolbar plans to an empty row', () => {
    const plan = planToolbarLayout([], 1000)
    expect(plan.overflowIds).toEqual([])
    expect(plan.widthPx).toBe(0)
  })

  it('TO16 — overflow ids come back in the declaration order the menu renders them in', () => {
    const plan = planToolbarLayout(LITHO_ITEMS, 300)
    const order = LITHO_ITEMS.map(i => i.id)
    const expected = order.filter(id => plan.overflowIds.includes(id))
    expect(plan.overflowIds).toEqual(expected)
  })
})

describe('measureToolbarItems', () => {
  it('TO17 — a longer label measures wider, and a dropdown measures wider than the same-label button', () => {
    const [short, long] = measureToolbarItems(
      [
        { id: 'a', priority: 'low', kind: 'button', label: 'Clear' },
        { id: 'b', priority: 'low', kind: 'button', label: 'Recompute bodies' },
      ],
      DEFAULT_TOOLBAR_METRICS,
    )
    expect(long.fullPx).toBeGreaterThan(short.fullPx)

    const [button, dropdown, split] = measureToolbarItems(
      [
        { id: 'a', priority: 'low', kind: 'button', label: 'Export' },
        { id: 'b', priority: 'low', kind: 'dropdown', label: 'Export' },
        { id: 'c', priority: 'low', kind: 'split', label: 'Export' },
      ],
      DEFAULT_TOOLBAR_METRICS,
    )
    expect(dropdown.fullPx).toBeGreaterThan(button.fullPx)
    expect(split.fullPx).toBeGreaterThan(dropdown.fullPx)
  })

  it('TO18 — the estimate is an upper bound on the real control: 8 chars of "Geotech" fit inside the pill width it reports', () => {
    // Guard against the estimator drifting UNDER the real rendering, which
    // is the direction that clips.
    const [item] = measureToolbarItems(
      [{ id: 'p', priority: 'low', kind: 'button', label: 'Geotech' }],
      DEFAULT_TOOLBAR_METRICS,
    )
    // 7 chars at the real ~6.1 px mean + 13 px icon + 20 px padding + 6 px gap.
    const realistic = 7 * 6.1 + 13 + 20 + 6
    expect(item.fullPx).toBeGreaterThanOrEqual(realistic)
  })

  it('TO19 — iconOnly:false items carry no icon width, so the planner cannot pick an icon form for them', () => {
    const [del] = measureToolbarItems(
      [{ id: 'd', priority: 'medium', kind: 'button', label: 'Delete', iconOnly: false }],
      DEFAULT_TOOLBAR_METRICS,
    )
    expect(del.iconPx).toBeUndefined()
  })

  it('TO20 — a pinned item is never foldable, whatever the caller passes', () => {
    const [pill] = measureToolbarItems(
      [
        {
          id: 'p',
          priority: 'pinned',
          kind: 'custom',
          label: 'axis',
          widthPx: { full: 100, compact: 80 },
        },
      ],
      DEFAULT_TOOLBAR_METRICS,
    )
    expect(pill.foldable).toBe(false)
    expect(pill.iconPx).toBeUndefined()
  })
})

describe('planToolbarLayout — stability', () => {
  it('TO21 — the plan is a pure function of the width: the same width always plans the same row', () => {
    // No feedback loop between what was rendered and what gets planned —
    // the property that stops the bar flapping at a boundary.
    const a = planToolbarLayout(LITHO_ITEMS, 1024)
    const b = planToolbarLayout(LITHO_ITEMS, 1024)
    expect([...a.presentation.entries()]).toEqual([...b.presentation.entries()])
    expect(a.widthPx).toBe(b.widthPx)
  })

  it('TO22 — widening never takes anything away: the row only improves as the window grows', () => {
    const rank: Record<string, number> = { overflow: 0, icon: 1, compact: 2, full: 3 }
    let previous: ToolbarItemMeasure[] | null = null
    let previousPlan = planToolbarLayout(LITHO_ITEMS, 200)
    for (let width = 210; width <= 2400; width += 10) {
      const plan = planToolbarLayout(LITHO_ITEMS, width)
      for (const item of LITHO_ITEMS) {
        const now = rank[plan.presentation.get(item.id) as string]
        const before = rank[previousPlan.presentation.get(item.id) as string]
        expect(now, `${item.id} regressed at ${width}px`).toBeGreaterThanOrEqual(before)
      }
      previousPlan = plan
      previous = LITHO_ITEMS
    }
    expect(previous).not.toBeNull()
  })
})
