// The basemap lid is an OVERLAY, excluded from the 3-D ordering (owner
// 2026-09-22: "basemap is excluded from ordering, always on top"). The
// formation sheets write depth (withDepthWrites), so a sheet lifted above the
// lid by its z-offset hid a depth-tested lid ("base map on bot now", owner
// dogfeed 2026-09-22). The lid is therefore drawn WITHOUT a depth test and is
// the LAST primitive of a rebuild, so Cesium's painter sort — which keeps the
// insertion order when it ties — always composites it over the geology.
//
// The assertions read ``appearance.getRenderState()``, the state Cesium
// consumes, not the ``renderState`` property (geology3DPrimitives.depthOrder.test.ts).
import * as Cesium from 'cesium'
import { beforeAll, describe, expect, it } from 'vitest'

import type {
  FormationSurfaceResponse,
  GroundSurfaceBuildResponse,
} from '../../../api/clients/geology.types'
import { makeFormation } from '../../../components/sections/__fixtures__/correlationOverlayScene'
import type { BasemapLid } from './geology3DPrimitives'
import { rebuildSurfacePrimitives } from './geology3DPrimitives'

interface RenderStateShape {
  depthMask?: boolean
  depthTest?: { enabled?: boolean }
  blending?: { enabled?: boolean }
}

function renderStateOf(p: Cesium.Primitive): RenderStateShape {
  return p.appearance.getRenderState() as RenderStateShape
}

// A scene that only records what the rebuild adds, in order.
function fakeScene(): { scene: Cesium.Scene; added: Cesium.Primitive[] } {
  const added: Cesium.Primitive[] = []
  const scene = {
    primitives: {
      removeAll: () => {
        added.length = 0
      },
      add: (p: Cesium.Primitive) => {
        added.push(p)
        return p
      },
    },
  } as unknown as Cesium.Scene
  return { scene, added }
}

// A 10 m square in Lambert-72 metres: ground at z = 10, one formation top at
// the same level (its z-offset lifts it 0.4 m, above the lid's 0.5 m
// clearance is not needed to make the point — the rule is structural).
const SQUARE: [number, number, number][] = [
  [150000, 200000, 10],
  [150010, 200000, 10],
  [150010, 200010, 10],
  [150000, 200010, 10],
]
const TRIS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 3],
]
const GROUND = {
  vertices: SQUARE,
  triangles: TRIS,
  provider_id: 'test',
  from_cache: false,
  issues: [],
} as unknown as GroundSurfaceBuildResponse
const FORMATION = { ...makeFormation('f-a', 'Antropogeen'), display_order: 2 }
const SURFACE: FormationSurfaceResponse = {
  id: 's-a',
  model_id: 'geo-1',
  formation_id: 'f-a',
  method: 'delaunay',
  is_stale: false,
  vertices: SQUARE,
  triangles: TRIS,
  source_contact_count: 4,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
const LID: BasemapLid = {
  rect: Cesium.Rectangle.fromDegrees(4.39, 51.0, 4.41, 51.01),
  elevation: 10.5,
  url: 'data:image/png;base64,iVBORw0KGgo=',
  projBbox: { minE: 150000, minN: 200000, maxE: 150010, maxN: 200010 },
}

function rebuild(): Cesium.Primitive[] {
  const { scene, added } = fakeScene()
  rebuildSurfacePrimitives(
    scene,
    [FORMATION],
    new Map([[FORMATION.id, SURFACE]]),
    31370,
    GROUND,
    undefined,
    LID,
    null,
    false,
    null,
    // No confidence fade: the formation sheet is then a plain
    // PerInstanceColorAppearance, distinguishable from the lid's textured one.
    false,
  )
  return added
}

const isLid = (p: Cesium.Primitive): boolean =>
  p.appearance instanceof Cesium.EllipsoidSurfaceAppearance

// jsdom has no ImageBitmap / OffscreenCanvas; Cesium's Material only names
// them in an ``instanceof`` chain when it classifies the lid's image uniform,
// so empty classes are enough for the material to be built here.
beforeAll(() => {
  const g = globalThis as { ImageBitmap?: unknown; OffscreenCanvas?: unknown }
  if (g.ImageBitmap === undefined) g.ImageBitmap = class ImageBitmapStub {}
  if (g.OffscreenCanvas === undefined) g.OffscreenCanvas = class OffscreenCanvasStub {}
})

describe('the basemap lid is an overlay: always on top, excluded from the ordering', () => {
  it('B1 — the lid is drawn without a depth test, still translucent, never writing depth', () => {
    const lid = rebuild().find(isLid)
    expect(lid).toBeDefined()
    const rs = renderStateOf(lid as Cesium.Primitive)
    expect(rs.depthTest?.enabled).toBe(false)
    expect(rs.depthMask).toBe(false)
    expect(rs.blending?.enabled).toBe(true)
  })

  it('B2 — the lid is the LAST primitive of a rebuild, after the ground and the sheets', () => {
    const added = rebuild()
    expect(added.length).toBeGreaterThanOrEqual(3)
    expect(isLid(added[added.length - 1])).toBe(true)
    expect(added.filter(isLid)).toHaveLength(1)
  })

  it('B3 — the overlay rule does not leak: the formation sheet still writes depth and is depth-tested', () => {
    const sheets = rebuild().filter((p) => !isLid(p) && renderStateOf(p).depthMask === true)
    expect(sheets).toHaveLength(1)
    expect(renderStateOf(sheets[0]).depthTest?.enabled).toBe(true)
  })
})
