// Pins for the fence cutout's scene dressing (owner ruling B6, 2026-08-27).
//
// Cesium does not run under jsdom, so these are wiring/source pins in the
// established style (the layer-order / rules-test precedent): the invariant
// is WHAT the cutout hands the shared viewer, read off the source, plus the
// constants themselves imported directly.
//
// B6a — the cutout renders NO ground-surface lid: the walls + basemap are the
//       whole scene, so ``groundSurface`` is passed as null (the 3-D stages
//       keep theirs — this is cutout-only wiring).
// B6b — the cutout's basemap is slightly see-through (owner verbatim: "make
//       the basemap a bit more seethrough? like 5%?"): its lid alpha is the
//       named cutout constant, while the shared stages keep their own default.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { UNIT_FENCE_BASEMAP_LID_ALPHA } from './unitFenceSceneConstants'
import { DEFAULT_BASEMAP_LID_ALPHA } from '../geology/geology3DPrimitives'

const SCENE_SRC = readFileSync(join(__dirname, 'UnitFenceScene.tsx'), 'utf-8')

describe('UnitFenceScene — scene dressing (owner ruling B6, 2026-08-27)', () => {
  it('B6a — the cutout passes NO ground surface to the viewer', () => {
    expect(SCENE_SRC).toMatch(/groundSurface=\{null\}/)
    // The old wiring must be gone, not merely joined by the new one.
    expect(SCENE_SRC).not.toMatch(/groundSurface=\{groundSurface\}/)
  })

  it('B6b — the cutout dials its basemap alpha through the named constant', () => {
    expect(SCENE_SRC).toMatch(/basemapLidAlpha=\{UNIT_FENCE_BASEMAP_LID_ALPHA\}/)
    // "a bit more seethrough? like 5%" — the shared lid sits at 0.65, so
    // more see-through means BELOW it: 0.60, in the cutout only.
    expect(UNIT_FENCE_BASEMAP_LID_ALPHA).toBe(0.6)
  })

  it('B6b-guard — the shared stages keep their own lid alpha (byte-identical)', () => {
    // 0.65 is the pre-B6 baked-in value; the cutout override must not move it.
    expect(DEFAULT_BASEMAP_LID_ALPHA).toBe(0.65)
  })
})
