// Behaviour tests for the dissolved-fill grouping (S61 — owner clause 5,
// app-render half: "merge touching lithos" into ONE paint operation).
//
// The visible litho fill must render as ONE <path> per merged same-litho body
// so a single translucent element composites once — no inter-element
// antialiasing hairline between adjacent same-litho regions, and no darkened
// seam from separate 0.62 elements overlapping. These tests paraphrase that in
// structural terms:
//
//   FG1  two adjacent SAME-litho regions dissolve into ONE group (one <path>,
//        both rings present as subpaths) — the merged body is one paint op.
//   FG2  a cross-litho pair stays TWO groups (the real litho boundary is kept
//        as a separate element for the boundary stroke to hem).
//   FG3  the S1 fade splits a lithology into two buckets (selected natural vs
//        demoted 0.25) so each group stays one uniform opacity.
//   FG4  all subpaths in a group share one winding sign (nonzero fills the
//        union — an opposite-wound subpath would punch an overlap hole).
//   FG5  a lens opacity (0.85) and a same-litho quad (0.62) do NOT merge (they
//        land in different opacity buckets).

import { describe, expect, it } from 'vitest'

import { buildFillGroups, type FillGroupElement } from './sectionFillGroups'

/** Signed shoelace area (sign = winding) of a ring parsed from a subpath's coords. */
function ringSign(coords: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    a += coords[j].x * coords[i].y - coords[i].x * coords[j].y
  }
  return Math.sign(a)
}

/** Parse each ``M … Z`` subpath of a ``d`` into its vertex list. */
function subpaths(d: string): { x: number; y: number }[][] {
  return d
    .split('Z')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      Array.from(s.matchAll(/[ML] ([\d.-]+),([\d.-]+)/g)).map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      })),
    )
}

const el = (
  formationId: string,
  color: string,
  opacity: number,
  points: { x: number; y: number }[],
): FillGroupElement => ({ formationId, color, opacity, opacityBucket: String(opacity), points })

// Two SAND quads sharing the diagonal edge (50,0)-(100,100): a termination-line
// seam inside one sand mass (the exact shape that used to hairline).
const leftSand = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]
const rightSand = [
  { x: 50, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 100 },
  { x: 100, y: 100 },
]

describe('buildFillGroups — one paint op per merged same-litho body', () => {
  it('FG1 — two adjacent same-litho regions dissolve into ONE group with both rings', () => {
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, leftSand),
      el('fSand', '#fbbf24', 0.62, rightSand),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].color).toBe('#fbbf24')
    expect(groups[0].opacity).toBe(0.62)
    // Both rings survive as subpaths of the ONE element (Z per ring).
    expect(subpaths(groups[0].d)).toHaveLength(2)
  })

  it('FG2 — a cross-litho pair stays two separate groups', () => {
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, leftSand),
      el('fClay', '#6b7280', 0.62, rightSand),
    ])
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.color))).toEqual(new Set(['#fbbf24', '#6b7280']))
  })

  it('FG3 — the S1 fade splits a lithology into natural + demoted buckets', () => {
    // Same lithology, two opacities (selected body natural 0.62 vs demoted 0.25).
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, leftSand),
      el('fSand', '#fbbf24', 0.25, rightSand),
    ])
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.opacity))).toEqual(new Set([0.62, 0.25]))
    // Each bucket is one uniform-opacity element (a single ring each).
    for (const g of groups) expect(subpaths(g.d)).toHaveLength(1)
  })

  it('FG4 — every subpath of a group shares one winding sign (nonzero fills the union)', () => {
    // Feed the two rings with OPPOSITE windings; the builder must normalise them.
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, leftSand),
      el('fSand', '#fbbf24', 0.62, [...rightSand].reverse()),
    ])
    expect(groups).toHaveLength(1)
    const signs = subpaths(groups[0].d).map(ringSign)
    expect(new Set(signs).size).toBe(1) // all same winding
  })

  it('FG5 — a lens (0.85) and a same-litho quad (0.62) do NOT merge', () => {
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, leftSand),
      el('fSand', '#fbbf24', 0.85, rightSand),
    ])
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.opacity))).toEqual(new Set([0.62, 0.85]))
  })

  it('FG6 — degenerate (<3 vertex) rings are skipped; an all-degenerate group is omitted', () => {
    const groups = buildFillGroups([
      el('fSand', '#fbbf24', 0.62, [{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    ])
    expect(groups).toHaveLength(0)
  })
})
