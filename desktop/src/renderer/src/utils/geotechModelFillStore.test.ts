// The geotech axis's "Show model fill" switch — the built 3-D geotech model
// drawn on the 2-D section, the peer of the litho axis's own model fill.
//
// Owner's words (2026-08-26): "rebuilding the 3d model now, the model is
// rebuild, can we show the actual 3D model on the 2d sections just like in
// litho stage". "Just like in litho stage" is the whole specification, so every
// claim below is phrased as "what the litho switch does, on this axis".
//
// Claims pinned:
//   GMF1  The switch starts ON, exactly as the litho model-fill switch does —
//         a built model shows itself.
//   GMF2  Asking for the model fill puts the packing fill away. One fill paints
//         the section at a time; that rule already governs the two fills this
//         axis had.
//   GMF3  Asking for the model fill also puts the borrowed litho fill away.
//   GMF4  Putting the model fill away brings neither of them back — "no fill"
//         is a state the engineer is allowed to be in.
//   GMF5  Asking for the packing fill puts the model fill away (the same rule
//         read from the other side).
//   GMF6  Asking for the borrowed litho fill puts the model fill away.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  getGeotechModelFillVisible,
  setGeotechModelFill,
  toggleGeotechModelFill,
} from './geotechModelFillStore'
import { getGeotechFillVisible, setGeotechFill, toggleGeotechFill } from './geotechFillStore'
import {
  getLithoFillOnGeotech,
  setLithoFillOnGeotech,
  toggleLithoFillOnGeotech,
} from './lithoFillOnGeotechStore'

// Read at module load, BEFORE any beforeEach has written to the store — the
// value a freshly opened app window sees. Reading it inside a test would only
// re-read whatever the setup wrote.
const VALUE_ON_FRESH_LOAD = getGeotechModelFillVisible()

/** Put all three geotech-axis fill switches in a known state. */
function reset(modelFill: boolean, packingFill: boolean, lithoFill: boolean): void {
  setGeotechModelFill(modelFill)
  setGeotechFill(packingFill)
  setLithoFillOnGeotech(lithoFill)
}

describe('geotechModelFillStore — the geotech axis "Show model fill" switch', () => {
  beforeEach(() => {
    reset(true, false, false)
  })

  it('GMF1: starts ON, like the litho model fill', () => {
    expect(VALUE_ON_FRESH_LOAD).toBe(true)
  })

  it('GMF2: asking for the model fill puts the packing fill away', () => {
    reset(false, true, false)

    toggleGeotechModelFill()

    expect(getGeotechModelFillVisible()).toBe(true)
    expect(getGeotechFillVisible()).toBe(false)
  })

  it('GMF3: asking for the model fill puts the borrowed litho fill away', () => {
    reset(false, false, true)

    toggleGeotechModelFill()

    expect(getGeotechModelFillVisible()).toBe(true)
    expect(getLithoFillOnGeotech()).toBe(false)
  })

  it('GMF4: putting the model fill away brings neither of them back', () => {
    reset(true, false, false)

    toggleGeotechModelFill()

    expect(getGeotechModelFillVisible()).toBe(false)
    expect(getGeotechFillVisible()).toBe(false)
    expect(getLithoFillOnGeotech()).toBe(false)
  })

  it('GMF5: asking for the packing fill puts the model fill away', () => {
    reset(true, false, false)

    toggleGeotechFill()

    expect(getGeotechFillVisible()).toBe(true)
    expect(getGeotechModelFillVisible()).toBe(false)
  })

  it('GMF6: asking for the borrowed litho fill puts the model fill away', () => {
    reset(true, false, false)

    toggleLithoFillOnGeotech()

    expect(getLithoFillOnGeotech()).toBe(true)
    expect(getGeotechModelFillVisible()).toBe(false)
  })
})
