// The ONE geotech-body auto-label vocabulary, shared by the Parameters pane
// rows, the scope header, the section body-menu header and the Geotech-units
// pane (owner dogfeed 2026-09-01: "the stats jump lands on 'SF #0' while the
// pane says 'SILT · #0' … very confusing"). A geotech body now reads soil +
// packing + ordinal — "SILT · SF #0" — so it can never be mistaken for the litho
// body's "SILT · #0" and reads identically everywhere.

import { describe, expect, it } from 'vitest'

import { geotechBodyAutoLabel, nadSoilPackingLabel } from './geotechBodyLabel'

describe('nadSoilPackingLabel', () => {
  it('GBL1 — spaces the soil+packing abbreviation: SILT·SF → "SILT · SF"', () => {
    // NAD 13 is SILT·SF (slightly-firm silt) in NAD_CLASS_ABBR.
    expect(nadSoilPackingLabel(13, 'en')).toBe('SILT · SF')
  })

  it('GBL2 — keeps the Dutch soil word with the English packing token (ruling 19)', () => {
    // NAD 6 is SAND·MD → the NL table translates only the soil word: ZAND·MD.
    expect(nadSoilPackingLabel(6, 'nl')).toBe('ZAND · MD')
  })
})

describe('geotechBodyAutoLabel', () => {
  it('GBL3 — soil + packing + ordinal: "SILT · SF #0"', () => {
    expect(geotechBodyAutoLabel(13, 0, 'en')).toBe('SILT · SF #0')
  })
})
