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

  // Owner ruling 2026-08-26: the gradient snap is ON for a project that never
  // chose. Asserted on the VALUE, not against GEOTECH_SUBDIVISION_DEFAULTS —
  // comparing the read to the defaults object passes whichever way the default
  // points, so it cannot hold a ruling about which way that is.
  it('snaps a boundary to the sharp qc break when the project never chose', () => {
    expect(GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapEnabled).toBe(true)
    expect(readGeotechSubdivisionPrefs(null).gradientSnapEnabled).toBe(true)
    expect(
      readGeotechSubdivisionPrefs({ geotech_subdivision: { minimum_layer_thickness_m: 0.5 } })
        .gradientSnapEnabled,
    ).toBe(true)
  })

  it('keeps the snap off for a project that turned it off', () => {
    // A default applies in the absence of a choice; it never overwrites one.
    expect(
      readGeotechSubdivisionPrefs({ geotech_subdivision: { gradient_snap_enabled: false } })
        .gradientSnapEnabled,
    ).toBe(false)
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
      lithoSnapToleranceM: 0.45,
    }
    expect(readGeotechSubdivisionPrefs(buildGeotechSubdivisionPatch(prefs))).toEqual(prefs)
  })

  it('keeps a snap tolerance the backend set but no UI edits', () => {
    // litho_snap_tolerance_m is written into this bag by nothing on the client,
    // and the patch REPLACES the whole bag — so a value the planner is using
    // has to survive a save of the sibling prefs, or the next settings change
    // silently re-tunes the geotech divide.
    const stored = { geotech_subdivision: { litho_snap_tolerance_m: 0.75 } }
    const prefs = readGeotechSubdivisionPrefs(stored)
    expect(prefs.lithoSnapToleranceM).toBe(0.75)
    expect(
      readGeotechSubdivisionPrefs(buildGeotechSubdivisionPatch(prefs)).lithoSnapToleranceM,
    ).toBe(0.75)
  })
})
