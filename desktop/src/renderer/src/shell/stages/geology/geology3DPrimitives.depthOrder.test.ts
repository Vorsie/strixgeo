// The 3-D stratigraphic view stacks one translucent sheet per formation. With
// order-independent translucency off (CesiumViewport, the shimmer fix), Cesium
// sorts translucent sheets per frame by the distance of their bounding
// spheres — and three sheets on one footprint tie, so from the side the
// deepest colour composited ON TOP ("a green sheen on top, while that should be
// all red"; owner dogfeed 2026-09-22). The cut view was right because its caps
// are opaque and depth-tested. Formation sheets therefore WRITE depth: the
// nearer sheet is in front whatever the draw order. The ground sheet and the
// lid keep the see-through default so the block stays visible under them.
import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'

import { buildTinPrimitive, buildTinPrimitiveWithVertexColor } from './geology3DPrimitives'

// A small square TIN in Lambert-72 metres, z = x + y for a visible slope.
const VERTS: [number, number, number][] = [
  [150000, 200000, 0],
  [150010, 200000, 10],
  [150010, 200010, 20],
  [150000, 200010, 10],
]
const TRIS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 3],
]
const RED = new Cesium.Color(1, 0, 0, 0.75)

interface RenderStateShape {
  depthMask?: boolean
  depthTest?: { enabled?: boolean }
  blending?: { enabled?: boolean }
}

function renderStateOf(p: Cesium.Primitive | null): RenderStateShape {
  expect(p).not.toBeNull()
  return (p as Cesium.Primitive).appearance.renderState as RenderStateShape
}

describe('formation sheets in the 3-D view: the nearer sheet is in front whatever the draw order', () => {
  it('D1 — a formation sheet writes depth', () => {
    const p = buildTinPrimitive(VERTS, TRIS, RED, 31370, undefined, { writesDepth: true })
    expect(renderStateOf(p).depthMask).toBe(true)
    expect(renderStateOf(p).depthTest?.enabled).toBe(true)
  })

  it('D2 — the ground sheet keeps the see-through default, no depth writes', () => {
    const p = buildTinPrimitive(VERTS, TRIS, RED, 31370)
    expect(renderStateOf(p).depthMask).toBe(false)
  })

  it('D3 — the confidence-fade (vertex colour) sheet writes depth too', () => {
    const colors = new Uint8Array(VERTS.length * 4).fill(255)
    const p = buildTinPrimitiveWithVertexColor(VERTS, TRIS, colors, 31370, undefined, undefined, {
      writesDepth: true,
    })
    expect(renderStateOf(p).depthMask).toBe(true)
  })

  it('D4 — a depth-writing sheet still alpha-blends (it stays translucent)', () => {
    const p = buildTinPrimitive(VERTS, TRIS, RED, 31370, undefined, { writesDepth: true })
    expect(renderStateOf(p).blending?.enabled).toBe(true)
  })
})
