import { describe, expect, it } from 'vitest'
import { inCorridorInvestigationIds } from './sectionClassification'

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
