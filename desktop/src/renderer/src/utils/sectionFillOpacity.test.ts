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
//   FO7  THE GATE, after the owner still saw a step at the 0.18 veil ("the
//        tone changes between those undeep columns?", 2026-08-15): the fill
//        over a column card and the same fill in the gap beside it composite
//        to the SAME colour. Asserted as an equality of the two composites,
//        never as a number — a future veil tweak has to break this test
//        rather than quietly bring the step back.
//   FO8  the geological axis is exempt: nothing paints over its columns, so
//        its card keeps its readable backing and the two tones may differ

import { describe, expect, it } from 'vitest'

import {
  type Rgb,
  SECTION_FILL_OPACITY,
  boreholeLogFillOpacity,
  columnCardVeilOpacity,
  columnFillTone,
  columnStackFillOpacity,
  compositeOver,
  gapFillTone,
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

  /** ``--section-plot-bg`` in the dark theme the owner works in (#1e293b). */
  const DARK_PLOT_BG: Rgb = [30, 41, 59]
  /** ``--section-plot-bg`` in the light theme (#fafafa) — the rule is theme-blind. */
  const LIGHT_PLOT_BG: Rgb = [250, 250, 250]
  /** The CPT track's white backing, and two DOV soil-pattern tones. */
  const CARD_COLOURS: Rgb[] = [
    [255, 255, 255],
    [214, 190, 122],
    [90, 110, 80],
  ]
  /** Representative partition-region colours (a sand, a clay, a peat). */
  const FILL_COLOURS: Rgb[] = [
    [234, 205, 122],
    [140, 160, 190],
    [70, 60, 45],
  ]

  it('FO7: the fill over a column card composites to exactly the gap tone', () => {
    // "the tone changes between those undeep columns?" — the answer has to be
    // no, for every card backing, every region colour and either theme. The
    // assertion is the equality itself, so nobody can restore a veil and still
    // pass by staying under a "very light" number.
    for (const axis of ['lithostratigraphic', 'geotechnical'] as const) {
      for (const background of [DARK_PLOT_BG, LIGHT_PLOT_BG]) {
        for (const card of CARD_COLOURS) {
          for (const fill of FILL_COLOURS) {
            expect(columnFillTone(background, card, fill, axis, true)).toEqual(
              gapFillTone(background, fill),
            )
          }
        }
      }
    }
  })

  it('FO7b: the composite helper blends the way the browser paints', () => {
    // A half-strength white over black is mid grey; a fully opaque top wins
    // outright; a fully transparent one leaves the backdrop untouched.
    expect(compositeOver([255, 255, 255], [0, 0, 0], 0.5)).toEqual([127.5, 127.5, 127.5])
    expect(compositeOver([10, 20, 30], [200, 200, 200], 1)).toEqual([10, 20, 30])
    expect(compositeOver([10, 20, 30], [200, 200, 200], 0)).toEqual([200, 200, 200])
    // And the gap tone is that same blend at the section's one fill opacity.
    expect(gapFillTone(DARK_PLOT_BG, [255, 255, 255])).toEqual(
      compositeOver([255, 255, 255], DARK_PLOT_BG, SECTION_FILL_OPACITY),
    )
  })

  it('FO8: the geological axis keeps its card backing, step and all', () => {
    // Nothing paints over the geology columns, so there is no gap tone to
    // match and the readable white track stays — the exemption is deliberate.
    expect(
      columnFillTone(DARK_PLOT_BG, [255, 255, 255], FILL_COLOURS[0], 'geological', true),
    ).not.toEqual(gapFillTone(DARK_PLOT_BG, FILL_COLOURS[0]))
  })
})
