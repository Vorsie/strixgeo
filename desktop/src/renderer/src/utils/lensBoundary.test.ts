// Unit tests for the pure lens-boundary helpers (#163f Slice 2 frontend).
//
// Claims:
//   LP1  straight/rounded → merged anchors+nodes sorted by along_m (verbatim).
//   LP2  blocky → midpoint staircase, mirroring the backend geometry.
//   LP3  nodes merge with anchors regardless of input order.
//   LR1  resolveLensRoles picks the pinch target (the id joined to the other
//        two by edges) + orders the remaining two by depth (above < below).
//   LR2  returns null when the topology isn't a clean 1→2 (no shared target).
//   LR3  parseContentKey splits the 3 sorted ids.

import { describe, expect, it } from 'vitest'

import { lensBoundaryPolyline, parseContentKey, resolveLensRoles } from './lensBoundary'

describe('lensBoundaryPolyline', () => {
  it('LP1 — straight returns merged anchors + nodes sorted by along_m', () => {
    const pts = lensBoundaryPolyline(
      [
        { along_m: 20, elevation_m: 15 },
        { along_m: 0, elevation_m: 10 },
      ],
      [{ along_m: 10, elevation_m: 18 }],
      'straight',
    )
    expect(pts).toEqual([
      { along_m: 0, elevation_m: 10 },
      { along_m: 10, elevation_m: 18 },
      { along_m: 20, elevation_m: 15 },
    ])
  })

  it('LP1b — rounded returns the same points as straight (curve is a render detail)', () => {
    const anchors = [
      { along_m: 0, elevation_m: 10 },
      { along_m: 20, elevation_m: 10 },
    ]
    const nodes = [{ along_m: 10, elevation_m: 18 }]
    expect(lensBoundaryPolyline(anchors, nodes, 'rounded')).toEqual(
      lensBoundaryPolyline(anchors, nodes, 'straight'),
    )
  })

  it('LP2 — blocky expands each segment into a midpoint step', () => {
    const pts = lensBoundaryPolyline(
      [
        { along_m: 0, elevation_m: 10 },
        { along_m: 10, elevation_m: 20 },
      ],
      [],
      'blocky',
    )
    expect(pts).toEqual([
      { along_m: 0, elevation_m: 10 },
      { along_m: 5, elevation_m: 10 },
      { along_m: 5, elevation_m: 20 },
      { along_m: 10, elevation_m: 20 },
    ])
  })
})

describe('resolveLensRoles', () => {
  const depth = new Map([
    ['target', 5],
    ['above', 2],
    ['below', 8],
  ])

  it('LR1 — picks the pinch target + orders the other two by depth', () => {
    const roles = resolveLensRoles(
      ['target', 'above', 'below'],
      [
        { a: 'target', b: 'above' },
        { a: 'below', b: 'target' },
      ],
      depth,
    )
    expect(roles).toEqual({ targetId: 'target', aboveId: 'above', belowId: 'below' })
  })

  it('LR2 — returns null when no id is joined to both others (not a lens)', () => {
    const roles = resolveLensRoles(
      ['a', 'b', 'c'],
      [{ a: 'a', b: 'b' }], // only one edge — no pinch target
      new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    )
    expect(roles).toBeNull()
  })
})

describe('parseContentKey', () => {
  it('LR3 — splits the sorted id join', () => {
    expect(parseContentKey('aaa|bbb|ccc')).toEqual(['aaa', 'bbb', 'ccc'])
    expect(parseContentKey(null)).toEqual([])
    expect(parseContentKey('')).toEqual([])
  })
})
