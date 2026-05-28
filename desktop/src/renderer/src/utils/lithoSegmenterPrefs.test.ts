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
          merge_same_lithology: false,
          litho_snap_tolerance_m: 0.30,
          straddle_min_piece_thickness_m: 0.40,
          auto_correlate_depth_window_m: 1.2,
        },
      }),
    ).toEqual({
      minimumLayerThicknessM: 0.5,
      gunsatKNm3: 18.0,
      drCompressionFactor: 0.6,
      mergeSameLithology: false,
      lithoSnapToleranceM: 0.30,
      straddleMinPieceThicknessM: 0.40,
      autoCorrelateDepthWindowM: 1.2,
    })
  })

  it('falls back to default on out-of-range value, field-independently', () => {
    // min_thickness too low → default; γunsat OK; Dr OK → only min_thickness resets
    // merge_same_lithology absent → defaults to true
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
      mergeSameLithology: true,
      lithoSnapToleranceM: LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM,
      straddleMinPieceThicknessM: LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM,
      autoCorrelateDepthWindowM: LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM,
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
        mergeSameLithology: true,
        lithoSnapToleranceM: 0.25,
        straddleMinPieceThicknessM: 0.35,
        autoCorrelateDepthWindowM: 0.8,
      }),
    ).toEqual({
      litho_segmenter: {
        minimum_layer_thickness_m: 0.3,
        gunsat_kNm3: 17.5,
        dr_compression_factor: 0.7,
        merge_same_lithology: true,
        litho_snap_tolerance_m: 0.25,
        straddle_min_piece_thickness_m: 0.35,
        auto_correlate_depth_window_m: 0.8,
      },
    })
  })
})

describe('readLithoSegmenterPrefs — lithoSnapToleranceM field', () => {
  it('defaults to 0.20 m when the litho_snap_tolerance_m key is absent', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.15 },
      }).lithoSnapToleranceM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM)
  })

  it('returns a valid stored value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { litho_snap_tolerance_m: 0.5 },
      }).lithoSnapToleranceM,
    ).toBe(0.5)
  })

  it('falls back to default when out of bounds (too low)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { litho_snap_tolerance_m: 0.005 },
      }).lithoSnapToleranceM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM)
  })

  it('falls back to default when out of bounds (too high)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { litho_snap_tolerance_m: 10.0 },
      }).lithoSnapToleranceM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM)
  })

  it('falls back to default for non-numeric type', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { litho_snap_tolerance_m: 'fifty cm' },
      }).lithoSnapToleranceM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.lithoSnapToleranceM)
  })
})

describe('readLithoSegmenterPrefs — straddleMinPieceThicknessM field', () => {
  it('defaults to 0.20 m when the straddle_min_piece_thickness_m key is absent', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.15 },
      }).straddleMinPieceThicknessM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM)
  })

  it('returns a valid stored value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { straddle_min_piece_thickness_m: 0.5 },
      }).straddleMinPieceThicknessM,
    ).toBe(0.5)
  })

  it('falls back to default when out of bounds (too low)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { straddle_min_piece_thickness_m: 0.005 },
      }).straddleMinPieceThicknessM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM)
  })

  it('falls back to default when out of bounds (too high)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { straddle_min_piece_thickness_m: 10.0 },
      }).straddleMinPieceThicknessM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM)
  })

  it('falls back to default for non-numeric type', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { straddle_min_piece_thickness_m: 'twenty cm' },
      }).straddleMinPieceThicknessM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM)
  })
})

describe('readLithoSegmenterPrefs — autoCorrelateDepthWindowM field (#163b)', () => {
  it('defaults to 0.5 m when the auto_correlate_depth_window_m key is absent', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.15 },
      }).autoCorrelateDepthWindowM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM)
  })

  it('returns a valid stored value', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { auto_correlate_depth_window_m: 1.5 },
      }).autoCorrelateDepthWindowM,
    ).toBe(1.5)
  })

  it('falls back to default when out of bounds (too low / too high)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { auto_correlate_depth_window_m: 0.01 },
      }).autoCorrelateDepthWindowM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM)
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { auto_correlate_depth_window_m: 10.0 },
      }).autoCorrelateDepthWindowM,
    ).toBe(LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM)
  })
})

describe('readLithoSegmenterPrefs — mergeSameLithology field', () => {
  it('defaults to true when merge_same_lithology key is absent', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { minimum_layer_thickness_m: 0.15, gunsat_kNm3: 16.0 },
      }).mergeSameLithology,
    ).toBe(true)
  })

  it('returns true when stored as true', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { merge_same_lithology: true },
      }).mergeSameLithology,
    ).toBe(true)
  })

  it('returns false when stored as false', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { merge_same_lithology: false },
      }).mergeSameLithology,
    ).toBe(false)
  })

  it('defaults to true when stored as a non-boolean (e.g. string)', () => {
    expect(
      readLithoSegmenterPrefs({
        litho_segmenter: { merge_same_lithology: 'yes' },
      }).mergeSameLithology,
    ).toBe(true)
  })
})
