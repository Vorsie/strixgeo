// Codex 3 — after switching from project A to B, nothing from A (list,
// cached detail/plot, or an in-flight response) is ever shown in B.
//
// The bug: the CPT / borehole list fetch and the detail / plot loaders had no
// generation guard, and the detail / plot caches were keyed by investigation id
// only and retained across projects. So a slow list request for A that resolved
// AFTER a fast one for B overwrote B's rows with A's, and an in-flight A detail
// fetch that resolved after a switch populated B's cache with A's data.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  CptListItem,
  CptPlotResponse,
} from '../api/client'
import type { DovImportState } from './useDovImportStream'

const streamState: DovImportState = { status: 'idle' }
vi.mock('./useDovImportStream', () => ({
  useDovImportStream: () => ({ state: streamState, start: vi.fn(), reset: vi.fn() }),
}))

const cptListMock = vi.fn()
const boreholeListMock = vi.fn()
const cptPlotMock = vi.fn()
const cptGetMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    review: { list: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined) },
    cpt: {
      list: (...a: unknown[]) => cptListMock(...a),
      get: (...a: unknown[]) => cptGetMock(...a),
      plot: (...a: unknown[]) => cptPlotMock(...a),
    },
    borehole: { list: (...a: unknown[]) => boreholeListMock(...a), get: vi.fn() },
  },
  DuplicateCptError: class DuplicateCptError extends Error {
    cptId = ''
  },
  CptRefreshConfirmationRequiredError: class CptRefreshConfirmationRequiredError extends Error {
    diff: unknown
  },
}))

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { useInvestigationData } from './useInvestigationData'

/** Minimal CPT list row. */
function cpt(id: string): CptListItem {
  return {
    id,
    name: id,
    cpt_type: 'CPTU',
    max_depth_m: 10,
    n_rows: 100,
    location_x: 150000,
    location_y: 200000,
    epsg: 31370,
    elevation_m: null,
    z_epsg: null,
    elevation_source: 'dov',
    start_date: null,
  }
}

const STABLE = {
  ready: true,
  toast: vi.fn(),
  pushUndo: vi.fn(),
  addToManifest: vi.fn(),
  setSessionImportCptIds: vi.fn(),
  setSessionImportBoreholeIds: vi.fn(),
  selectedId: null,
  setSelectedId: vi.fn(),
  selectedBoreholeId: null,
  setSelectedBoreholeId: vi.fn(),
  setView: vi.fn(),
}

function renderSwitchHook(project: { id: string; name: string }) {
  return renderHook(
    ({ project }: { project: { id: string; name: string } }) =>
      useInvestigationData({ project, ...STABLE }),
    { initialProps: { project } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  boreholeListMock.mockResolvedValue([] as BoreholeListItem[])
})

describe('Codex 3 — a slow list from A never overwrites B', () => {
  it('discards project A rows that resolve after a switch to B', async () => {
    const aRows = [cpt('A-1'), cpt('A-2')]
    const bRows = [cpt('B-1')]
    let resolveA: (() => void) | null = null
    cptListMock.mockImplementation((projectId: string) => {
      if (projectId === 'A') {
        return new Promise<CptListItem[]>(res => {
          resolveA = () => res(aRows)
        })
      }
      return Promise.resolve(bRows)
    })

    const { result, rerender } = renderSwitchHook({ id: 'A', name: 'A' })
    // Let A's auto-load fire (it is now pending).
    await act(async () => {
      await Promise.resolve()
    })

    // Switch to B — its list resolves immediately.
    await act(async () => {
      rerender({ project: { id: 'B', name: 'B' } })
      await Promise.resolve()
    })
    expect(result.current.cpts).toEqual(bRows)

    // A finally resolves — it must be ignored, not clobber B.
    await act(async () => {
      resolveA?.()
      await Promise.resolve()
    })
    expect(result.current.cpts).toEqual(bRows)
  })
})

describe('Codex 3 — caches do not survive a project switch', () => {
  it('empties the CPT list, detail and plot caches when switching to B', async () => {
    cptListMock.mockResolvedValue([cpt('A-1')])
    cptPlotMock.mockResolvedValue({ cpt_id: 'A-1', depths_m: [] } as unknown as CptPlotResponse)

    const { result, rerender } = renderSwitchHook({ id: 'A', name: 'A' })
    await act(async () => {
      await Promise.resolve()
    })
    // Warm the plot cache for an A investigation.
    await act(async () => {
      await result.current.loadChart('A-1')
    })
    expect(result.current.plotMap.size).toBe(1)
    expect(result.current.cpts.length).toBe(1)

    // Switch to B: nothing from A may linger.
    cptListMock.mockResolvedValue([])
    await act(async () => {
      rerender({ project: { id: 'B', name: 'B' } })
      await Promise.resolve()
    })
    expect(result.current.plotMap.size).toBe(0)
    expect(result.current.cpts.length).toBe(0)
  })

  it('drops an in-flight A plot that resolves after the switch', async () => {
    cptListMock.mockResolvedValue([cpt('A-1')])
    let resolvePlot: (() => void) | null = null
    cptPlotMock.mockImplementation(
      () =>
        new Promise<CptPlotResponse>(res => {
          resolvePlot = () =>
            res({ cpt_id: 'A-1', depths_m: [] } as unknown as CptPlotResponse)
        }),
    )

    const { result, rerender } = renderSwitchHook({ id: 'A', name: 'A' })
    await act(async () => {
      await Promise.resolve()
    })
    // Kick off an A plot fetch that stays pending.
    let plotPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      plotPromise = result.current.loadChart('A-1')
      await Promise.resolve()
    })

    // Switch to B before the plot answers.
    await act(async () => {
      rerender({ project: { id: 'B', name: 'B' } })
      await Promise.resolve()
    })

    // The pending A plot resolves — it must not land in B's cache.
    await act(async () => {
      resolvePlot?.()
      await plotPromise
    })
    expect(result.current.plotMap.has('A-1')).toBe(false)
  })
})
