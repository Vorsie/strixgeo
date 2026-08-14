// Owner rule for the sample markers: they are shown by default, and the
// Display menu can turn them off.
//
//   SM1  the section opens with the sample markers ON, and the Display item
//        flips them off and back on.

import { describe, expect, it } from 'vitest'

import { getSampleMarkersOn, toggleSampleMarkersOn } from './sampleMarkersOnStore'

describe('sampleMarkersOnStore', () => {
  it('SM1: samples are shown by default and the Display item flips them', () => {
    expect(getSampleMarkersOn()).toBe(true)
    toggleSampleMarkersOn()
    expect(getSampleMarkersOn()).toBe(false)
    toggleSampleMarkersOn()
    expect(getSampleMarkersOn()).toBe(true)
  })
})
