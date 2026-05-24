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

  it('reads a valid stored value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.5 },
      }),
    ).toEqual({ minimumLayerThicknessM: 0.5 })
  })

  it('falls back to default on out-of-range value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.01 },
      }),
    ).toEqual(LITHO_SEGMENTER_DEFAULTS)
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 50 },
      }),
    ).toEqual(LITHO_SEGMENTER_DEFAULTS)
  })

  it('falls back to default on malformed value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 'not a number' },
      }),
    ).toEqual(LITHO_SEGMENTER_DEFAULTS)
    expect(readLithoSegmenterPrefs({ litho_segmenter: 'not an object' })).toEqual(
      LITHO_SEGMENTER_DEFAULTS,
    )
  })
})

describe('buildLithoSegmenterPatch', () => {
  it('wraps prefs in the view_state key', () => {
    expect(buildLithoSegmenterPatch({ minimumLayerThicknessM: 0.3 })).toEqual({
      litho_segmenter: { minimum_layer_thickness_m: 0.3 },
    })
  })
})
