// Behaviour tests for "one continuous geology" across the section.
//
// Owner's words: the fill "doesn't paint over columns, maybe we should let it
// and make it more see through" and "same transparency everywhere plz".
//
// The gaps between columns are painted by the partition fill; the column cards
// are painted by their own stack of bands. Those two have to arrive at the SAME
// tone, which needs both halves: the stack at the fill's own transparency, AND
// the card behind it reduced to at most a very light veil — an opaque card
// under a translucent band is what made the columns read lighter than the gaps.
//
//   FO1  on the litho axis ContactsLayer's own stack coat is OFF — the
//        partition's dissolved column strips paint the stack, and a second
//        coat would composite the card darker than the gap
//   FO2  same on the geotech axis
//   FO3  the geological axis is untouched — it keeps its light backdrop bands
//   FO4  where the stack paints, the CPT card behind it is at most a very light
//        veil, so a band over a column reads the same as in the gap
//   FO5  the borehole's own log strip gets the same treatment, and stays fully
//        opaque on the geological axis where nothing paints over it
//   FO6  the two card treatments agree with each other — neither column kind
//        may read brighter than the other

import { describe, expect, it } from 'vitest'

import {
  SECTION_FILL_OPACITY,
  boreholeLogFillOpacity,
  columnCardVeilOpacity,
  columnStackFillOpacity,
} from './sectionFillOpacity'

/** The most underlay the eye tolerates before a card reads brighter than a gap. */
const VERY_LIGHT_VEIL = 0.2

describe('section fill opacity — the columns read like the gaps', () => {
  it('FO1: on the litho axis ContactsLayer paints NO second stack coat', () => {
    // The partition's own column strips (columnStripFills.ts) carry the stack,
    // dissolved into the gap fill; any ContactsLayer coat on top would stack
    // 0.62 over 0.62 and the card would read DARKER than the gap — the same
    // "not the same transparency" defect from the other direction.
    expect(columnStackFillOpacity('lithostratigraphic')).toBe(0)
  })

  it('FO2: on the geotech axis ContactsLayer paints NO second stack coat', () => {
    expect(columnStackFillOpacity('geotechnical')).toBe(0)
  })

  it('FO3: the geological axis keeps its light backdrop bands', () => {
    // Nothing paints over the columns there, so its faint 0.18 backdrop — which
    // has to sit UNDER contact lines and labels — is left alone.
    expect(columnStackFillOpacity('geological')).toBe(0.18)
    expect(columnStackFillOpacity('geological')).toBeLessThan(SECTION_FILL_OPACITY)
  })

  it('FO4: where the stack paints, the CPT card behind it is at most a very light veil', () => {
    expect(columnCardVeilOpacity('lithostratigraphic')).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
    expect(columnCardVeilOpacity('geotechnical')).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
    // The geological axis keeps the readable white track it always had.
    expect(columnCardVeilOpacity('geological')).toBe(0.7)
  })

  it('FO5: the borehole log strip is veiled the same way, and untouched on geology', () => {
    expect(boreholeLogFillOpacity('lithostratigraphic')).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
    expect(boreholeLogFillOpacity('geotechnical')).toBeLessThanOrEqual(VERY_LIGHT_VEIL)
    expect(boreholeLogFillOpacity('geological')).toBe(1)
  })

  it('FO6: neither column kind may read brighter than the other', () => {
    for (const axis of ['lithostratigraphic', 'geotechnical'] as const) {
      expect(boreholeLogFillOpacity(axis)).toBe(columnCardVeilOpacity(axis))
    }
  })
})
