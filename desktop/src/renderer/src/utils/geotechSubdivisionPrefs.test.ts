import { describe, expect, it } from 'vitest'
import {
  GEOTECH_SUBDIVISION_DEFAULTS,
  buildGeotechSubdivisionPatch,
  readGeotechSubdivisionPrefs,
} from './geotechSubdivisionPrefs'

describe('geotechSubdivisionPrefs', () => {
  it('returns defaults for missing view_state', () => {
    expect(readGeotechSubdivisionPrefs(null)).toEqual(GEOTECH_SUBDIVISION_DEFAULTS)
  })

  it('reads persisted values', () => {
    const vs = {
      geotech_subdivision: {
        minimum_layer_thickness_m: 0.5,
        gradient_snap_enabled: false,
        gradient_snap_window_m: 0.8,
      },
    }
    const p = readGeotechSubdivisionPrefs(vs)
    expect(p.minimumLayerThicknessM).toBe(0.5)
    expect(p.gradientSnapEnabled).toBe(false)
    expect(p.gradientSnapWindowM).toBe(0.8)
  })

  it('clamps out-of-range thickness to default', () => {
    const vs = { geotech_subdivision: { minimum_layer_thickness_m: 99 } }
    expect(readGeotechSubdivisionPrefs(vs).minimumLayerThicknessM).toBe(
      GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
    )
  })

  it('round-trips through the patch builder', () => {
    const prefs = {
      minimumLayerThicknessM: 0.4,
      gradientSnapEnabled: false,
      gradientSnapWindowM: 0.3,
    }
    expect(readGeotechSubdivisionPrefs(buildGeotechSubdivisionPatch(prefs))).toEqual(prefs)
  })
})
