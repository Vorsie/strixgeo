import { describe, expect, it } from 'vitest'

import {
  SECTION_DEFAULTS,
  buildSectionDefaultsPatch,
  readSectionDefaults,
} from './sectionDefaults'

describe('readSectionDefaults', () => {
  it('returns defaults on null / undefined view_state', () => {
    expect(readSectionDefaults(null)).toEqual(SECTION_DEFAULTS)
    expect(readSectionDefaults(undefined)).toEqual(SECTION_DEFAULTS)
  })

  it('returns defaults when section_defaults key is missing', () => {
    expect(readSectionDefaults({ litho_segmenter: {} })).toEqual(SECTION_DEFAULTS)
  })

  it('reads valid stored values', () => {
    expect(
      readSectionDefaults({
        section_defaults: { buffer_m: 25.0, vertical_exaggeration: 2.0 },
      }),
    ).toEqual({ bufferM: 25.0, verticalExaggeration: 2.0 })
  })

  it('falls back per-field on out-of-range values', () => {
    expect(
      readSectionDefaults({
        section_defaults: { buffer_m: 0.5, vertical_exaggeration: 3.0 },
      }),
    ).toEqual({
      bufferM: SECTION_DEFAULTS.bufferM,
      verticalExaggeration: 3.0,
    })
  })

  it('falls back on malformed types', () => {
    expect(
      readSectionDefaults({
        section_defaults: { buffer_m: 'oops', vertical_exaggeration: null },
      }),
    ).toEqual(SECTION_DEFAULTS)
  })
})

describe('buildSectionDefaultsPatch', () => {
  it('round-trips through read', () => {
    const patch = buildSectionDefaultsPatch({ bufferM: 30, verticalExaggeration: 1.5 })
    expect(patch).toEqual({
      section_defaults: { buffer_m: 30, vertical_exaggeration: 1.5 },
    })
    expect(readSectionDefaults(patch)).toEqual({
      bufferM: 30,
      verticalExaggeration: 1.5,
    })
  })
})
