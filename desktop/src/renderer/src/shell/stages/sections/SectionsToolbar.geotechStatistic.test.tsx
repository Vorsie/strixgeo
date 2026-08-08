// The representative-qc statistic selector (owner rulings 7+8, docs/debt.md #227).
//
// Ruling 7: the statistic is selectable PER GEOTECH MODEL — median (the
// spike-robust default), arithmetic, harmonic, geometric. Ruling 8: changing
// it marks the model STALE; it never silently re-derives 500+ bands. The
// staleness is DERIVED (classified_with != representative) and surfaces as a
// "re-run under <statistic>" tag on the pipeline's Subdivide step — the verb
// that actually re-classifies.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeGeotechModel } from './__fixtures__/sectionsShellContext'

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
