// The geotech Subdivide bridge: the toolbar publishes the gated press, the
// inspector reads availability + fires it imperatively (finding B, installer
// #40 — the stale-packing inspector line offers a "Subdivide" button).

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  publishGeotechSubdivideAction,
  runGeotechSubdivide,
  useGeotechSubdivideAvailable,
} from './geotechSubdivideActionStore'

beforeEach(() => {
  // Reset the module slot between tests.
  publishGeotechSubdivideAction({ available: false, press: () => {} })
})

describe('geotechSubdivideActionStore', () => {
  it('GSA1: availability is reactive and the published press fires', () => {
    const press = vi.fn()
    const { result } = renderHook(() => useGeotechSubdivideAvailable())
    expect(result.current).toBe(false)

    act(() => publishGeotechSubdivideAction({ available: true, press }))
    expect(result.current).toBe(true)

    runGeotechSubdivide('sec-1')
    expect(press).toHaveBeenCalledWith('sec-1')
  })

  it('GSA2: runGeotechSubdivide always calls the LATEST press', () => {
    const first = vi.fn()
    const second = vi.fn()
    publishGeotechSubdivideAction({ available: true, press: first })
    // A later toolbar render republishes a fresh press closure (same availability).
    publishGeotechSubdivideAction({ available: true, press: second })
    runGeotechSubdivide(null)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(null)
  })
})
