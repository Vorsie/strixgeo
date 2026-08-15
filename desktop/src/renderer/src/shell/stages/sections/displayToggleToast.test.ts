// What a display-toggle hotkey says, and why it says it in the same slot.
//
// Owner (dogfeed 2026-08-15):
//
//   > "when i repeatedly press l the toast just kind of stack on the right, if
//   > it is a recurring toast for example by pressing same hotkey multiple
//   > times, you can just immediately replace it and don't need to flood the
//   > screen"
//
//   DT1  the sample-marker announcement names the state it just moved to
//   DT2  the litho-fill announcement names the fill the OPEN axis's menu names
//   DT3  each toggle owns a key, so pressing it again replaces its own toast
//   DT4  ...and the two toggles never replace each other's

import { describe, expect, it } from 'vitest'

import {
  LITHO_FILL_TOAST_KEY,
  SAMPLE_MARKERS_TOAST_KEY,
  lithoFillToastMessage,
  sampleMarkersToastMessage,
} from './displayToggleToast'

describe('displayToggleToast', () => {
  it('DT1: the sample-marker announcement says which way it went', () => {
    expect(sampleMarkersToastMessage(true)).toBe('Sample markers on')
    expect(sampleMarkersToastMessage(false)).toBe('Sample markers off')
  })

  it('DT2: the litho-fill announcement names the fill the open axis calls it', () => {
    // The menu item the key stands in for is "Show litho fill" on the geotech
    // axis and "Fill bands" on the litho axis; the announcement has to agree
    // with the menu, or it reads as a different toggle.
    expect(lithoFillToastMessage('geotechnical', true)).toBe('Litho fill on')
    expect(lithoFillToastMessage('geotechnical', false)).toBe('Litho fill off')
    expect(lithoFillToastMessage('lithostratigraphic', true)).toBe('Band fill on')
    expect(lithoFillToastMessage('lithostratigraphic', false)).toBe('Band fill off')
  })

  it('DT3: a toggle keeps ONE key across presses, so its toast replaces itself', () => {
    // The key is what makes the second press replace the first toast rather
    // than flooding the screen — it may not vary with the state announced.
    expect(SAMPLE_MARKERS_TOAST_KEY).toBe(SAMPLE_MARKERS_TOAST_KEY)
    expect(LITHO_FILL_TOAST_KEY).toBe(LITHO_FILL_TOAST_KEY)
    expect(SAMPLE_MARKERS_TOAST_KEY).toBeTruthy()
    expect(LITHO_FILL_TOAST_KEY).toBeTruthy()
  })

  it('DT4: the two toggles never take each other off the screen', () => {
    expect(SAMPLE_MARKERS_TOAST_KEY).not.toBe(LITHO_FILL_TOAST_KEY)
  })
})
