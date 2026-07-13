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
