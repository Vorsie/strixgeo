// Unit tests for sampleGeotechScreenPos — pure mapping helper.
//
// SP1 — happy path: sample + elevation → correct mid-depth elevation → correct screen pos
// SP2 — null elevation returns null (no screen position)
// SP3 — warpedXToScreen is called with the column's along value (not a raw nudgedX)
// SP4 — mid-depth is exactly halfway between top and base

import { describe, expect, it, vi } from 'vitest'
import { sampleGeotechScreenPos } from './sampleGeotechScreenPos'

// Fixed transforms for deterministic assertions.
// warpedXToScreen: doubles the along value (simple linear scaling)
// levelToScreen: negates the level (elevation increases downward in this mock)
const warpedXToScreen = (along: number): number => along * 2
const levelToScreen = (level: number): number => -level

describe('sampleGeotechScreenPos', () => {
  it('SP1 — maps sample mid-depth to the correct screen position', () => {
    // Column at along=50 m, elevation=5 mTAW.
    // Sample from 2 m to 4 m depth → mid = 3 m → elevation = 5 - 3 = 2 mTAW.
    // Expected: x = 50 * 2 = 100, y = -2
    const result = sampleGeotechScreenPos(
      { depth_top_m: 2, depth_base_m: 4 },
      { along: 50, elevationM: 5 },
      warpedXToScreen,
      levelToScreen,
    )

    expect(result).toEqual({ x: 100, y: -2 })
  })

  it('SP2 — returns null when the borehole elevation is unknown', () => {
    const result = sampleGeotechScreenPos(
      { depth_top_m: 1, depth_base_m: 3 },
      { along: 20, elevationM: null },
      warpedXToScreen,
      levelToScreen,
    )

    expect(result).toBeNull()
  })

  it('SP3 — calls warpedXToScreen with the column along value (not a raw x)', () => {
    // Use a spy to verify the exact argument passed to warpedXToScreen.
    const spy = vi.fn((along: number) => along * 3)

    sampleGeotechScreenPos(
      { depth_top_m: 0, depth_base_m: 2 },
      { along: 77, elevationM: 10 },
      spy,
      levelToScreen,
    )

    expect(spy).toHaveBeenCalledWith(77)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('SP4 — mid-depth is exactly (top + base) / 2', () => {
    // depth_top = 0, depth_base = 10 → mid = 5
    // elevation = 20 → level = 20 - 5 = 15 → levelToScreen(15) = -15
    const result = sampleGeotechScreenPos(
      { depth_top_m: 0, depth_base_m: 10 },
      { along: 0, elevationM: 20 },
      warpedXToScreen,
      levelToScreen,
    )

    expect(result).not.toBeNull()
    expect(result!.y).toBe(-15)
  })

  it('SP5 — zero-thickness sample at top=base uses that depth as mid', () => {
    // top = base = 3 → mid = 3 → elevation = 10 - 3 = 7 → y = -7
    const result = sampleGeotechScreenPos(
      { depth_top_m: 3, depth_base_m: 3 },
      { along: 0, elevationM: 10 },
      warpedXToScreen,
      levelToScreen,
    )

    expect(result).not.toBeNull()
    expect(result!.y).toBe(-7)
  })
})
