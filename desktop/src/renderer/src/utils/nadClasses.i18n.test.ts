/**
 * Language pins for nadClasses.ts — the display helpers render Dutch under
 * ``'nl'`` while the LOGIC helpers (class-for-soil, foreign detection, family
 * order, the compact reverse-map) stay language-independent.
 *
 * These use the explicit ``language`` argument (never localStorage) so each pin
 * is deterministic and cannot leak a locale into a neighbouring test.
 *
 * The split matters because several sites use a soil-family word BOTH as a
 * display label and as a grouping / sorting / matching key. If translating the
 * display had silently moved the key, the geotech legend would sort wrong and
 * the hand-set menu would offer the wrong classes — the regression these pins
 * exist to catch.
 */

import { describe, expect, it } from 'vitest'

import {
  NAD_SOIL_FAMILY_ORDER,
  geotechUnitLabel,
  geotechUnitSoil,
  nadClassIsForeignToSoil,
  nadClassName,
  nadClassQualifier,
  nadClassesForSoil,
  nadCompactFromName,
  nadPackingLabel,
  nadSoilFamilyName,
} from './nadClasses'
import { NAD_CLASS_ABBR_NL, NAD_CLASS_NAMES_NL } from './nadClassesNl'

// ---- NL display -----------------------------------------------------------

describe('NL display — the backend Dutch source token is selected, not English', () => {
  it('I1 — nadClassName renders the canonical Dutch label under nl', () => {
    expect(nadClassName(6, 'nl')).toBe('ZAND, matig gepakt')
    expect(nadClassName(21, 'nl')).toBe('KLEI, weinig vast')
    expect(nadClassName(31, 'nl')).toBe('VEEN, vast')
  })

  it('I2 — nadClassName under en is unchanged (the export/canonical form)', () => {
    expect(nadClassName(6, 'en')).toBe('SAND, medium dense')
    expect(nadClassName(21, 'en')).toBe('CLAY, slightly firm')
  })

  it('I3 — null stays empty in every language (band overlay skips blanks)', () => {
    expect(nadClassName(null, 'nl')).toBe('')
    expect(nadClassName(null, 'en')).toBe('')
  })

  it('I4 — nadSoilFamilyName is the Dutch soil word under nl', () => {
    expect(nadSoilFamilyName(6, 'nl')).toBe('ZAND')
    expect(nadSoilFamilyName(21, 'nl')).toBe('KLEI')
    expect(nadSoilFamilyName(29, 'nl')).toBe('VEEN')
  })

  it('I5 — nadPackingLabel is the packing phrase without the soil word', () => {
    expect(nadPackingLabel(6, 'nl')).toBe('matig gepakt')
    expect(nadPackingLabel(10, 'nl')).toBe('silt-/kleihoudend, matig gepakt')
  })

  it('I6 — geotechUnitSoil agrees between a classified unit and its skeleton', () => {
    const classified = geotechUnitSoil({ nad_class: 6, litho_main_soil_code: 'ZAND' }, 'nl')
    const skeleton = geotechUnitSoil({ nad_class: null, litho_main_soil_code: 'ZAND' }, 'nl')
    // Both must be the SAME word or the two would land in different roster groups.
    expect(classified).toBe('ZAND')
    expect(skeleton).toBe('ZAND')
  })

  it('I7 — geotechUnitLabel: full Dutch name classified, soil + qualifier when not', () => {
    expect(geotechUnitLabel({ nad_class: 6, litho_main_soil_code: 'ZAND' }, null, 'nl')).toBe(
      'ZAND, matig gepakt',
    )
    expect(geotechUnitLabel({ nad_class: null, litho_main_soil_code: 'ZAND' }, null, 'nl')).toBe(
      'ZAND — nog niet ingedeeld',
    )
  })

  it('I8 — nadClassQualifier renders the Dutch unclassified wording for null', () => {
    expect(nadClassQualifier(null, 'nl')).toBe('nog niet ingedeeld')
    expect(nadClassQualifier(null, 'en')).toBe('not yet classified')
  })
})

// ---- compact reverse-map covers both languages ----------------------------

describe('nadCompactFromName resolves the band name in either language', () => {
  it('I9 — an nl full name round-trips to the nl compact form', () => {
    for (let i = 1; i <= 31; i++) {
      expect(nadCompactFromName(nadClassName(i, 'nl'))).toBe(NAD_CLASS_ABBR_NL[i])
    }
  })

  it('I10 — sanity: the nl compact keeps the Dutch soil prefix', () => {
    expect(nadCompactFromName(NAD_CLASS_NAMES_NL[6])).toBe('ZAND·MD')
    expect(nadCompactFromName(NAD_CLASS_NAMES_NL[21])).toBe('KLEI·SF')
  })
})

// ---- logic paths are language-independent (the load-bearing guards) -------

describe('logic helpers never depend on the interface language', () => {
  it('I11 — the family order stays English, the stable sort key', () => {
    // A grouped legend keys its family sort off this; it must not go Dutch.
    expect([...NAD_SOIL_FAMILY_ORDER]).toEqual(['GRAVEL', 'SAND', 'SILT', 'CLAY', 'PEAT'])
  })

  it('I12 — nadClassesForSoil answers the same class list whatever the language', () => {
    // nadClassesForSoil takes no language argument by design — the coupling is a
    // norm fact, not a presentation choice. Pinned here so nobody adds one.
    expect(nadClassesForSoil('ZAND')).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    expect(nadClassesForSoil('KLEI')).toEqual([21, 22, 23, 24, 25, 26, 27, 28])
  })

  it('I13 — foreign-class detection is stable across languages', () => {
    expect(nadClassIsForeignToSoil(14, 'ZAND')).toBe(true) // a SILT class on sand
    expect(nadClassIsForeignToSoil(6, 'ZAND')).toBe(false)
  })
})
