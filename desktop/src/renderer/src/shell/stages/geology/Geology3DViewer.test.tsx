// Component-shell smoke for <Geology3DViewer> (debt #41 part b).
//
// Cesium's CesiumWidget needs a real WebGL2 context, so the whole `cesium`
// module is replaced with an inert auto-vivifying stub (`@/test/cesiumMock`)
// — see that module for the rationale. These tests cover the component SHELL
// the pure-math `cesiumGeometry.test.ts` cannot reach: the mount/rebuild
// effect wiring, the `widgetRef.current == null` guards, and the
// `resetCameraRef` callback whose body references `flyToBounds`/`flyToCutFace`
// (the `flyToCutFace`-ReferenceError bug class, commit 585c714). Every viewer
// builder early-returns on empty data, so empty props exercise the wiring
// without touching real Cesium math.
//
// NOT covered: the two-click split-line draw interaction. It lives inline in a
// Cesium ScreenSpaceEventHandler callback (not a separable pure reducer), so an
// inert Cesium mock — whose setInputAction is a no-op — cannot drive it. Driving
// it would need a callback-capturing harness asserting against stub geometry,
// which proves nothing real; left for a future richer-mock pass.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('cesium', async () => {
  const mod = await import('@/test/cesiumMock')
  return mod.cesiumNamespaceMock
})
// The widgets stylesheet resolves to a real file; css:false makes it inert.

// rebuildSurfacePrimitives is the ONLY place the legend's hide sets reach the
// scene, so spying on it is how a jsdom test can prove the eye toggles are
// wired all the way down (Geology3DViewer → CesiumViewport → primitives).
// Everything else in the module stays real (computeSplitPlane is used inline).
const rebuildSpy = vi.fn()
vi.mock('./geology3DPrimitives', async () => {
  const actual =
    await vi.importActual<typeof import('./geology3DPrimitives')>('./geology3DPrimitives')
  return { ...actual, rebuildSurfacePrimitives: (...args: unknown[]) => rebuildSpy(...args) }
})

import type { GeologicalFormationResponse } from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import Geology3DViewer from './Geology3DViewer'
import type { SplitMode } from './Geology3DViewer'

afterEach(() => {
  cleanup()
  rebuildSpy.mockClear()
})

/** A geotech unit — discriminated by source_litho_formation_id, not nad_class. */
function geotechUnit(
  id: string,
  nadClass: number | null,
  soil = 'ZAND',
): GeologicalFormationResponse {
  return {
    id,
    name: `${soil} (geotech)`,
    color: '#d4b84a',
    nad_class: nadClass,
    litho_main_soil_code: soil,
    litho_admixtures: [],
    source_litho_formation_id: 'litho-1',
    display_order: 0,
  } as unknown as GeologicalFormationResponse
}

/** A plain litho unit — no geotech discriminator, so it keeps the flat legend. */
function lithoUnit(id: string, soil = 'ZAND'): GeologicalFormationResponse {
  return {
    id,
    name: `${soil} unit`,
    color: '#fbbf24',
    nad_class: null,
    litho_main_soil_code: soil,
    litho_admixtures: [],
    source_litho_formation_id: null,
    display_order: 0,
  } as unknown as GeologicalFormationResponse
}

function solid(bodyId: string, formationId: string, ordinal = 0): LithoBodySolidResponse {
  return {
    body_id: bodyId,
    formation_id: formationId,
    body_ordinal: ordinal,
    vertices: [[0, 0, 0]],
    triangles: [[0, 0, 0]],
  } as unknown as LithoBodySolidResponse
}

/** The hiddenBodyIds set is the LAST positional arg of rebuildSurfacePrimitives. */
function lastHiddenBodyIds(): ReadonlySet<string> | undefined {
  const call = rebuildSpy.mock.calls.at(-1)
  return call?.[call.length - 1] as ReadonlySet<string> | undefined
}

function baseProps(splitMode: SplitMode = 'single') {
  return {
    splitMode,
    splitPlane: null,
    formations: [],
    surfacesByFormationId: new Map(),
    projectEpsg: 31370,
    onSplitPlaneDrawn: vi.fn(),
    resetCameraRef: { current: null } as React.MutableRefObject<(() => void) | null>,
  }
}

describe('Geology3DViewer shell smoke (#41b)', () => {
  it('G3D-1 — mounts in single mode with empty data without throwing', () => {
    expect(() => render(<Geology3DViewer {...baseProps('single')} />)).not.toThrow()
  })

  it('G3D-2 — mounts in split mode with empty data without throwing', () => {
    expect(() => render(<Geology3DViewer {...baseProps('split')} />)).not.toThrow()
  })

  it('G3D-3 — mount effect wires resetCameraRef; cleanup nulls it', () => {
    const props = baseProps('single')
    const { unmount } = render(<Geology3DViewer {...props} />)
    // The rebuild effect assigns a flyTo callback — proves effect wiring ran.
    expect(typeof props.resetCameraRef.current).toBe('function')
    unmount()
    expect(props.resetCameraRef.current).toBeNull()
  })

  it('G3D-4 — the reset callback (flyToBounds/flyToCutFace) runs without throwing', () => {
    const props = baseProps('single')
    render(<Geology3DViewer {...props} />)
    // Empty frame targets → flyToBounds early-returns; the point is that the
    // callback body's symbol references resolve (the 585c714 bug class).
    expect(() => props.resetCameraRef.current?.()).not.toThrow()
  })

  it('G3D-5 — rebuilds without throwing across mode + toggle prop changes', () => {
    const props = baseProps('single')
    const { rerender } = render(<Geology3DViewer {...props} />)
    // single → split remounts the viewport(s); the confidence toggle re-runs
    // the rebuild effect. Both must survive with empty data.
    expect(() =>
      rerender(<Geology3DViewer {...props} splitMode="split" />),
    ).not.toThrow()
    expect(() =>
      rerender(<Geology3DViewer {...props} splitMode="single" showConfidenceFade={false} />),
    ).not.toThrow()
  })
})

describe('Geology3DViewer LAYERS legend — nested tree on the geotech pane', () => {
  it('G3D-6 — geotech formations render the nested soil tree, closed at soil level', () => {
    render(
      <Geology3DViewer
        {...baseProps('single')}
        formations={[geotechUnit('g1', 6), geotechUnit('g2', 8)]}
        bodySolids={[solid('b1', 'g1'), solid('b2', 'g2')]}
      />,
    )
    // One family row for SAND; its classes are behind the caret.
    expect(screen.getByTestId('geotech-legend-family-ZAND')).toBeTruthy()
    expect(screen.queryByTestId('geotech-legend-class-ZAND:6')).toBeNull()
  })

  it('G3D-7 — non-geotech formations keep the flat per-formation list', () => {
    // Scope guard: the litho / geology legends are NOT redesigned by this work.
    render(
      <Geology3DViewer {...baseProps('single')} formations={[lithoUnit('l1'), lithoUnit('l2')]} />,
    )
    expect(screen.queryByTestId('geotech-legend-family-ZAND')).toBeNull()
    expect(screen.getAllByTitle('Hide in 3D')).toHaveLength(2)
  })

  it('G3D-8 — a body eye reaches the scene: the hidden id lands in the primitive rebuild', () => {
    render(
      <Geology3DViewer
        {...baseProps('single')}
        formations={[geotechUnit('g1', 6)]}
        bodySolids={[solid('b1', 'g1')]}
      />,
    )
    expect(lastHiddenBodyIds()?.size ?? 0).toBe(0)

    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND'))
    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND:6'))
    fireEvent.click(screen.getByTestId('geotech-legend-body-b1'))

    expect(lastHiddenBodyIds()?.has('b1')).toBe(true)
  })
})
