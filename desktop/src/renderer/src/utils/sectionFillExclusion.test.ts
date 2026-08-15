// Owner ask (dogfeed 2026-07-13): "make it so that fill bands automatically
// hides model fill and vice versa" — the two fills paint the same section
// area, so showing one demotes the other. Turning a fill OFF must NOT
// resurrect the other (only the ON-transition carries the side effect).

import { beforeEach, describe, expect, it } from 'vitest'

import { getBandFillVisible, setBandFill, toggleBandFill } from './bandFillStore'
import {
  getFormationFillVisible,
  setFormationFill,
  toggleFormationFill,
} from './formationFillStore'
import { getGeotechFillVisible, setGeotechFill, toggleGeotechFill } from './geotechFillStore'
import {
  getLithoFillOnGeotech,
  setLithoFillOnGeotech,
  toggleLithoFillOnGeotech,
} from './lithoFillOnGeotechStore'

describe('band fill ↔ model fill mutual exclusion', () => {
  beforeEach(() => {
    // App-load defaults: band fill hidden, model fill shown.
    setBandFill(false)
    setFormationFill(true)
  })

  it('turning fill bands ON hides the model fill', () => {
    expect(getFormationFillVisible()).toBe(true)
    toggleBandFill() // OFF -> ON
    expect(getBandFillVisible()).toBe(true)
    expect(getFormationFillVisible()).toBe(false)
  })

  it('turning model fill ON hides the fill bands', () => {
    toggleBandFill() // band fill ON (model fill auto-hidden)
    toggleFormationFill() // model fill back ON
    expect(getFormationFillVisible()).toBe(true)
    expect(getBandFillVisible()).toBe(false)
  })

  it('turning fill bands OFF leaves the model fill alone', () => {
    toggleBandFill() // ON — model fill hidden
    toggleBandFill() // OFF again
    expect(getBandFillVisible()).toBe(false)
    // No resurrection: the user hid the model fill implicitly; coming back
    // is an explicit verb, not a side effect of leaving band fill.
    expect(getFormationFillVisible()).toBe(false)
  })

  it('turning model fill OFF leaves the fill bands alone', () => {
    toggleFormationFill() // shown -> hidden
    expect(getBandFillVisible()).toBe(false)
    expect(getFormationFillVisible()).toBe(false)
  })
})

// Owner ask (dogfeed 2026-08-15): "packing and litho fill can't be on at the
// same time, we should put a safeguard when one is true the other turns false".
//
// ``selectSectionFill`` already resolved the clash for the RENDER (litho wins),
// so only one fill ever painted — but both toggles could still read "on" in the
// Display menu, and it was the STATE that was lying. The safeguard belongs on
// the stores, so the menu item and the bare-key accelerator (L / F) both inherit
// it from one place instead of each call site having to remember.
//
// Turning a fill OFF must not turn the other on: no fill at all is a legitimate
// state — it is what pipeline step 1 leaves you in.
describe('packing fill ↔ litho fill mutual exclusion (geotech axis)', () => {
  beforeEach(() => {
    // App-load defaults: both off (a clean slate paints nothing).
    setGeotechFill(false)
    setLithoFillOnGeotech(false)
  })

  it('L then F leaves only the packing fill on', () => {
    toggleLithoFillOnGeotech()
    expect(getLithoFillOnGeotech()).toBe(true)
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(true)
    expect(getLithoFillOnGeotech()).toBe(false)
  })

  it('F then L leaves only the litho fill on', () => {
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(true)
    toggleLithoFillOnGeotech()
    expect(getLithoFillOnGeotech()).toBe(true)
    expect(getGeotechFillVisible()).toBe(false)
  })

  it('F then F leaves nothing on', () => {
    toggleGeotechFill()
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(false)
    expect(getLithoFillOnGeotech()).toBe(false)
  })

  it('turning the packing fill OFF never turns the litho fill on', () => {
    toggleLithoFillOnGeotech() // litho on
    toggleGeotechFill() // packing on, litho auto-off
    toggleGeotechFill() // packing off again
    expect(getGeotechFillVisible()).toBe(false)
    expect(getLithoFillOnGeotech()).toBe(false)
  })

  it('turning the litho fill OFF never turns the packing fill on', () => {
    toggleGeotechFill() // packing on
    toggleLithoFillOnGeotech() // litho on, packing auto-off
    toggleLithoFillOnGeotech() // litho off again
    expect(getLithoFillOnGeotech()).toBe(false)
    expect(getGeotechFillVisible()).toBe(false)
  })
})
