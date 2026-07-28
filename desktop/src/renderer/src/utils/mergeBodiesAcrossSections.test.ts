// Behaviour net for the cross-section body merge (stage 2).
//
// The rule is the owner's, in the owner's words: "there should be no auto ties
// that are generated, you just keep the ties and merge the bodies on
// lithological adjacency, like the renderer does" — and "something rendered as
// one body is one body in the data".
//
// The renderer's mergeTouchingBodies already does this WITHIN a section (stage 1,
// per-section geometric connect) and its own docstring records that the
// cross-section stage "stays the backend's job — recorded, not here". This is
// that stage: two regions on DIFFERENT sections are the same body when they meet
// at a SHARED COLUMN, with the same lithology, over overlapping elevation.
//
// No correlation edge is created, nothing is written to the database, and no
// geometry moves — only body_id is relabelled.

import { describe, expect, it } from 'vitest'

import { mergeBodiesAcrossSections } from './mergeBodiesAcrossSections'
import type { RegionInput, SectionPartitionInput } from './buildVoxelRequest'

function column(id: string, alongM = 0): SectionPartitionInput['columns'][number] {
  return { investigation_id: id, along_m: alongM, world_x: alongM, world_y: 0 }
}

/** A full-width band region spanning the gap from `top` down to `base`. */
function band(formation: string, bodyId: string | null, top: number, base: number): RegionInput {
  return {
    formation_id: formation,
    body_id: bodyId,
    polygon: [
      [0, top],
      [1, top],
      [1, base],
      [0, base],
    ],
    gap_index: 0,
  }
}

function section(cols: string[], regions: RegionInput[]): SectionPartitionInput {
  return {
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    columns: cols.map((c, i) => column(c, i * 50)),
    regions,
  }
}

/** Every distinct body id in the output, in section/region order. */
function bodies(out: SectionPartitionInput[]): (string | null)[] {
  return out.flatMap(s => s.regions.map(r => r.body_id))
}

describe('mergeBodiesAcrossSections', () => {
  it('two sections that share a column give that sand ONE body id', () => {
    // S9 is on both sections; both carry the same sand over the same elevations,
    // but the per-section merge gave each its own representative.
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [band('ZAND', 'body-from-tie', 3.2, -4.5)]),
      section(['S9', 'S8'], [band('ZAND', 'body-from-cs1', 3.2, -4.5)]),
    ])

    const ids = bodies(out)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe(ids[1])
  })

  it('picks the same representative whichever order the sections arrive in', () => {
    const a = section(['S4', 'S9'], [band('ZAND', 'bbb', 3.2, -4.5)])
    const b = section(['S9', 'S8'], [band('ZAND', 'aaa', 3.2, -4.5)])

    expect(bodies(mergeBodiesAcrossSections([a, b]))).toEqual(
      bodies(mergeBodiesAcrossSections([b, a])).slice().reverse(),
    )
    expect(bodies(mergeBodiesAcrossSections([a, b]))[0]).toBe('aaa')
  })

  it('does NOT merge different lithologies that meet at the shared column', () => {
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [band('ZAND', 'sand', 3.2, -4.5)]),
      section(['S9', 'S8'], [band('KLEI', 'clay', 3.2, -4.5)]),
    ])

    expect(bodies(out)).toEqual(['sand', 'clay'])
  })

  it('does NOT merge the same lithology when the two spans do not overlap at that column', () => {
    // Two separate sands stacked at S9 — an upper one and a deep one. Merging
    // them would be exactly the "upper lens gets pulled down" defect.
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [band('ZAND', 'upper', 8.0, 5.0)]),
      section(['S9', 'S8'], [band('ZAND', 'deep', 3.0, -4.0)]),
    ])

    expect(bodies(out)).toEqual(['upper', 'deep'])
  })

  it('does NOT merge sections that share no column', () => {
    const out = mergeBodiesAcrossSections([
      section(['S1', 'S2'], [band('ZAND', 'left', 3.2, -4.5)]),
      section(['S7', 'S8'], [band('ZAND', 'right', 3.2, -4.5)]),
    ])

    expect(bodies(out)).toEqual(['left', 'right'])
  })

  it('merges transitively — A meets B at one column, B meets C at another', () => {
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [band('ZAND', 'ccc', 3.2, -4.5)]),
      section(['S9', 'S8'], [band('ZAND', 'bbb', 3.2, -4.5)]),
      section(['S8', 'S7'], [band('ZAND', 'aaa', 3.2, -4.5)]),
    ])

    expect(new Set(bodies(out))).toEqual(new Set(['aaa']))
  })

  it('leaves never-correlated regions (null body) alone', () => {
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [band('ZAND', null, 3.2, -4.5)]),
      section(['S9', 'S8'], [band('ZAND', 'sand', 3.2, -4.5)]),
    ])

    expect(bodies(out)).toEqual([null, 'sand'])
  })

  it('relabels body_id and nothing else — no vertex, formation or gap moves', () => {
    const input = [
      section(['S4', 'S9'], [band('ZAND', 'bbb', 3.2, -4.5)]),
      section(['S9', 'S8'], [band('ZAND', 'aaa', 3.2, -4.5)]),
    ]
    const out = mergeBodiesAcrossSections(input)

    out.forEach((s, si) => {
      expect(s.columns).toEqual(input[si].columns)
      s.regions.forEach((r, ri) => {
        expect(r.polygon).toEqual(input[si].regions[ri].polygon)
        expect(r.formation_id).toBe(input[si].regions[ri].formation_id)
        expect(r.gap_index).toBe(input[si].regions[ri].gap_index)
      })
    })
  })

  it('does not mutate the input', () => {
    const input = [
      section(['S4', 'S9'], [band('ZAND', 'bbb', 3.2, -4.5)]),
      section(['S9', 'S8'], [band('ZAND', 'aaa', 3.2, -4.5)]),
    ]
    mergeBodiesAcrossSections(input)

    expect(input[0].regions[0].body_id).toBe('bbb')
  })

  it('a region that pinches out before the shared column does not reach it', () => {
    // Only touches fraction 0 (the S4 side), so it never meets S9.
    const wedge: RegionInput = {
      formation_id: 'ZAND',
      body_id: 'wedge',
      polygon: [
        [0, 3.2],
        [0.4, 0.0],
        [0, -4.5],
      ],
      gap_index: 0,
    }
    const out = mergeBodiesAcrossSections([
      section(['S4', 'S9'], [wedge]),
      section(['S9', 'S8'], [band('ZAND', 'sand', 3.2, -4.5)]),
    ])

    expect(bodies(out)).toEqual(['wedge', 'sand'])
  })
})
