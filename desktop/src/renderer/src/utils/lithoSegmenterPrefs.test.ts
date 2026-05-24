import { describe, expect, it } from 'vitest'

import {
  LITHO_SEGMENTER_DEFAULTS,
  buildLithoSegmenterPatch,
  readLithoSegmenterPrefs,
} from './lithoSegmenterPrefs'

describe('readLithoSegmenterPrefs', () => {
  it('returns defaults when view_state is null / undefined', () => {
    expect(readLithoSegmenterPrefs(null)).toEqual(LITHO_SEGMENTER_DEFAULTS)
    expect(readLithoSegmenterPrefs(undefined)).toEqual(LITHO_SEGMENTER_DEFAULTS)
  })

  it('returns defaults when the litho_segmenter key is missing', () => {
    expect(readLithoSegmenterPrefs({ cpt_channels: {} })).toEqual(
      LITHO_SEGMENTER_DEFAULTS,
    )
  })

  it('reads valid stored values for every field', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: {
          minimum_layer_thickness_m: 0.5,
          gunsat_kNm3: 18.0,
          dr_compression_factor: 0.6,
        },
      }),
    ).toEqual({
      minimumLayerThicknessM: 0.5,
      gunsatKNm3: 18.0,
      drCompressionFactor: 0.6,
    })
  })

  it('falls back to default on out-of-range value, field-independently', () => {
    // min_thickness too low → default; γunsat OK; Dr OK → only min_thickness resets
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: {
          minimum_layer_thickness_m: 0.01,
          gunsat_kNm3: 20.0,
          dr_compression_factor: 0.5,
        },
      }),
    ).toEqual({
      minimumLayerThicknessM: LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM,
      gunsatKNm3: 20.0,
      drCompressionFactor: 0.5,
    })
  })

  it('falls back to defaults on malformed types', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: {
          minimum_layer_thickness_m: 'not a number',
          gunsat_kNm3: null,
          dr_compression_factor: undefined,
        },
      }),
    ).toEqual(LITHO_SEGMENTER_DEFAULTS)
  })

  it('falls back to defaults when the litho_segmenter value itself is malformed', () => {
    expect(readLithoSegmenterPrefs({ litho_segmenter: 'not an object' })).toEqual(
      LITHO_SEGMENTER_DEFAULTS,
    )
    expect(readLithoSegmenterPrefs({ litho_segmenter: 42 })).toEqual(
      LITHO_SEGMENTER_DEFAULTS,
    )
  })

  it('respects backend bounds — γunsat 8-25, Dr factor 0.1-2.0', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { gunsat_kNm3: 7.0 }, // below floor
      }).gunsatKNm3,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.gunsatKNm3)
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { gunsat_kNm3: 30.0 }, // above ceiling
      }).gunsatKNm3,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.gunsatKNm3)
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { dr_compression_factor: 0.05 }, // below floor
      }).drCompressionFactor,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.drCompressionFactor)
  })
})

describe('buildLithoSegmenterPatch', () => {
  it('wraps every field under the view_state key', () => {
    expect(
      buildLithoSegmenterPatch({
        minimumLayerThicknessM: 0.3,
        gunsatKNm3: 17.5,
        drCompressionFactor: 0.7,
      }),
    ).toEqual({
      litho_segmenter: {
        minimum_layer_thickness_m: 0.3,
        gunsat_kNm3: 17.5,
        dr_compression_factor: 0.7,
      },
    })
  })
})
