// The representative-qc statistic selector (owner rulings 7+8, docs/debt.md #227).
//
// Ruling 7: the statistic is selectable PER GEOTECH MODEL — median (the
// spike-robust default), arithmetic, harmonic, geometric. Ruling 8: changing
// it marks the model STALE; it never silently re-derives 500+ bands. The
// staleness is DERIVED (classified_with != representative) and surfaces as a
// "re-run under <statistic>" tag on the pipeline's Subdivide step — the verb
// that actually re-classifies.

import { getLanguage, setLanguage } from '../../../i18n/languageSelect'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeGeotechModel, makeLithoModel } from './__fixtures__/sectionsShellContext'

const setGeotechStatistic = vi.fn().mockResolvedValue({
  representative_statistic: 'harmonic',
  classified_with_statistic: 'median',
  bands_stale: true,
})

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        setGeotechStatistic: (...args: unknown[]) => setGeotechStatistic(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function makeCtx(
  axis: SectionModelAxis,
  geoModel: Partial<ShellContextValue['geoModel']> = {},
): ShellContextValue {
  const base = makeShellCtx(axis)
  return { ...base, geoModel: { ...base.geoModel, ...geoModel } }
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionsToolbar — the qc statistic selector (rulings 7+8)', () => {
  it('ST-UI1 — the geotech axis offers the four statistics, current one marked', () => {
    renderToolbar(
      makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }),
    )
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    for (const token of ['median', 'arithmetic', 'harmonic', 'geometric']) {
      expect(screen.getByTestId(`geotech-statistic-${token}`)).toBeTruthy()
    }
    // The fixture model carries no explicit choice → the default is current.
    expect(screen.getByTestId('geotech-statistic-median').textContent).toMatch(/current/i)
  })

  it('ST-UI2 — choosing another statistic writes the ONE column, nothing else', async () => {
    renderToolbar(
      makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }),
    )
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    await waitFor(() =>
      expect(setGeotechStatistic).toHaveBeenCalledWith('proj-1', 'geotech-model-1', 'harmonic'),
    )
  })

  it('ST-UI3 — a stale answer surfaces as a re-subdivide tag on step 1', async () => {
    renderToolbar(
      makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }),
    )
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    await waitFor(() => expect(setGeotechStatistic).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    expect(screen.getByTestId('geotech-subdivide-cpts').textContent).toMatch(
      /re-run under harmonic/i,
    )
  })

  it('ST-UI4 — a model loaded already-stale shows the tag with no click at all', () => {
    renderToolbar(
      makeCtx('geotechnical', {
        activeGeotechModel: {
          ...makeGeotechModel(),
          representative_statistic: 'harmonic',
          classified_with_statistic: 'median',
        },
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    expect(screen.getByTestId('geotech-subdivide-cpts').textContent).toMatch(
      /re-run under harmonic/i,
    )
  })

})

describe('the re-run tag goes away once the re-run has happened', () => {
  // Ruling 8's staleness is DERIVED so it can self-clear. Caching the
  // pre-change 'classified_with' locally defeats that: after the engineer
  // presses "1 · Subdivide CPTs" the server stamps the new statistic and the
  // model row refreshes, but a local shadow keeps reporting the old value, so
  // the amber tag sits there forever. He presses the button again — and every
  // press wipes and rebuilds every band, shedding ties as it goes.
  it('ST-UI5 — the tag clears once the refreshed model agrees with the choice', async () => {
    setGeotechStatistic.mockResolvedValue({
      representative_statistic: 'harmonic',
      classified_with_statistic: 'median',
      bands_stale: true,
    })
    renderToolbar(
      makeCtx('geotechnical', {
        activeGeotechModel: {
          ...makeGeotechModel(),
          representative_statistic: 'median',
          classified_with_statistic: 'median',
        },
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    await waitFor(() => expect(setGeotechStatistic).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    await waitFor(() =>
      expect(screen.getByTestId('geotech-subdivide-cpts').textContent).toMatch(
        /re-run under harmonic/,
      ),
    )
    cleanup()

    // The engineer presses step 1. The rebuild stamps harmonic and the model
    // row refreshes — the tag now has nothing left to report.
    renderToolbar(
      makeCtx('geotechnical', {
        activeGeotechModel: {
          ...makeGeotechModel(),
          representative_statistic: 'harmonic',
          classified_with_statistic: 'harmonic',
        },
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    expect(screen.getByTestId('geotech-subdivide-cpts').textContent).not.toMatch(/re-run under/)
  })
})

describe('the Subdivide verb says how many columns no longer fit their parent', () => {
  // Dragging a lithostratigraphic contact on the geotech axis leaves that
  // column's packing bands derived against the OLD boundary. Subdivide is the
  // verb that fixes it — and it is model-wide and destructive, so nothing
  // rebuilds automatically (owner ruling). The count is how the engineer
  // learns the debt exists and chooses when to pay it.
  function subdivideItemText(geoModel: Partial<ShellContextValue['geoModel']>): string {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel(), ...geoModel }))
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    return screen.getByTestId('geotech-subdivide-cpts').textContent ?? ''
  }

  it('RD-UI1 — two columns no longer fitting reads as a plural count', () => {
    expect(subdivideItemText({ columnsNeedingRederive: ['cpt-1', 'cpt-2'] })).toContain(
      '2 columns need re-deriving',
    )
  })

  it('RD-UI2 — one column reads singular, not "1 columns"', () => {
    const text = subdivideItemText({ columnsNeedingRederive: ['cpt-1'] })
    expect(text).toContain('1 column needs re-deriving')
    expect(text).not.toContain('1 columns')
  })

  it('RD-UI3 — three columns counts three, not a constant', () => {
    expect(
      subdivideItemText({ columnsNeedingRederive: ['cpt-1', 'cpt-2', 'cpt-3'] }),
    ).toContain('3 columns need re-deriving')
  })

  it('RD-UI4 — every band still fitting its parent shows no tag at all', () => {
    // The owner's live model is in exactly this state today: 523 bands, all
    // inside their parents. A tag that shows here is noise on every session.
    expect(subdivideItemText({ columnsNeedingRederive: [] })).not.toMatch(/re-deriv/i)
  })

  it('RD-UI5 — a statistic change outranks the column count: re-running re-derives everything', () => {
    const text = subdivideItemText({
      activeGeotechModel: {
        ...makeGeotechModel(),
        representative_statistic: 'harmonic',
        classified_with_statistic: 'median',
      },
      columnsNeedingRederive: ['cpt-1', 'cpt-2'],
    })
    expect(text).toMatch(/re-run under harmonic/i)
    expect(text).not.toMatch(/re-deriv/i)
  })

  it('RD-UI6 — with the statistic settled, the column count is what shows', () => {
    const text = subdivideItemText({
      activeGeotechModel: {
        ...makeGeotechModel(),
        representative_statistic: 'harmonic',
        classified_with_statistic: 'harmonic',
      },
      columnsNeedingRederive: ['cpt-1', 'cpt-2'],
    })
    expect(text).toContain('2 columns need re-deriving')
    expect(text).not.toMatch(/re-run under/i)
  })
})

// ---------------------------------------------------------------------------
// Where it sits, and what it promises (owner, 2026-08-09)
// ---------------------------------------------------------------------------
//
// "keep it in the toolbar but add it before subdivide cpt's? So the user chooses
// before subdividing, it should also be clear that it doesn't update dynamically"
//
// Both halves are testable and both were wrong before: the selector sat AFTER the
// pipeline, among the view options, and the only statement that nothing re-runs
// lived in a hover tooltip, which nobody reads before clicking.

describe('the statistic is chosen BEFORE subdividing, and says it changes nothing yet', () => {
  it('ST-ORDER — the selector is drawn ahead of the packing pipeline', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))

    const statistic = screen.getByTestId('geotech-statistic-menu')
    const pipeline = screen.getByTestId('geotech-pipeline')

    // DOCUMENT_POSITION_FOLLOWING: the pipeline comes after the selector in the bar,
    // so reading left to right the choice is made first.
    expect(
      statistic.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the qc statistic must be drawn before the pipeline the choice feeds',
    ).toBeTruthy()
  })

  it('ST-LABEL — the current statistic is visible without opening the menu', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))

    expect(screen.getByTestId('geotech-statistic-menu').textContent).toContain('median')
  })

  it('once is enough: the note is only in the inspector, not the qc dropdown', () => {
    // Owner ruling 4 (2026-09-12): "yes once is enough". The note used to head
    // the dropdown AND read in the inspector; now it is shown once, in the
    // inspector. Opening the dropdown must reveal the picker but no note.
    // (RETARGETS the old ST-NOTE pin, which required the note INSIDE the menu —
    // the behaviour the owner overturned. The inspector side is pinned by
    // SectionsInspector.statisticNote.test.tsx SN1.)
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))

    // The picker rows are still there...
    expect(screen.getByTestId('geotech-statistic-median')).toBeTruthy()
    // ...but the explanatory note is not.
    expect(screen.queryByTestId('geotech-statistic-note')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Choosing the statistic BEFORE the first subdivide (owner, 2026-08-15)
// ---------------------------------------------------------------------------
//
// "i can't choose harmonic qc before first subdivide, that's friction we don't
// need?"
//
// The choice lives on the geotech model, and the geotech model does not exist
// until step 1 creates it — so the selector was inert on exactly the press the
// owner wanted to aim. He had to build everything under the default and re-run
// it. The choice is now held in the renderer until there is a model to put it
// on, and the FIRST subdivide creates the model with it.
//
//   ST-PRE1  with no model, the four statistics are still choosable
//   ST-PRE2  the pending choice shows in the label exactly like a committed one
//   ST-PRE3  the first subdivide carries the choice
//   ST-PRE4  a subdivide with no choice made carries nothing (median default)
//   ST-PRE5  with no model there is nothing to write to — no API call fires
//   ST-PRE6  once the model exists, the label reads the MODEL, not the choice

describe('the qc statistic can be chosen before the first subdivide', () => {
  function makePreModelCtx(
    overrides: Partial<ShellContextValue['geoModel']> = {},
  ): ShellContextValue {
    return makeCtx('geotechnical', {
      activeGeotechModel: null,
      activeLithoModel: makeLithoModel(),
      ...overrides,
    })
  }

  it('ST-PRE1 — with no geotech model the four statistics are still choosable', () => {
    renderToolbar(makePreModelCtx())
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    for (const token of ['median', 'arithmetic', 'harmonic', 'geometric']) {
      expect(screen.getByTestId(`geotech-statistic-${token}`)).not.toBeDisabled()
    }
  })

  it('ST-PRE2 — the pending choice reads in the label exactly like a committed one', () => {
    renderToolbar(makePreModelCtx())
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    expect(screen.getByTestId('geotech-statistic-menu').textContent).toContain('harmonic')
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    expect(screen.getByTestId('geotech-statistic-harmonic').textContent).toMatch(/current/i)
  })

  it('ST-PRE3 — the first subdivide is the press that carries the choice', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(makePreModelCtx({ handleSubdivideAllBodies }))
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      representativeStatistic: 'harmonic',
      // First subdivision wins (owner 2026-08-18): no rebuild tag is
      // active in this scene, so the press imports existing bands as-is.
      rebuildExisting: false,
    })
  })

  it('ST-PRE4 — no choice made carries none, so the model is created under the default', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(makePreModelCtx({ handleSubdivideAllBodies }))
    fireEvent.click(screen.getByTestId('geotech-pipeline'))
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      representativeStatistic: null,
      // First subdivision wins (owner 2026-08-18): no rebuild tag is
      // active in this scene, so the press imports existing bands as-is.
      rebuildExisting: false,
    })
  })

  it('ST-PRE5 — with no model there is nothing to write to, so no request fires', () => {
    renderToolbar(makePreModelCtx())
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    expect(setGeotechStatistic).not.toHaveBeenCalled()
  })

  it('ST-PRE6 — once the model exists the label reads the MODEL, not the pending choice', () => {
    // The pending choice must not be able to disagree with what got built: if
    // the build ignored it, the engineer has to see the statistic his bands
    // actually carry, not the one he asked for. Same mounted toolbar
    // throughout — the model arriving is what has to drop the pending choice.
    const { rerender } = render(
      <ShellContext.Provider value={makePreModelCtx()}>
        <SectionsToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('geotech-statistic-menu'))
    fireEvent.click(screen.getByTestId('geotech-statistic-harmonic'))
    expect(screen.getByTestId('geotech-statistic-menu').textContent).toContain('harmonic')

    // The subdivide landed and refreshModels brought the row back — under
    // geometric, because that is what the model actually carries.
    act(() => {
      rerender(
        <ShellContext.Provider
          value={makeCtx('geotechnical', {
            activeLithoModel: makeLithoModel(),
            activeGeotechModel: {
              ...makeGeotechModel(),
              representative_statistic: 'geometric',
              classified_with_statistic: 'geometric',
            },
          })}
        >
          <SectionsToolbar />
        </ShellContext.Provider>,
      )
    })
    expect(screen.getByTestId('geotech-statistic-menu').textContent).toContain('geometric')
    expect(screen.getByTestId('geotech-statistic-menu').textContent).not.toContain('harmonic')
  })
})

// Owner 2026-09-13: "token of course needs translation in dutch version".
describe('the qc label reads in Dutch in the Dutch version', () => {
  const initialLanguage = getLanguage()
  afterEach(() => {
    setLanguage(initialLanguage)
  })

  it('the toolbar reads qc: mediaan, and the picker rows read Dutch too', () => {
    setLanguage('nl')
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))

    const label = screen.getByTestId('geotech-statistic-menu').textContent ?? ''
    expect(label).toContain('mediaan')
    expect(label).not.toContain('median')
  })
})
