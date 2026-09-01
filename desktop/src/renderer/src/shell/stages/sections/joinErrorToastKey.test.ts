import { describe, expect, it } from 'vitest'

import { ApiError } from '../../../api/clients/shared'
import { joinErrorToastKey } from './joinErrorToastKey'

/**
 * A failed body-Join must show a TRANSLATED toast, never the backend's English
 * ``detail.message`` verbatim (the owner dogfeeds in Dutch). These pins map the
 * structured guard ``code`` to a catalogue key.
 */
describe('joinErrorToastKey', () => {
  const err422 = (detail: Record<string, unknown>): ApiError =>
    new ApiError(typeof detail.message === 'string' ? detail.message : 'x', 422, { detail })

  it('D1a — cross-class with the SAME soil but a different packing class → the packing message', () => {
    // Owner ruling 2026-09-01: "same soil, different NAD packing class" must read
    // "You cannot merge two different packing classes." — picked off soil equality.
    const err = err422({
      code: 'body_union_cross_class',
      message: 'The two bodies are different masses and cannot be joined into one.',
      soil_a: 'ZAND',
      soil_b: 'ZAND',
      nad_class_a: 12,
      nad_class_b: 19,
    })
    expect(joinErrorToastKey(err)).toBe('sections.join.crossPacking')
    // The raw English backend prose must never be the toast text.
    expect(joinErrorToastKey(err)).not.toBe(err.message)
  })

  it('D1b — cross-class with DIFFERENT soils → the lithology message', () => {
    // Owner ruling 2026-09-01: "different soil" (SILT vs ZAND) must read
    // "You cannot merge two different lithologies."
    const err = err422({
      code: 'body_union_cross_class',
      message: 'The two bodies are different masses and cannot be joined into one.',
      soil_a: 'SILT',
      soil_b: 'ZAND',
    })
    expect(joinErrorToastKey(err)).toBe('sections.join.crossLitho')
  })

  it('maps a body_union_contradicts_separation 422 to the blockedSeparation key (defensive)', () => {
    const err = err422({
      code: 'body_union_contradicts_separation',
      message: 'These two bodies are held apart by a standing separation.',
    })
    expect(joinErrorToastKey(err)).toBe('sections.join.blockedSeparation')
  })

  it('falls back to the generic failed key for an unknown / structureless error', () => {
    expect(joinErrorToastKey(new Error('socket hang up'))).toBe('sections.join.failed')
    expect(joinErrorToastKey(new ApiError('x', 500, { detail: 'plain' }))).toBe(
      'sections.join.failed',
    )
    expect(joinErrorToastKey(new ApiError('x', 422, { detail: { code: 'something_else' } }))).toBe(
      'sections.join.failed',
    )
  })
})
