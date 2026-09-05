// desktop/src/renderer/src/utils/mergeFencePanels.test.ts
//
// Phase 7 of debt #278 — the fence follow-on. Owner ruling 2026-08-31, in his
// own words: "one connected geotech body = ONE db row" and (fence follow-on)
// "emit one panel per connected body per section". Today the fence emits one
// panel per REGION (one region per gap), so a body spanning N gaps shows N−1
// spurious vertical seams. These pins state the ruling behaviourally: one
// connected body on a section is ONE fence panel, with the shared column edge
// welded so it is index-shared (which is what erases the seam on screen and in
// the DXF).
import { describe, expect, it } from 'vitest'
import { mergeFencePanels } from './mergeFencePanels'
import type { FencePanel } from './fencePanels'

/**
 * A rectangular wall panel in gap ``[xLeft, xRight]`` from ``top`` down to
 * ``base`` at both columns, split into the same two triangles ``buildFencePanels``
 * would emit. Section is horizontal at y=0, so world y is 0 throughout.
 */
function quad(
  formationId: string,
  bodyId: string | null,
  layerIds: readonly string[] | undefined,
  xLeft: number,
  xRight: number,
  top: number,
  base: number,
): FencePanel {
  return {
    formationId,
    bodyId,
    layerIds,
    vertices: [
      [xLeft, 0, top], // 0
      [xRight, 0, top], // 1
      [xRight, 0, base], // 2
      [xLeft, 0, base], // 3
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  }
}

/** The welded index of the vertex nearest ``target`` in a merged panel. */
function indexOfVertex(panel: FencePanel, target: [number, number, number]): number {
  let best = -1
  let bestD = Infinity
  panel.vertices.forEach((v, i) => {
    const d = Math.hypot(v[0] - target[0], v[1] - target[1], v[2] - target[2])
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** How many triangles of ``panel`` contain BOTH vertex indices (i.e. that edge). */
function trianglesOnEdge(panel: FencePanel, a: number, b: number): number {
  return panel.triangles.filter(t => t.includes(a) && t.includes(b)).length
}

describe('mergeFencePanels — one connected body, one panel', () => {
  it('merges two adjacent-gap panels of one body into ONE panel with an index-shared seam', () => {
    // Gap 0: x 0..50, gap 1: x 50..100 — one ZAND body across both. The shared
    // column edge lives at x=50 (fraction 1 of gap 0 == fraction 0 of gap 1).
    const panels = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('ZAND', 'z', ['lb'], 50, 100, 5, 0),
    ]
    const resolve = (ids: readonly string[] | undefined): string | null =>
      ids?.some(id => id === 'la' || id === 'lb') ? 'z' : null

    const merged = mergeFencePanels(panels, resolve)

    expect(merged).toHaveLength(1)
    // The seam column endpoints are welded to single indices…
    const topSeam = indexOfVertex(merged[0], [50, 0, 5])
    const baseSeam = indexOfVertex(merged[0], [50, 0, 0])
    // …so the seam edge is now shared by triangles from BOTH gaps (≥2). That
    // index-sharing is exactly what makes the DXF seam invisible and the on-
    // screen seam disappear.
    expect(trianglesOnEdge(merged[0], topSeam, baseSeam)).toBeGreaterThanOrEqual(2)
    // The merged wall carries the union of its members' source layers.
    expect([...(merged[0].layerIds ?? [])].sort()).toEqual(['la', 'lb'])
    expect(merged[0].formationId).toBe('ZAND')
    expect(merged[0].bodyId).toBe('z')
  })

  it('a merged panel keeps the section id of its members', () => {
    const a = { ...quad('f', 'b1', ['l1'], 0, 10, 5, 0), sectionId: 'cs-1' }
    const b = { ...quad('f', 'b1', ['l2'], 10, 20, 5, 0), sectionId: 'cs-1' }
    const merged = mergeFencePanels([a, b], () => 'b1')
    expect(merged).toHaveLength(1)
    expect(merged[0].sectionId).toBe('cs-1')
  })

  it('keeps two panels of DIFFERENT resolved bodies as two panels', () => {
    const panels = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('ZAND', 'y', ['lb'], 50, 100, 5, 0),
    ]
    const resolve = (ids: readonly string[] | undefined): string | null => {
      if (ids?.includes('la')) return 'z'
      if (ids?.includes('lb')) return 'y'
      return null
    }
    expect(mergeFencePanels(panels, resolve)).toHaveLength(2)
  })

  it('never merges panels whose body resolution is null, even adjacent same-formation walls', () => {
    // Fallback paint / unstamped layers → the resolver reports null. A null is
    // "no body identity", not "same body": these must NOT be welded into one.
    const panels = [
      quad('ZAND', null, undefined, 0, 50, 5, 0),
      quad('ZAND', null, [], 50, 100, 5, 0),
    ]
    const resolve = (): string | null => null
    expect(mergeFencePanels(panels, resolve)).toHaveLength(2)
  })

  it('welds vertices within 0.1 mm but leaves distinct cut points (≥ the fill grid) apart', () => {
    // Two triangles of one body sharing two vertices exactly; the third differs
    // only in elevation. 0.5 mm apart (> 0.1 mm tol) stays two vertices;
    // 0.05 mm apart (< 0.1 mm tol) fuses to one.
    const triA: FencePanel = {
      formationId: 'ZAND',
      bodyId: 'z',
      layerIds: ['la'],
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 0, 10],
      ],
      triangles: [[0, 1, 2]],
    }
    const triB = (dz: number): FencePanel => ({
      formationId: 'ZAND',
      bodyId: 'z',
      layerIds: ['lb'],
      vertices: [
        [0, 0, dz],
        [10, 0, 0],
        [0, 0, 10],
      ],
      triangles: [[0, 1, 2]],
    })
    const resolve = (): string | null => 'z'

    // 0.5 mm apart → the near-origin vertex stays distinct: 3 shared + 1 = 4.
    const farApart = mergeFencePanels([triA, triB(0.0005)], resolve)
    expect(farApart).toHaveLength(1)
    expect(farApart[0].vertices).toHaveLength(4)

    // 0.05 mm apart → the near-origin vertex fuses: 3 vertices total.
    const closeTogether = mergeFencePanels([triA, triB(0.00005)], resolve)
    expect(closeTogether).toHaveLength(1)
    expect(closeTogether[0].vertices).toHaveLength(3)
  })

  it('falls back to formationId|bodyId label grouping when no resolver is supplied', () => {
    // The litho arm mints cross-gap-consistent bodyId labels (mergeTouchingBodies),
    // so label grouping is a safe fallback there; the resolver stays PRIMARY
    // because the hierarchical geotech fill labels are per-gap mints.
    const sameBody = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('ZAND', 'z', ['lb'], 50, 100, 5, 0),
    ]
    expect(mergeFencePanels(sameBody)).toHaveLength(1)

    const twoBodies = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('ZAND', 'y', ['lb'], 50, 100, 5, 0),
    ]
    expect(mergeFencePanels(twoBodies)).toHaveLength(2)
  })

  it('leaves an empty project and a lone panel untouched', () => {
    expect(mergeFencePanels([])).toEqual([])
    const lone = [quad('ZAND', 'z', ['la'], 0, 50, 5, 0)]
    const out = mergeFencePanels(lone)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(lone[0]) // passed through by identity — nothing to merge
  })

  it('stamps a merged wall with the FIRST member formationId when members disagree', () => {
    // A cross-family-welded body can carry panels of two formations (see the
    // module docstring's KNOWN LIMITATION). The merge stamps the whole wall with
    // the first member's formationId — deterministic, by render order.
    const panels = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('LEEM', 'z', ['lb'], 50, 100, 5, 0),
    ]
    const resolve = (): string | null => 'z'
    const merged = mergeFencePanels(panels, resolve)
    expect(merged).toHaveLength(1)
    expect(merged[0].formationId).toBe('ZAND') // the first member, not 'LEEM'
  })

  it('keeps disjoint parts of one body as ONE panel of two triangle islands', () => {
    // Two panels of the same body that share NO vertex (a lateral gap between
    // them). They still collapse to one panel — consumers treat a panel as a
    // triangle soup — with no welding: the vertex count is the exact sum.
    const panels = [
      quad('ZAND', 'z', ['la'], 0, 50, 5, 0),
      quad('ZAND', 'z', ['lb'], 200, 250, 5, 0), // far away — no shared column
    ]
    const resolve = (): string | null => 'z'
    const merged = mergeFencePanels(panels, resolve)
    expect(merged).toHaveLength(1)
    expect(merged[0].vertices).toHaveLength(8) // 4 + 4, nothing welded
    expect(merged[0].triangles).toHaveLength(4) // 2 + 2 islands, all kept
  })

  it('drops a triangle whose corners weld onto fewer than three distinct vertices', () => {
    // A body's second panel is a sliver whose first two corners are 0.05 mm
    // apart: they weld to the SAME index, so that triangle collapses to <3
    // distinct indices post-weld and is dropped rather than shipped as a
    // zero-area degenerate.
    const wide: FencePanel = {
      formationId: 'ZAND',
      bodyId: 'z',
      layerIds: ['la'],
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 0, 10],
      ],
      triangles: [[0, 1, 2]],
    }
    const sliver: FencePanel = {
      formationId: 'ZAND',
      bodyId: 'z',
      layerIds: ['lb'],
      vertices: [
        [0, 0, 0], // = wide[0]
        [0.00005, 0, 0], // 0.05 mm from wide[0] → welds to the same index
        [10, 0, 0], // = wide[1]
      ],
      triangles: [[0, 1, 2]],
    }
    const resolve = (): string | null => 'z'
    const merged = mergeFencePanels([wide, sliver], resolve)
    expect(merged).toHaveLength(1)
    expect(merged[0].vertices).toHaveLength(3) // sliver welds entirely onto wide
    expect(merged[0].triangles).toHaveLength(1) // wide's kept; the sliver dropped
  })
})
