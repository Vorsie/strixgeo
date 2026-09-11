// The Sections stage's "⋯ More" menu, after the 2026-09-11 depopulation.
//
// Owner: *"the more menu is too populated, any suggestions?"* — he approved
// three changes, and this file is their behavioural net:
//
//   1. the display toggles leave the ⋯ menu entirely and live only in the
//      axis's own display dropdown in the bar ("Display" on geotech, "Bodies"
//      on litho), which therefore never folds — so no toggle can disappear at
//      any width,
//   2. what is left in ⋯ sits under three small headers: Model, Section,
//      Export,
//   3. the representative-qc NOTE is information, not a verb: it is off the ⋯
//      rows and shown in the Sections inspector instead (the PICKER stays).
//
// Claims pinned, in the owner's words where he gave them:
//   MM1  the display toggles are not in the More menu (geotech axis)
//   MM2  every display toggle is still reachable at a narrow width
//   MM3  the More menu rows sit under Model / Section / Export headers
//   MM4  the statistic note is not in the More menu, but the picker is
//   MM5  the litho axis's own display set is not in the More menu either
//   MM6  its Bodies menu is still reachable at a narrow width
//
// jsdom cannot lay out text, so the row's width is injected by stubbing
// ``clientWidth`` — the ONLY source ``ResponsiveToolbarRow`` measures. At 0
// (the jsdom default every other toolbar suite relies on) the planner folds
// nothing, which is why these cases set a narrow width explicitly.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeGeotechModel, makeLithoModel } from './__fixtures__/sectionsShellContext'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// Narrow enough that every foldable verb folds — the width the owner's
// complaint is about.
const NARROW_PX = 200
let rowWidthPx = 0

beforeAll(() => {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true,
    get(): number {
      return rowWidthPx
    },
  })
})

afterAll(() => {
  // Hand the inherited Element getter back to every other suite.
  delete (HTMLDivElement.prototype as unknown as Record<string, unknown>).clientWidth
})

afterEach(() => {
  cleanup()
  rowWidthPx = 0
  vi.clearAllMocks()
})

function makeCtx(
  axis: SectionModelAxis,
  geoModel: Partial<ShellContextValue['geoModel']> = {},
): ShellContextValue {
  const base = makeShellCtx(axis)
  return { ...base, geoModel: { ...base.geoModel, ...geoModel } }
}

/** Render the toolbar in a bar too narrow for its verbs. */
function renderNarrow(ctx: ShellContextValue): void {
  rowWidthPx = NARROW_PX
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** Open "⋯ More" and read it top to bottom, tagging headers and rows. */
function openMoreMenu(): { kind: 'header' | 'row'; text: string }[] {
  fireEvent.click(screen.getByTestId('toolbar-overflow-more'))
  const menu = screen.getByRole('menu')
  return [...menu.children].map(node => ({
    kind: node.getAttribute('role') === 'menuitem' ? ('row' as const) : ('header' as const),
    text: node.textContent?.trim() ?? '',
  }))
}

/** The geotech axis's view switches, by testid. */
const GEOTECH_DISPLAY_TOGGLES = [
  'geotech-toggle-fill',
  'geotech-toggle-model-fill',
  'geotech-toggle-litho-fill',
  'geotech-toggle-borehole-preview',
  'geotech-toggle-correlations',
  'geotech-toggle-samples',
  'geotech-toggle-psd-preview',
]

/** The litho axis's own set, under "Bodies". */
const LITHO_DISPLAY_TOGGLES = [
  'litho-fill-bands',
  'litho-toggle-correlations',
  'litho-toggle-model-fill',
  'litho-toggle-samples',
  'litho-toggle-psd-preview',
]

describe('the ⋯ More menu of the Sections stage', () => {
  it('MM1 — the display toggles are not in the More menu', () => {
    renderNarrow(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openMoreMenu()

    for (const testid of GEOTECH_DISPLAY_TOGGLES) {
      expect(screen.queryByTestId(testid), `${testid} is still a ⋯ row`).toBeNull()
    }
  })

  it('MM2 — every display toggle is still reachable at a narrow width', () => {
    renderNarrow(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))

    // The dropdown itself never folds, so the toggles are always two clicks
    // away: the trigger, then the item.
    const trigger = screen.getByTestId('geotech-display-menu')
    fireEvent.click(trigger)

    for (const testid of GEOTECH_DISPLAY_TOGGLES) {
      expect(screen.queryByTestId(testid), `${testid} is unreachable at ${NARROW_PX}px`).not.toBeNull()
    }
  })

  it('MM3 — the More menu rows sit under Model / Section / Export headers', () => {
    renderNarrow(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    const nodes = openMoreMenu()

    const headers = nodes.filter(n => n.kind === 'header').map(n => n.text)
    expect(headers).toEqual(['Model', 'Section', 'Export'])

    const at = (text: string): number => nodes.findIndex(n => n.text.startsWith(text))
    // A model verb, a section verb and an export verb, each under its own head.
    expect(at('1 · Subdivide CPTs')).toBeGreaterThan(at('Model'))
    expect(at('1 · Subdivide CPTs')).toBeLessThan(at('Section'))
    expect(at('New cross-section')).toBeGreaterThan(at('Section'))
    expect(at('New cross-section')).toBeLessThan(at('Export'))
    expect(at('Section DXF')).toBeGreaterThan(at('Export'))
  })

  it('MM4 — the statistic note is not in the More menu, but the picker is', () => {
    renderNarrow(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    const nodes = openMoreMenu()

    expect(screen.queryByTestId('geotech-statistic-note')).toBeNull()
    expect(nodes.some(n => /nothing re-runs/i.test(n.text))).toBe(false)
    // The choice itself still folds into the menu with everything else.
    expect(screen.queryByTestId('geotech-statistic-median')).not.toBeNull()
    expect(screen.queryByTestId('geotech-statistic-harmonic')).not.toBeNull()
  })

  it('MM5 — the litho axis’s own display set is not in the More menu either', () => {
    renderNarrow(makeCtx('lithostratigraphic', { activeLithoModel: makeLithoModel() }))
    openMoreMenu()

    for (const testid of LITHO_DISPLAY_TOGGLES) {
      expect(screen.queryByTestId(testid), `${testid} is still a ⋯ row`).toBeNull()
    }
  })

  it('MM6 — the litho Bodies menu is still reachable at a narrow width', () => {
    renderNarrow(makeCtx('lithostratigraphic', { activeLithoModel: makeLithoModel() }))

    fireEvent.click(screen.getByTestId('litho-bodies-dropdown'))

    for (const testid of LITHO_DISPLAY_TOGGLES) {
      expect(screen.queryByTestId(testid), `${testid} is unreachable at ${NARROW_PX}px`).not.toBeNull()
    }
  })
})
