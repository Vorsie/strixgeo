import { describe, expect, it } from 'vitest'

import {
  getCorrelationOverlayVisible,
  toggleCorrelationOverlay,
} from './correlationOverlayStore'

describe('correlationOverlayStore', () => {
  it('defaults to visible and flips on toggle', () => {
    // Default-shown so existing behaviour is unchanged on load.
    expect(getCorrelationOverlayVisible()).toBe(true)
    toggleCorrelationOverlay()
    expect(getCorrelationOverlayVisible()).toBe(false)
    toggleCorrelationOverlay()
    expect(getCorrelationOverlayVisible()).toBe(true)
  })
})
