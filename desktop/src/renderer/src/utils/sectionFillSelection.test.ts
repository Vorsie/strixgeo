/**
 * Behaviour tests for the section fill-selection rule, in the owner's words.
 *
 * Dogfeed 2026-08-06: on the geotech axis the litho fill must not leak
 * through — it is a toggle, and only ONE fill renders at a time.
 *
 * Owner ruling 2026-08-13: the fill the geotech axis paints by default is the
 * DIRECT geotech partition, not the litho partition subdivided after the fact.
 * The toggle's meaning is unchanged — "Show litho fill" swaps the litho
 * partition in INSTEAD — but the flag it raises now names that swap
 * (``showLithoFillInstead``) rather than the retired refinement bundle.
 */

import { describe, expect, it } from 'vitest'

import { selectSectionFill } from './sectionFillSelection'

describe('selectSectionFill', () => {
  it('geotech axis with no packing model shows NO fill — the litho fill must not leak through', () => {
    // The clean-slate complaint: model deleted, axis switched to geotech,
    // yet the litho partition painted anyway (showBands defaulted true).
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: false,
      geotechUnitCount: 0,
      geotechAcceptedTieCount: 0,
    })
    expect(out).toEqual({ showBands: false, showLithoFillInstead: false })
  })

  it('a geotech model with no units yet is STILL a clean slate — an empty model must not count', () => {
    // The rule keys on actual packing bands, never on the geotech bundle
    // existing: the canvas assembles it whenever the axis is geotech.
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: false,
      geotechUnitCount: 0,
      geotechAcceptedTieCount: 0,
    })
    expect(out).toEqual({ showBands: false, showLithoFillInstead: false })
  })

  it('showing the litho fill on the geotech axis hides the packing fill — one fill at a time', () => {
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: true,
      geotechUnitCount: 4,
      geotechAcceptedTieCount: 2,
    })
    // showLithoFillInstead swaps the partition's own source back to the litho
    // model, so the litho fill is the ONLY fill; showBands must be on to paint.
    expect(out).toEqual({ showBands: true, showLithoFillInstead: true })
  })

  it('with the litho-fill toggle off, the packing fill obeys its own Hide-fill toggle', () => {
    const shown = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: false,
      geotechUnitCount: 4,
      geotechAcceptedTieCount: 2,
    })
    expect(shown).toEqual({ showBands: true, showLithoFillInstead: false })
    const hidden = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: false,
      lithoFillOnGeotech: false,
      geotechUnitCount: 4,
      geotechAcceptedTieCount: 2,
    })
    expect(hidden).toEqual({ showBands: false, showLithoFillInstead: false })
  })

  it('the litho-fill-on-geotech toggle also works on a clean slate (litho fill by request)', () => {
    // No packing model yet, but the engineer explicitly asks for the litho
    // fill — that is the pre-2026-08-06 render, now opt-in instead of a leak.
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: true,
      geotechUnitCount: 0,
      geotechAcceptedTieCount: 0,
    })
    expect(out).toEqual({ showBands: true, showLithoFillInstead: true })
  })

  it('bands without a single accepted tie show NO fill — pinch clutter helps nobody', () => {
    // Owner (dogfeed 2026-08-14 night): "when pressing 1 subdivide cpt's the
    // fill get's turned on, this is useless clutter before the ties are
    // there, switch that". With zero accepted ties every band pinches
    // mid-gap; the fill earns its place only once step 2's restatements (or
    // hand ties) exist.
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: false,
      geotechUnitCount: 40,
      geotechAcceptedTieCount: 0,
    })
    expect(out).toEqual({ showBands: false, showLithoFillInstead: false })
  })

  it('the litho and geological axes are untouched by the geotech-only toggle', () => {
    for (const axisMode of ['lithostratigraphic', 'geological'] as const) {
      for (const bandFillVisible of [true, false]) {
        const out = selectSectionFill({
          axisMode,
          bandFillVisible,
          geotechFillVisible: false,
          lithoFillOnGeotech: true,
          geotechUnitCount: 0,
          geotechAcceptedTieCount: 0,
        })
        expect(out).toEqual({ showBands: bandFillVisible, showLithoFillInstead: false })
      }
    }
  })
})
