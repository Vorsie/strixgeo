import { describe, expect, it } from 'vitest'
import {
  inCorridorInvestigationIds,
  memberIdsBySection,
} from './sectionClassification'

// A section line from (0,0) to (100,0), 10 m corridor.
const section = {
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: [] as string[],
  excluded_borehole_ids: [] as string[],
}
const pt = (id: string, x: number, y: number) => ({ id, location_x: x, location_y: y })

describe('inCorridorInvestigationIds', () => {
  it('includes in-corridor CPTs + boreholes, drops out-of-corridor and excluded', () => {
    const cpts = [pt('c-in', 50, 3), pt('c-far', 50, 40), pt('c-excl', 20, 0)]
    const boreholes = [pt('b-in', 80, -5)]
    const ids = inCorridorInvestigationIds(
      { ...section, excluded_cpt_ids: ['c-excl'] },
      cpts,
      boreholes,
    )
    expect(ids.has('c-in')).toBe(true)
    expect(ids.has('b-in')).toBe(true)
    expect(ids.has('c-far')).toBe(false) // offset 40 > 10 m buffer
    expect(ids.has('c-excl')).toBe(false) // excluded
  })
})

// The pooling population rule (owner ruling 2026-08-27, verbatim: "Only cpt's
// on the sections should be in the pooling so all hidden and removed should
// be excluded"). Membership is the CANONICAL rule — in corridor AND between
// the endpoints — folded over every section, never re-derived.
describe('memberIdsBySection', () => {
  it('MS1 — a test projecting beyond a section endpoint is NOT a member of it', () => {
    // The B6 lesson: "in corridor" alone is the sloppy check. This CPT sits
    // 1 m past the section's end point at zero offset — inside any buffer,
    // outside the endpoints.
    const cpts = [pt('c-beyond', 110, 0), pt('c-on', 50, 0)]
    const bySection = memberIdsBySection([{ id: 's1', ...section }], cpts, [])
    expect(bySection.get('s1')?.has('c-on')).toBe(true)
    expect(bySection.get('s1')?.has('c-beyond')).toBe(false)
  })

  it('MS2 — each section answers its own members; a test on ANY section pools', () => {
    // s1 runs west–east, s2 north–south from (200, 0). One CPT on each.
    const s2 = {
      id: 's2',
      start_x: 200,
      start_y: 0,
      end_x: 200,
      end_y: 100,
      projection_buffer_m: 10,
      excluded_cpt_ids: [] as string[],
      excluded_borehole_ids: [] as string[],
    }
    const cpts = [pt('c-s1', 50, 3), pt('c-s2', 203, 50), pt('c-nowhere', 500, 500)]
    const bySection = memberIdsBySection([{ id: 's1', ...section }, s2], cpts, [])

    expect(bySection.get('s1')?.has('c-s1')).toBe(true)
    expect(bySection.get('s1')?.has('c-s2')).toBe(false)
    expect(bySection.get('s2')?.has('c-s2')).toBe(true)

    // The union over the map is "on the sections" — the pooling population.
    const union = new Set([...bySection.values()].flatMap(s => [...s]))
    expect(union.has('c-s1')).toBe(true)
    expect(union.has('c-s2')).toBe(true)
    expect(union.has('c-nowhere')).toBe(false)
  })
})
