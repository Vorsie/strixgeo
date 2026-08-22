// Owner code-hunt finding, 2026-08-22: a null soilCode collapsed to the
// literal string '?', so two formations that both failed to carry a soil
// code welded together as "the same mass" whenever their NAD class also
// matched — even though neither is actually known to be the other's soil.
// The docstring's own invariant ("two unknowns are not known to be the same
// density, so they keep row identity") already covers this for a null
// nadClass; it has to cover a null soilCode too.

import { describe, expect, it } from 'vitest'

import { buildPackingClassOf } from './packingClassOf'

describe('buildPackingClassOf', () => {
  it('PC1 — two formations with a null soilCode never collapse onto the same key', () => {
    const map = buildPackingClassOf([
      ['form-a', { nadClass: 6, soilCode: null }],
      ['form-b', { nadClass: 6, soilCode: null }],
    ])
    // Neither carries an entry — both fall back to row identity downstream.
    expect(map.has('form-a')).toBe(false)
    expect(map.has('form-b')).toBe(false)
  })

  it('PC2 — a null nadClass still gets no entry (unchanged behaviour)', () => {
    const map = buildPackingClassOf([['form-a', { nadClass: null, soilCode: 'ZAND' }]])
    expect(map.has('form-a')).toBe(false)
  })

  it('PC3 — a formation with both fields known gets its SOIL|CLASS key', () => {
    const map = buildPackingClassOf([['form-a', { nadClass: 6, soilCode: 'ZAND' }]])
    expect(map.get('form-a')).toBe('ZAND|6')
  })

  it('PC4 — two same-soil same-class formations DO collapse onto one key', () => {
    const map = buildPackingClassOf([
      ['form-a', { nadClass: 6, soilCode: 'ZAND' }],
      ['form-b', { nadClass: 6, soilCode: 'ZAND' }],
    ])
    expect(map.get('form-a')).toBe(map.get('form-b'))
  })
})
