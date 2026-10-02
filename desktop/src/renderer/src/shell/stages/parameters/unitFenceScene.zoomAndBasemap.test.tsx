// Owner ruling C(a), 2026-10-02 — the Parameters fence cutout on
// testproject_dev framed the WHOLE model, so a thin selected unit was a sliver,
// and the orthophoto lid (always on top, alpha 0.6) hid the thin walls.
//
// ZU1 — a "Zoom to unit" button beside "Reset view" flies to the FILTERED
//       cutout's frame (the selected unit's walls, never the whole fence),
//       with a minimum range of about 40 m.
// ZU2 — "Reset view" keeps the WHOLE-model frame (its own callback, untouched).
// ZU3 — the camera never moves on its own: mounting the cutout or changing the
//       scope calls neither the zoom nor the reset (audit F4 stands).
// ZU4 — the bounds fit honours a caller's minimum range; the shared stages
//       keep their 600 m floor.
// BM1 — a basemap on/off toggle in the cutout pane switches the orthophoto
//       lid off (the chromeless pane hides the viewer's own toggle), states
//       its state for AT (aria-pressed) and is remembered per viewer.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FencePanel } from '../../../utils/fencePanels'
import { boundsFitRangeM } from '../geology/geology3DPrimitives'
import type { ParameterUnitScope } from '../../ShellContext'
import UnitFenceScene from './UnitFenceScene'
import { fenceFrameCorners } from './unitFenceFrame'
import {
  UNIT_FENCE_BASEMAP_STORAGE_KEY,
  UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M,
} from './unitFenceSceneConstants'

type ZoomFn = (vertices: readonly [number, number, number][], minRangeM: number) => void

const zoomSpy = vi.fn<ZoomFn>()
const resetSpy = vi.fn()
let viewerProps: Record<string, unknown> = {}

// The viewer is Cesium; under jsdom it is a probe that publishes the two
// camera callbacks the way the real viewport does, and records its props.
vi.mock('../geology/Geology3DViewer', () => ({
  default: (props: Record<string, unknown>) => {
    viewerProps = props
    ;(props.resetCameraRef as { current: unknown }).current = resetSpy
    const zoomRef = props.zoomToVerticesRef as { current: unknown } | undefined
    if (zoomRef !== undefined) zoomRef.current = zoomSpy
    return <div data-testid="viewer-probe" />
  },
}))

// The SELECTED unit's walls sit in a small corner of a much larger fence.
const UNIT_PANEL: FencePanel = {
  formationId: 'unit-sel',
  bodyId: null,
  vertices: [
    [100, 200, 3],
    [110, 200, 3],
    [110, 200, 1],
  ],
  triangles: [[0, 1, 2]],
}
const OTHER_PANEL: FencePanel = {
  formationId: 'unit-other',
  bodyId: null,
  vertices: [
    [0, 0, 10],
    [5000, 4000, 10],
    [5000, 4000, -40],
  ],
  triangles: [[0, 1, 2]],
}

vi.mock('../shared/useBody3DViewState', () => ({
  EMPTY_SURFACES_MAP: new Map(),
  useBody3DViewState: () => ({
    setViewMode: () => {},
    fenceLoading: false,
    fencePanels: [UNIT_PANEL, OTHER_PANEL],
  }),
}))

vi.mock('../../ShellContext', async importOriginal => {
  const orig = await importOriginal<typeof import('../../ShellContext')>()
  return {
    ...orig,
    useShell: () => ({
      geoModel: {
        activeLithoModel: { id: 'litho-1' },
        activeGeotechModel: null,
        lithoLayers: [],
        geotechLayers: [],
        lithoFormations: [],
        geotechFormations: [],
      },
      project: { default_horizontal_epsg: 31370 },
    }),
  }
})

const SCOPE: ParameterUnitScope = { kind: 'litho-unit', unitId: 'unit-sel' }

function clearStore(): void {
  try {
    window.localStorage.removeItem(UNIT_FENCE_BASEMAP_STORAGE_KEY)
  } catch {
    // storage unavailable — nothing to clear
  }
}

beforeEach(clearStore)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  viewerProps = {}
  clearStore()
})

describe('Fence cutout — Zoom to unit (owner ruling C(a), 2026-10-02)', () => {
  it('ZU1 — "Zoom to unit" flies to the FILTERED cutout frame with a ~40 m minimum range', () => {
    render(<UnitFenceScene scope={SCOPE} />)
    fireEvent.click(screen.getByTestId('unit-fence-zoom-to-unit'))
    expect(zoomSpy).toHaveBeenCalledTimes(1)
    const [vertices, minRange] = zoomSpy.mock.calls[0]
    expect(vertices).toEqual(fenceFrameCorners([UNIT_PANEL]))
    // Never the whole fence.
    expect(vertices).not.toEqual(fenceFrameCorners([UNIT_PANEL, OTHER_PANEL]))
    expect(minRange).toBe(UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M)
    expect(UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M).toBeGreaterThanOrEqual(30)
    expect(UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M).toBeLessThanOrEqual(50)
    expect(resetSpy).not.toHaveBeenCalled()
  })

  it('ZU2 — "Reset view" keeps the whole-model frame (the reset callback), not the unit zoom', () => {
    render(<UnitFenceScene scope={SCOPE} />)
    fireEvent.click(screen.getByTestId('unit-fence-reset-camera'))
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(zoomSpy).not.toHaveBeenCalled()
  })

  it('ZU3 — the camera never moves on its own: mount and a scope change call neither verb', () => {
    const { rerender } = render(<UnitFenceScene scope={SCOPE} />)
    rerender(<UnitFenceScene scope={{ kind: 'litho-unit', unitId: 'unit-other' }} />)
    expect(zoomSpy).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
  })

  it('ZU4 — the bounds fit honours the minimum range; the default floor stays 600 m', () => {
    expect(boundsFitRangeM(5)).toBe(600)
    expect(boundsFitRangeM(5, 40)).toBe(40)
    expect(boundsFitRangeM(100, 40)).toBeCloseTo(220)
  })

  it('ZU5 — both camera verbs carry a visible focus ring (WCAG 2.4.7)', () => {
    render(<UnitFenceScene scope={SCOPE} />)
    for (const id of ['unit-fence-zoom-to-unit', 'unit-fence-reset-camera']) {
      expect(screen.getByTestId(id).className).toMatch(/focus-visible:ring/)
    }
  })
})

describe('Fence cutout — basemap toggle (owner ruling C(a), 2026-10-02)', () => {
  it('BM1 — the toggle switches the orthophoto off and on, and states it via aria-pressed', () => {
    render(<UnitFenceScene scope={SCOPE} />)
    const toggle = screen.getByTestId('unit-fence-basemap-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(viewerProps.basemapEnabled).toBe(true)
    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(viewerProps.basemapEnabled).toBe(false)
    expect(toggle.className).toMatch(/focus-visible:ring/)
  })

  it('BM2 — the choice is remembered for the next cutout (per-viewer UI chrome)', () => {
    const first = render(<UnitFenceScene scope={SCOPE} />)
    fireEvent.click(screen.getByTestId('unit-fence-basemap-toggle'))
    first.unmount()
    render(<UnitFenceScene scope={SCOPE} />)
    expect(screen.getByTestId('unit-fence-basemap-toggle').getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(viewerProps.basemapEnabled).toBe(false)
  })
})
