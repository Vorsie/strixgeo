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

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('cesium', async () => {
  const mod = await import('@/test/cesiumMock')
  return mod.cesiumNamespaceMock
})
// The widgets stylesheet resolves to a real file; css:false makes it inert.

import Geology3DViewer from './Geology3DViewer'
import type { SplitMode } from './Geology3DViewer'

afterEach(cleanup)

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
