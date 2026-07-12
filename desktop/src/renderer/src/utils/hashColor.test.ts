import { describe, expect, it } from 'vitest'

import { hashHexColor } from './hashColor'

describe('hashHexColor', () => {
  it('returns a valid 6-digit #rrggbb string', () => {
    const c = hashHexColor('Boom Klei')
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is deterministic — same input always yields same colour', () => {
    expect(hashHexColor('Diest Zand')).toBe(hashHexColor('Diest Zand'))
  })

  it('returns different colours for sufficiently different strings', () => {
    // DJB2 is collision-prone at very high cardinality, but for
    // dozens-of-tokens cardinality we'd hit during a project we
    // expect distinct hues across realistic formation names.
    expect(hashHexColor('Boom Klei')).not.toBe(hashHexColor('Diest Zand'))
    expect(hashHexColor('Quartair')).not.toBe(hashHexColor('Pleistoceen'))
  })

  it('handles the empty string without crashing', () => {
    expect(hashHexColor('')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
