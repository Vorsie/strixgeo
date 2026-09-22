// Component-shell pins for the two features added to the 3-D viewer on the
// 2026-08-26 owner ballot: the model-footprint ring and the COMPARE split.
//
// Cesium is replaced with the inert stub (same rationale as
// Geology3DViewer.test.tsx) and ``rebuildSurfacePrimitives`` is spied, because
// that call is the ONLY place a prop reaches the scene — so its arguments are
// how a jsdom test can prove the wiring runs the whole way down.
//
// What is deliberately NOT covered here: the camera mirroring itself. It lives
// in a Cesium ``postRender`` listener, and an inert stub whose event objects
// are auto-vivified no-ops cannot drive it. The wiring is asserted (the follow
// ref is handed to the compare pane and withheld from the cut pane); the pixel
// behaviour is a manual-render check.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('cesium', async () => {
  const mod = await import('@/test/cesiumMock')
  return mod.cesiumNamespaceMock
})

const rebuildSpy = vi.fn()
vi.mock('./geology3DPrimitives', async () => {
  const actual =
    await vi.importActual<typeof import('./geology3DPrimitives')>('./geology3DPrimitives')
  return { ...actual, rebuildSurfacePrimitives: (...args: unknown[]) => rebuildSpy(...args) }
})

import type { GeologicalFormationResponse } from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import type { CompareScene, SplitMode } from '../shared/splitViewport'
import Geology3DViewer from './Geology3DViewer'

afterEach(() => {
  cleanup()
  rebuildSpy.mockClear()
})

// Positional argument indices into rebuildSurfacePrimitives (18 positionals —
// debt #201). Named so a future append cannot silently shift an assertion.
const ARG_FORMATIONS = 1
const ARG_CLIPPING_PLANE = 7
const ARG_BODY_SOLIDS = 14
const ARG_FOOTPRINT_RING = 18

function formation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    name,
    color: '#aabbcc',
    litho_main_soil_code: null,
    litho_admixtures: [],
    display_order: 0,
  } as unknown as GeologicalFormationResponse
}

function solid(bodyId: string): LithoBodySolidResponse {
  return {
    body_id: bodyId,
    formation_id: 'cf1',
    body_ordinal: 0,
    vertices: [[0, 0, 0]],
    triangles: [[0, 0, 0]],
  } as unknown as LithoBodySolidResponse
}

const COMPARE_SCENE: CompareScene = {
  label: 'Lithology',
  formations: [formation('cf1', 'Compare unit')],
  bodySolids: [solid('cb1')],
}

function baseProps(splitMode: SplitMode = 'single') {
  return {
    splitMode,
    splitPlane: null,
    formations: [formation('pf1', 'Primary unit')],
    surfacesByFormationId: new Map(),
    projectEpsg: 31370,
    onSplitPlaneDrawn: vi.fn(),
    resetCameraRef: { current: null } as React.MutableRefObject<(() => void) | null>,
  }
}

/** Arguments of the rebuild call for the pane whose formations match. */
function rebuildCallWithFormationId(formationId: string): unknown[] | undefined {
  return rebuildSpy.mock.calls.find(call => {
    const formations = call[ARG_FORMATIONS] as GeologicalFormationResponse[]
    return formations?.some(f => f.id === formationId)
  })
}

describe('footprint ring', () => {
  it('FR1 — the ring reaches the scene', () => {
    const ring = [
      [0, 0, 5],
      [10, 0, 5],
      [10, 10, 5],
      [0, 0, 5],
    ]

    render(<Geology3DViewer {...baseProps('single')} footprintRing={ring} />)

    expect(rebuildSpy.mock.calls.at(-1)?.[ARG_FOOTPRINT_RING]).toEqual(ring)
  })

  it('FR2 — no ring prop means no ring drawn, not an empty one', () => {
    render(<Geology3DViewer {...baseProps('single')} />)

    expect(rebuildSpy.mock.calls.at(-1)?.[ARG_FOOTPRINT_RING]).toBeUndefined()
  })

  it('FR3 — both panes of a comparison show the same footprint', () => {
    // The footprint is the PROJECT's data extent; both models were built from
    // the same investigations, so a ring in one pane and not the other would
    // read as one model covering more ground than it does.
    const ring = [
      [0, 0, 5],
      [10, 0, 5],
      [10, 10, 5],
    ]

    render(
      <Geology3DViewer
        {...baseProps('compare')}
        compareScene={COMPARE_SCENE}
        footprintRing={ring}
      />,
    )

    expect(rebuildCallWithFormationId('pf1')?.[ARG_FOOTPRINT_RING]).toEqual(ring)
    expect(rebuildCallWithFormationId('cf1')?.[ARG_FOOTPRINT_RING]).toEqual(ring)
  })
})

describe('compare split', () => {
  it('CMP1 — offers the comparison when the other model has geometry', () => {
    render(
      <Geology3DViewer
        {...baseProps('single')}
        compareScene={COMPARE_SCENE}
        onEnterCompare={vi.fn()}
      />,
    )

    const button = screen.getByTestId('geology3d-compare-button')
    expect(button.textContent).toContain('Lithology')
  })

  it('CMP2 — does not offer a comparison against an empty model', () => {
    // Nothing built on the other side yet. A button that opens a blank pane
    // reads as a broken viewer; a missing button reads as "not yet".
    render(
      <Geology3DViewer
        {...baseProps('single')}
        compareScene={{ label: 'Lithology', formations: [], bodySolids: [] }}
        onEnterCompare={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('geology3d-compare-button')).toBeNull()
  })

  it('CMP3 — pressing it asks the stage to enter the comparison', () => {
    const onEnterCompare = vi.fn()
    render(
      <Geology3DViewer
        {...baseProps('single')}
        compareScene={COMPARE_SCENE}
        onEnterCompare={onEnterCompare}
      />,
    )

    fireEvent.click(screen.getByTestId('geology3d-compare-button'))

    expect(onEnterCompare).toHaveBeenCalledTimes(1)
  })

  it('CMP4 — the second pane shows the OTHER model, not a second copy of this one', () => {
    render(
      <Geology3DViewer {...baseProps('compare')} compareScene={COMPARE_SCENE} />,
    )

    const comparePane = rebuildCallWithFormationId('cf1')
    expect(comparePane).toBeDefined()
    expect(comparePane?.[ARG_BODY_SOLIDS]).toEqual(COMPARE_SCENE.bodySolids)
  })

  it('CMP5 — both compared models are shown WHOLE', () => {
    // A clip would hide half of each model, and a half model reads as a
    // modelling gap rather than as a cut.
    render(
      <Geology3DViewer
        {...baseProps('compare')}
        splitPlane={{ normal: 'n', distance: 1 } as never}
        compareScene={COMPARE_SCENE}
      />,
    )

    expect(rebuildCallWithFormationId('pf1')?.[ARG_CLIPPING_PLANE]).toBeNull()
    expect(rebuildCallWithFormationId('cf1')?.[ARG_CLIPPING_PLANE]).toBeNull()
  })

  it('CMP6 — the cut split still clips, and still shows one model twice', () => {
    // The regression guard for CMP4/CMP5: the pre-existing cut split must be
    // untouched by the compare feature.
    const plane = { normal: 'n', distance: 1 } as never
    render(
      <Geology3DViewer
        {...baseProps('split')}
        splitPlane={plane}
        compareScene={COMPARE_SCENE}
      />,
    )

    // No pane renders the compare scene…
    expect(rebuildCallWithFormationId('cf1')).toBeUndefined()
    // …and the panes that do render are clipped.
    const clipped = rebuildSpy.mock.calls.filter(c => c[ARG_CLIPPING_PLANE] === plane)
    expect(clipped.length).toBeGreaterThan(0)
  })

  it('CMP7 — both panes are captioned so neither half is guessed at', () => {
    render(
      <Geology3DViewer {...baseProps('compare')} compareScene={COMPARE_SCENE} />,
    )

    expect(screen.getByTestId('geology3d-compare-label-primary')).toBeTruthy()
    expect(screen.getByTestId('geology3d-compare-label-secondary').textContent).toBe(
      'Lithology',
    )
  })

  it('CMP8 — one "Single view" button closes either kind of split', () => {
    const onExitSplit = vi.fn()
    const { rerender } = render(
      <Geology3DViewer {...baseProps('compare')} compareScene={COMPARE_SCENE} onExitSplit={onExitSplit} />,
    )
    fireEvent.click(screen.getByTestId('geology3d-single-view-button'))

    rerender(
      <Geology3DViewer {...baseProps('split')} compareScene={COMPARE_SCENE} onExitSplit={onExitSplit} />,
    )
    fireEvent.click(screen.getByTestId('geology3d-single-view-button'))

    expect(onExitSplit).toHaveBeenCalledTimes(2)
  })

  it('CMP9 — the Compare verb is not offered while a split is already open', () => {
    render(
      <Geology3DViewer
        {...baseProps('split')}
        compareScene={COMPARE_SCENE}
        onEnterCompare={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('geology3d-compare-button')).toBeNull()
  })

  it('CMP10 — a stage with no counterpart model never shows the verb', () => {
    // The Stratigraphy stage: nothing to compare against.
    render(<Geology3DViewer {...baseProps('single')} />)

    expect(screen.queryByTestId('geology3d-compare-button')).toBeNull()
  })
})
