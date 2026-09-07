// Owner code-hunt finding, 2026-08-22: a null soilCode collapsed to the
// literal string '?', so two formations that both failed to carry a soil
// code welded together as "the same mass" whenever their NAD class also
// matched — even though neither is actually known to be the other's soil.
// The docstring's own invariant ("two unknowns are not known to be the same
// density, so they keep row identity") already covers this for a null
// nadClass; it has to cover a null soilCode too.

import { describe, expect, it } from 'vitest'

import { buildPackingClassOf, buildSeamClassOf } from './packingClassOf'

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

  it('PC5 — the FILL identity still MERGES two different-admixture same-class bands (only the seam splits them)', () => {
    // Decoupling: a plain ZAND-12 and a clay-bearing ZAND-12 keep ONE fill
    // identity (same colour, one mass — "one mass one body" preserved), so the
    // fix that draws their contact lives entirely in the SEAM identity below.
    const map = buildPackingClassOf([
      ['zand-12', { nadClass: 12, soilCode: 'ZAND' }],
      ['zand-kl-12', { nadClass: 12, soilCode: 'ZAND' }],
    ])
    expect(map.get('zand-12')).toBe(map.get('zand-kl-12'))
  })
})

describe('buildSeamClassOf', () => {
  it('SC1 — two touching geotech bands always show their contact when their composition differs', () => {
    // Owner ruling walk22b (GEO-61/2891-C, 28.06 m): a clean ZAND-12 sits
    // directly on a clay-bearing ZAND(KL)-12 with no contact drawn, because the
    // class-only identity collapses them. Same packing class, DIFFERENT soil
    // composition → the seam identity must differ so the contact is stroked.
    const map = buildSeamClassOf([
      ['zand-12', { nadClass: 12, soilCode: 'ZAND', admixtureCodes: [] }],
      ['zand-kl-12', { nadClass: 12, soilCode: 'ZAND', admixtureCodes: ['KL'] }],
    ])
    expect(map.get('zand-12')).not.toBe(map.get('zand-kl-12'))
  })

  it('SC2 — two bands of identical composition keep ONE seam identity (a welded mass shows no internal seam)', () => {
    // The B3/S9 SILT·SF weld (sectionFillIdentity docstring): same soil AND same
    // admixture under different litho parents stays one mass, no seam.
    const map = buildSeamClassOf([
      ['a', { nadClass: 14, soilCode: 'SILT', admixtureCodes: ['SF'] }],
      ['b', { nadClass: 14, soilCode: 'SILT', admixtureCodes: ['SF'] }],
    ])
    expect(map.get('a')).toBe(map.get('b'))
  })

  it('SC3 — admixture order and repeats do not change the seam identity', () => {
    const map = buildSeamClassOf([
      ['a', { nadClass: 12, soilCode: 'ZAND', admixtureCodes: ['KL', 'SF'] }],
      ['b', { nadClass: 12, soilCode: 'ZAND', admixtureCodes: ['SF', 'KL', 'KL'] }],
    ])
    expect(map.get('a')).toBe(map.get('b'))
  })

  it('SC4 — a formation missing its class or soil gets no entry (falls back to row id)', () => {
    const map = buildSeamClassOf([
      ['no-class', { nadClass: null, soilCode: 'ZAND', admixtureCodes: [] }],
      ['no-soil', { nadClass: 12, soilCode: null, admixtureCodes: [] }],
    ])
    expect(map.has('no-class')).toBe(false)
    expect(map.has('no-soil')).toBe(false)
  })
})
