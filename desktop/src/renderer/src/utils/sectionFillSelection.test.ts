/**
 * Behaviour tests for the section fill-selection rule, in the owner's words
 * (dogfeed 2026-08-06): on the geotech axis the litho fill must not leak
 * through — it is a toggle, and only ONE fill renders at a time.
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
      hasRefinement: false,
    })
    expect(out).toEqual({ showBands: false, withholdRefinement: false })
  })

  it('showing the litho fill on the geotech axis hides the NAD fill — one fill at a time', () => {
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: true,
      hasRefinement: true,
    })
    // withholdRefinement swaps the NAD subdivision out of the overlay, so
    // the litho fill is the ONLY fill; showBands must be on for it to paint.
    expect(out).toEqual({ showBands: true, withholdRefinement: true })
  })

  it('with the litho-fill toggle off, the NAD fill obeys its own Hide-fill toggle', () => {
    const shown = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: false,
      hasRefinement: true,
    })
    expect(shown).toEqual({ showBands: true, withholdRefinement: false })
    const hidden = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: false,
      lithoFillOnGeotech: false,
      hasRefinement: true,
    })
    expect(hidden).toEqual({ showBands: false, withholdRefinement: false })
  })

  it('the litho-fill-on-geotech toggle also works on a clean slate (litho fill by request)', () => {
    // No packing model yet, but the engineer explicitly asks for the litho
    // fill — that is the pre-2026-08-06 render, now opt-in instead of a leak.
    const out = selectSectionFill({
      axisMode: 'geotechnical',
      bandFillVisible: false,
      geotechFillVisible: true,
      lithoFillOnGeotech: true,
      hasRefinement: false,
    })
    expect(out).toEqual({ showBands: true, withholdRefinement: true })
  })

  it('the litho and geological axes are untouched by the geotech-only toggle', () => {
    for (const axisMode of ['lithostratigraphic', 'geological'] as const) {
      for (const bandFillVisible of [true, false]) {
        const out = selectSectionFill({
          axisMode,
          bandFillVisible,
          geotechFillVisible: false,
          lithoFillOnGeotech: true,
          hasRefinement: false,
        })
        expect(out).toEqual({ showBands: bandFillVisible, withholdRefinement: false })
      }
    }
  })
})
