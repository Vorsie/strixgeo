/**
 * The Build press, end to end, in the owner's terms (ruling 2026-08-26).
 *
 * UP1  a complete model builds straight through — nothing changes for him today
 * UP2  a test with no packing bands stops the press and asks
 * UP3  "Build without them" builds while ignoring exactly those tests
 * UP4  ...and the chip then says which ones were left out
 * UP5  "Cancel" builds nothing
 * UP6  "Subdivide them & build" runs the machine-safe presses — subdivideCpts
 *      with skip-existing for CPT columns, divideBoreholes scoped to the
 *      boreholes — and does NOT build on the spot, because the bands it just
 *      asked for have not reached the renderer yet
 * UP7  ...and builds once they have, with nothing excluded
 * UP8  clicking a name deep-links to a section that carries it
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const { voxelBuilder } = vi.hoisted(() => ({ voxelBuilder: vi.fn() }))
vi.mock('./GeotechnicalCanvas', () => ({
  resetGeotechCameraCallback: { current: null },
  resetGeotechSplitViewportCallback: { current: null },
  geotechVoxelRequestCallback: { current: voxelBuilder },
}))

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import { useGeotechBuildPreflight } from './useGeotechBuildPreflight'
import type { PreflightLayer } from '../../../utils/geotechBuildPreflight'

const SECTION = {
  id: 'cs1',
  name: 'Cross-section 1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: [],
  excluded_borehole_ids: [],
}

function investigation(id: string, x: number) {
  return { id, name: id, location_x: x, location_y: 0, elevation_m: 5 }
}

function layer(investigationId: string, suffix: string, isBorehole = false): PreflightLayer {
  return {
    id: `${investigationId}-${suffix}`,
    cpt_id: isBorehole ? null : investigationId,
    borehole_id: isBorehole ? investigationId : null,
    formation_id: `f-${suffix}`,
    body_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  }
}

interface Stubs {
  geotechLayers: PreflightLayer[]
  buildGeotechSolids: ReturnType<typeof vi.fn>
  handleSubdivideAllBodies: ReturnType<typeof vi.fn>
  handleDivideBoreholes: ReturnType<typeof vi.fn>
  setSectionsDeepLinkTarget: ReturnType<typeof vi.fn>
  toast: ReturnType<typeof vi.fn>
}

function makeStubs(geotechLayers: PreflightLayer[]): Stubs {
  return {
    geotechLayers,
    buildGeotechSolids: vi.fn().mockResolvedValue(undefined),
    handleSubdivideAllBodies: vi.fn().mockResolvedValue(undefined),
    handleDivideBoreholes: vi.fn().mockResolvedValue(undefined),
    setSectionsDeepLinkTarget: vi.fn(),
    toast: vi.fn(),
  }
}

/** S1 + S2 are CPTs, B12 is a borehole; all three carry accepted litho. */
function makeCtx(stubs: Stubs): ShellContextValue {
  return {
    visibleCpts: [investigation('S1', 0), investigation('S2', 50)],
    visibleBoreholes: [investigation('B12', 100)],
    sections: { visibleSections: [SECTION] },
    geoModel: {
      lithoLayers: [layer('S1', 'litho'), layer('S2', 'litho'), layer('B12', 'litho', true)],
      geotechLayers: stubs.geotechLayers,
      buildGeotechSolids: stubs.buildGeotechSolids,
      handleSubdivideAllBodies: stubs.handleSubdivideAllBodies,
      handleDivideBoreholes: stubs.handleDivideBoreholes,
    },
    coordinator: { setSectionsDeepLinkTarget: stubs.setSectionsDeepLinkTarget },
    toasts: { toast: stubs.toast },
  } as unknown as ShellContextValue
}

function renderPreflight(stubs: Stubs) {
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <ShellContext.Provider value={makeCtx(stubs)}>{children}</ShellContext.Provider>
  )
  return renderHook(() => useGeotechBuildPreflight(), { wrapper })
}

/** Every column banded — the state the owner's model is in today. */
const COMPLETE = [layer('S1', 'nad'), layer('S2', 'nad'), layer('B12', 'nad', true)]
/** B12 imported after the subdivision: litho accepted, no packing bands. */
const B12_UNBANDED = [layer('S1', 'nad'), layer('S2', 'nad')]

afterEach(() => {
  vi.clearAllMocks()
})

describe('useGeotechBuildPreflight', () => {
  it('UP1 — a complete model builds straight through, with nothing excluded', () => {
    const stubs = makeStubs(COMPLETE)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())

    expect(result.current.askingAbout).toBeNull()
    // The canvas builder is handed over UNWRAPPED — the same call today's Build
    // makes, so the payload cannot differ by construction.
    expect(stubs.buildGeotechSolids).toHaveBeenCalledTimes(1)
    expect(stubs.buildGeotechSolids).toHaveBeenCalledWith(voxelBuilder)
  })

  it('UP2 — a test with no packing bands stops the press and asks about it', () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())

    expect(result.current.askingAbout?.map(t => t.name)).toEqual(['B12'])
    expect(stubs.buildGeotechSolids).not.toHaveBeenCalled()
  })

  it('UP3 — "Build without them" builds while ignoring exactly those tests', () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    act(() => result.current.buildWithout())

    expect(result.current.askingAbout).toBeNull()
    const builder = stubs.buildGeotechSolids.mock.calls[0][0] as () => unknown
    builder()
    expect(voxelBuilder).toHaveBeenCalledWith(new Set(['B12']))
  })

  it('UP4 — after building without them, the chip says which ones were left out', () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    expect(result.current.excludedFromLastBuild).toEqual([])

    act(() => result.current.buildWithout())
    expect(result.current.excludedFromLastBuild.map(t => t.name)).toEqual(['B12'])
  })

  it('UP5 — Cancel builds nothing and asks nothing further', () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    act(() => result.current.cancel())

    expect(result.current.askingAbout).toBeNull()
    expect(stubs.buildGeotechSolids).not.toHaveBeenCalled()
    expect(result.current.excludedFromLastBuild).toEqual([])
  })

  it('UP6 — "Subdivide them & build" runs the machine-safe presses and waits for the bands', async () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    await act(async () => {
      await result.current.subdivideAndBuild()
    })

    // B12 is a borehole, so the borehole verb is the one that must run, scoped
    // to it and skipping anything already banded by hand.
    expect(stubs.handleDivideBoreholes).toHaveBeenCalledWith({
      boreholeIds: ['B12'],
      skipExisting: true,
    })
    // Nothing is built yet: the bands the press just wrote have not reached the
    // renderer, and building now would post the payload from before the press.
    expect(stubs.buildGeotechSolids).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(true)
  })

  it('UP6b — a flagged CPT column goes through subdivideCpts with skip-existing', async () => {
    // S2 is the unbanded one this time, and it is a CPT.
    const stubs = makeStubs([layer('S1', 'nad'), layer('B12', 'nad', true)])
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    await act(async () => {
      await result.current.subdivideAndBuild()
    })

    expect(stubs.handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      rebuildExisting: false,
    })
    expect(stubs.handleDivideBoreholes).not.toHaveBeenCalled()
  })

  it('UP7 — once the bands land, it builds, with nothing excluded', async () => {
    const stubs = makeStubs(B12_UNBANDED)
    const wrapperCtx = { value: makeCtx(stubs) }
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <ShellContext.Provider value={wrapperCtx.value}>{children}</ShellContext.Provider>
    )
    const { result, rerender } = renderHook(() => useGeotechBuildPreflight(), { wrapper })

    act(() => result.current.pressBuild())
    await act(async () => {
      await result.current.subdivideAndBuild()
    })
    expect(stubs.buildGeotechSolids).not.toHaveBeenCalled()

    // The refetch lands: B12 now carries a band.
    stubs.geotechLayers = COMPLETE
    wrapperCtx.value = makeCtx(stubs)
    await act(async () => {
      rerender()
    })

    expect(stubs.buildGeotechSolids).toHaveBeenCalledTimes(1)
    expect(stubs.buildGeotechSolids).toHaveBeenCalledWith(voxelBuilder)
    expect(result.current.busy).toBe(false)
  })

  it('UP8 — clicking a name deep-links to a section that carries the test', () => {
    const stubs = makeStubs(B12_UNBANDED)
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    const test = result.current.askingAbout![0]
    act(() => result.current.visitTest(test))

    expect(stubs.setSectionsDeepLinkTarget).toHaveBeenCalledWith({
      sectionId: 'cs1',
      contactIds: [],
      // ONE id: the pre-flight visit is about one test, so the panel centres
      // AND pulses that column. (A two-id payload names a gap instead — the
      // gapless report's "Show me" — and marks neither end.)
      revealInvestigationIds: ['B12'],
    })
    // The visit replaces the question: he is being sent somewhere else.
    expect(result.current.askingAbout).toBeNull()
    expect(stubs.buildGeotechSolids).not.toHaveBeenCalled()
  })

  it('UP9 — the chip cycles through the excluded tests, wrapping at the end', () => {
    const stubs = makeStubs([layer('S1', 'nad')])
    const { result } = renderPreflight(stubs)

    act(() => result.current.pressBuild())
    act(() => result.current.buildWithout())
    expect(result.current.excludedFromLastBuild.map(t => t.name)).toEqual(['S2', 'B12'])

    act(() => result.current.visitNextExcluded())
    act(() => result.current.visitNextExcluded())
    act(() => result.current.visitNextExcluded())

    const visited = stubs.setSectionsDeepLinkTarget.mock.calls.map(
      c => (c[0] as { revealInvestigationIds: readonly string[] }).revealInvestigationIds,
    )
    expect(visited).toEqual([['S2'], ['B12'], ['S2']])
  })
})
