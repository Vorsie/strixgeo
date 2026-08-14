// Behaviour tests for "one continuous geology" across the section.
//
// Owner's words, in order: the fill "doesn't paint over columns, maybe we
// should let it and make it more see through", then "same transparency
// everywhere plz" — and, after the first fix dimmed the cards permanently:
// "the opacity of the columns is changed" (2026-08-14, a dollar owed). The
// veil exists purely to SERVE the fill, so it may only apply while a fill is
// actually painting through the columns; with the fill hidden or absent the
// cards must look exactly as they always did.
//
//   FO1  fill SHOWN on the litho axis → ContactsLayer paints no second stack
//        coat (the partition's dissolved column strips carry the stack)
//   FO1b fill HIDDEN on the litho axis → the original 0.55 stack bands return
//   FO2  same pair on the geotech axis
//   FO3  the geological axis is untouched by the fill flag either way
//   FO4  the CPT card: very light veil ONLY while the fill paints; the
//        original 0.7 white track the moment it does not
//   FO5  the borehole DOV log: veiled ONLY while the fill paints; fully
//        opaque otherwise, and always opaque on the geological axis
//   FO6  while the fill paints, the two card treatments agree — neither
//        column kind may read brighter than the other

import { describe, expect, it } from 'vitest'

import {
  SECTION_FILL_OPACITY,
  boreholeLogFillOpacity,
  columnCardVeilOpacity,
  columnStackFillOpacity,
} from './sectionFillOpacity'

/** The most underlay the eye tolerates before a card reads brighter than a gap. */
const VERY_LIGHT_VEIL = 0.2

describe('section fill opacity — the columns read like the gaps, but only while a fill paints', () => {
  it('FO1: fill shown on the litho axis → no second stack coat from ContactsLayer', () => {
    // The partition's own column strips (columnStripFills.ts) carry the stack,
    // dissolved into the gap fill; a ContactsLayer coat on top would stack
    // 0.62 over 0.62 and the card would read DARKER than the gap.
    expect(columnStackFillOpacity('lithostratigraphic', true)).toBe(0)
  })

  it('FO1b: fill hidden on the litho axis → the original stack bands return', () => {
    // "the opacity of the columns is changed" — with no fill on screen the
    // column must look exactly as it did before the campaign.
    expect(columnStackFillOpacity('lithostratigraphic', false)).toBe(0.55)
  })

  it('FO2: the geotech axis behaves the same in both states', () => {
    expect(columnStackFillOpacity('geotechnical', true)).toBe(0)
    expect(columnStackFillOpacity('geotechnical', false)).toBe(0.55)
  })

  it('FO3: the geological axis ignores the fill flag entirely', () => {
    for (const fillShown of [true, false]) {
      expect(columnStackFillOpacity('geological', fillShown)).toBe(0.18)
      expect(columnCardVeilOpacity('geological', fillShown)).toBe(0.7)
      expect(boreholeLogFillOpacity('geological', fillShown)).toBe(1)
    }
    expect(columnStackFillOpacity('geological', false)).toBeLessThan(SECTION_FILL_OPACITY)
  })

  it('FO4: the CPT card veils only while the fill paints', () => {
    for (const axis of ['lithostratigraphic', 'geotechnical'] as const) {
      expect(columnCardVeilOpacity(axis, true)).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
      // The moment nothing paints over it, the original white track is back.
      expect(columnCardVeilOpacity(axis, false)).toBe(0.7)
    }
  })

  it('FO5: the borehole log dims only while the fill paints', () => {
    for (const axis of ['lithostratigraphic', 'geotechnical'] as const) {
      expect(boreholeLogFillOpacity(axis, true)).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
      expect(boreholeLogFillOpacity(axis, false)).toBe(1)
    }
  })

  it('FO6: while the fill paints, neither column kind may read brighter than the other', () => {
    for (const axis of ['lithostratigraphic', 'geotechnical'] as const) {
      expect(boreholeLogFillOpacity(axis, true)).toBe(columnCardVeilOpacity(axis, true))
    }
  })
})
