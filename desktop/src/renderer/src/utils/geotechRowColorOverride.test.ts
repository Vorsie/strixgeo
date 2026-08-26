// The colour a row of geotech units shows, when the row stands for several.
//
// Owner ruling 2026-08-26: "Colours on the right hand pane need to be choosable
// if user wants." The units pane and the 3-D legend both draw one swatch per
// packing class, so both ask this — the pins here are what stops them drifting
// into disagreeing about the same class.

import { describe, expect, it } from 'vitest'

import { geotechRowColorOverride } from './geotechRowColorOverride'

describe('geotechRowColorOverride', () => {
  it('RO1 — nobody picked, so the row has no colour of its own', () => {
    expect(geotechRowColorOverride([{ color_override: null }, {}])).toBeNull()
  })

  it('RO2 — one unit, and it was picked: that is the row colour', () => {
    expect(geotechRowColorOverride([{ color_override: '#ff00ff' }])).toBe('#ff00ff')
  })

  it('RO3 — every unit agrees, so the row shows what they agree on', () => {
    expect(
      geotechRowColorOverride([{ color_override: '#ff00ff' }, { color_override: '#ff00ff' }]),
    ).toBe('#ff00ff')
  })

  it('RO4 — the units disagree, so the row claims neither', () => {
    expect(
      geotechRowColorOverride([{ color_override: '#ff00ff' }, { color_override: '#00ff00' }]),
    ).toBeNull()
  })

  it('RO5 — one unit picked and another did not is still disagreement', () => {
    // The unpicked unit is drawn automatically, so showing the picked colour on
    // the row would claim a unit that is not that colour.
    expect(geotechRowColorOverride([{ color_override: '#ff00ff' }, {}])).toBeNull()
  })

  it('RO6 — an empty row answers null rather than throwing', () => {
    expect(geotechRowColorOverride([])).toBeNull()
  })
})
