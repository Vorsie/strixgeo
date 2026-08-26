/**
 * Tests for NAD class name + colour map utility (nadClasses.ts).
 *
 * Labels are the ENGLISH translations rendered in the UI (the backend holds the
 * canonical Dutch ``NAD_CLASSES``). The class NUMBER is the stable key; the
 * English text is presentation, refined in nadClasses.ts.
 */

import { describe, expect, it } from 'vitest'
import {
  NAD_CLASS_ABBR,
  NAD_CLASS_NAMES,
  geotechUnitLabel,
  geotechUnitSoil,
  nadClassColor,
  nadClassName,
  nadClassQualifier,
  nadColoredFormations,
  nadCompactFromName,
} from './nadClasses'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// ---- class name ------------------------------------------------------------

describe('nadClassName', () => {
  it('class 1 — "GRAVEL, medium dense"', () => {
    expect(nadClassName(1)).toBe('GRAVEL, medium dense')
  })

  it('class 6 — "SAND, medium dense"', () => {
    expect(nadClassName(6)).toBe('SAND, medium dense')
  })

  it('class 12 — "SAND, silty/clayey, very dense"', () => {
    expect(nadClassName(12)).toBe('SAND, silty/clayey, very dense')
  })

  it('class 13 — "SILT, slightly firm"', () => {
    expect(nadClassName(13)).toBe('SILT, slightly firm')
  })

  it('class 21 — "CLAY, slightly firm"', () => {
    expect(nadClassName(21)).toBe('CLAY, slightly firm')
  })

  it('class 31 — "PEAT, firm"', () => {
    expect(nadClassName(31)).toBe('PEAT, firm')
  })

  it('null returns empty string (degenerate — no CPTs for the lithology; no label renders)', () => {
    expect(nadClassName(null)).toBe('')
  })

  it('undefined returns empty string (same degenerate path as null)', () => {
    expect(nadClassName(undefined)).toBe('')
  })

  it('out-of-range class returns a safe fallback containing the number', () => {
    const result = nadClassName(99)
    expect(result).toContain('99')
  })
})

// ---- compact class-label table (geotech band label) -------------------------

describe('NAD_CLASS_ABBR', () => {
  it('every compact label is shorter than its full name (the whole point)', () => {
    for (let i = 1; i <= 31; i++) {
      expect(NAD_CLASS_ABBR[i].length).toBeLessThan(NAD_CLASS_NAMES[i].length)
    }
  })

  it('all 31 compact labels are distinct (sub-bands stay distinguishable)', () => {
    const labels = Array.from({ length: 31 }, (_, i) => NAD_CLASS_ABBR[i + 1])
    expect(new Set(labels).size).toBe(31)
  })
})

// ---- full name → compact translation (render-site helper) -------------------

describe('nadCompactFromName', () => {
  it('translates a known full NAD name to its compact form', () => {
    expect(nadCompactFromName('SAND, medium dense')).toBe('SAND·MD')
    expect(nadCompactFromName('CLAY, firm')).toBe('CLAY·F')
  })

  it('round-trips every NAD class: nadClassName → nadCompactFromName === NAD_CLASS_ABBR', () => {
    for (let i = 1; i <= 31; i++) {
      expect(nadCompactFromName(nadClassName(i))).toBe(NAD_CLASS_ABBR[i])
    }
  })

  it('returns an unknown name verbatim (e.g. the "ZAND (geotech)" unclassified fallback)', () => {
    expect(nadCompactFromName('ZAND (geotech)')).toBe('ZAND (geotech)')
    expect(nadCompactFromName('Diest Zand')).toBe('Diest Zand')
  })
})

// ---- NAD_CLASS_ABBR dictionary completeness ---------------------------------

describe('NAD_CLASS_ABBR', () => {
  it('covers all 31 classes with no extra keys', () => {
    const keys = Object.keys(NAD_CLASS_ABBR).map(Number)
    expect(keys.length).toBe(31)
    expect(keys.every((k) => k >= 1 && k <= 31)).toBe(true)
    for (let i = 1; i <= 31; i++) {
      expect(NAD_CLASS_ABBR[i]).toBeTruthy()
    }
  })
})

// ---- class colour ----------------------------------------------------------

describe('nadClassColor', () => {
  it('class 6 returns a valid hex colour', () => {
    expect(nadClassColor(6)).toMatch(HEX_RE)
  })

  it('class 1 returns a valid hex colour', () => {
    expect(nadClassColor(1)).toMatch(HEX_RE)
  })

  it('class 31 returns a valid hex colour', () => {
    expect(nadClassColor(31)).toMatch(HEX_RE)
  })

  it('null returns a valid neutral hex colour (not amber)', () => {
    const c = nadClassColor(null)
    expect(c).toMatch(HEX_RE)
    // amber family is reserved for unsaved-state markers (#fbbf24 / #f59e0b etc.)
    expect(c.toLowerCase()).not.toMatch(/^#f[5b][9b][e1]/)
  })

  it('undefined returns the same neutral colour as null', () => {
    expect(nadClassColor(undefined)).toBe(nadClassColor(null))
  })

  it('all 31 classes return valid hex colours', () => {
    for (let i = 1; i <= 31; i++) {
      expect(nadClassColor(i)).toMatch(HEX_RE)
    }
  })
})

// ---- nadColoredFormations (3D viewer presentation-boundary transform) -------

describe('nadColoredFormations', () => {
  it('replaces each formation colour with its NAD-class colour, leaving other fields intact', () => {
    const formations = [
      { id: 'f-sand', nad_class: 6, color: '#fbbf24', name: 'ZAND (NAD 6)' },
      { id: 'f-clay', nad_class: 22, color: '#aabbcc', name: 'KLEI (NAD 22)' },
    ]
    const out = nadColoredFormations(formations)
    // colour becomes the NAD-class colour (NOT the stored lithology colour)…
    expect(out[0].color).toBe(nadClassColor(6))
    expect(out[1].color).toBe(nadClassColor(22))
    // …every other field is carried through verbatim.
    expect(out[0].id).toBe('f-sand')
    expect(out[0].name).toBe('ZAND (NAD 6)')
    expect(out[1].id).toBe('f-clay')
  })

  it('uses the neutral fallback colour for a null nad_class (degenerate, no qc)', () => {
    const out = nadColoredFormations([{ id: 'f', nad_class: null, color: '#123456' }])
    expect(out[0].color).toBe(nadClassColor(null))
  })

  it('does not mutate the input formations', () => {
    const formations = [{ id: 'f', nad_class: 7, color: '#000000' }]
    const out = nadColoredFormations(formations)
    expect(formations[0].color).toBe('#000000') // original untouched
    expect(out[0]).not.toBe(formations[0]) // a fresh copy is returned
  })

  it('returns an empty array for empty input', () => {
    expect(nadColoredFormations([])).toEqual([])
  })
})

// ---- NAD_CLASS_NAMES dictionary completeness --------------------------------

describe('NAD_CLASS_NAMES', () => {
  it('covers all 31 classes', () => {
    for (let i = 1; i <= 31; i++) {
      expect(NAD_CLASS_NAMES[i]).toBeTruthy()
    }
  })

  it('has no extra keys outside 1–31', () => {
    const keys = Object.keys(NAD_CLASS_NAMES).map(Number)
    expect(keys.every((k) => k >= 1 && k <= 31)).toBe(true)
    expect(keys.length).toBe(31)
  })
})

// ---- the unclassified-unit label -------------------------------------------
//
// The owner pasted his "Geotech units" pane and two of its rows were literally
// just the character "0" — no name, no swatch meaning, nothing to act on. Those
// rows are geotech units the materialiser created without a packing class
// (nad_class stays null when no cone reached the soil). The pane asked
// nadClassName for their label and got "" back.
//
// The rule these pins encode: a unit with no packing class still has to SAY
// WHICH GROUND IT IS. It is about to become the unclassified-ground ledger —
// the row an engineer clicks to find the hole in his model — so a blank is the
// one thing it must never be.

/** Skeleton geotech unit shorthand for the label tests. */
function unit(
  overrides: Partial<{
    nad_class: number | null
    litho_main_soil_code: string | null
    name: string
  }> = {},
): { nad_class: number | null; litho_main_soil_code: string | null; name: string } {
  return {
    nad_class: null,
    litho_main_soil_code: 'ZAND',
    name: 'ZAND (geotech)',
    ...overrides,
  }
}

describe('geotechUnitLabel — an unclassified unit is never blank (L)', () => {
  it('L1 — a unit with no packing class does not render as the empty string', () => {
    // The bare "0" row from the owner's paste.
    expect(geotechUnitLabel(unit())).not.toBe('')
  })

  it('L2 — it names the ground it is, and says the class is still missing', () => {
    expect(geotechUnitLabel(unit())).toBe('SAND — not yet classified')
  })

  it('L2b — the soil word comes from the unit own lithology, not from sand always', () => {
    expect(geotechUnitLabel(unit({ litho_main_soil_code: 'KLEI' }))).toBe(
      'CLAY — not yet classified',
    )
    expect(geotechUnitLabel(unit({ litho_main_soil_code: 'VEEN' }))).toBe(
      'PEAT — not yet classified',
    )
  })

  it('L3 — a classified unit keeps the packing-class name it already had', () => {
    expect(geotechUnitLabel(unit({ nad_class: 6 }))).toBe('SAND, medium dense')
    expect(geotechUnitLabel(unit({ nad_class: 21, litho_main_soil_code: 'KLEI' }))).toBe(
      'CLAY, slightly firm',
    )
  })

  it('L4 — same-soil unclassified units are told apart by their source litho unit', () => {
    // Five identical "KLEI (geotech)" skeletons exist on the owner project, each
    // born from a DIFFERENT litho formation. Without the source name on the row
    // they read as five copies of one thing.
    expect(geotechUnitLabel(unit({ litho_main_soil_code: 'KLEI' }), 'CLAY | sandy')).toBe(
      'CLAY — not yet classified (CLAY | sandy)',
    )
  })

  it('L5 — with nothing to disambiguate against, no parenthetical is added', () => {
    expect(geotechUnitLabel(unit(), null)).toBe('SAND — not yet classified')
    expect(geotechUnitLabel(unit(), undefined)).toBe('SAND — not yet classified')
  })

  it('L6 — a unit with neither class nor soil code still names itself, never blank', () => {
    const nameless = unit({ litho_main_soil_code: null, name: 'Odd unit' })
    expect(geotechUnitLabel(nameless)).toBe('Odd unit — not yet classified')
  })

  it('L7 — nadClassName keeps returning "" for null (the band overlay skips blanks)', () => {
    // Deliberate: the partition-fill overlay draws no label for an empty
    // string. geotechUnitLabel is the ROSTER formatter and is the only one
    // that must speak; the raw table lookup stays raw.
    expect(nadClassName(null)).toBe('')
  })
})

describe('geotechUnitSoil — one soil word per unit, classified or not (L)', () => {
  it('L8 — a classified unit and a skeleton of the same ground answer the same word', () => {
    expect(geotechUnitSoil(unit({ nad_class: 6 }))).toBe('SAND')
    expect(geotechUnitSoil(unit({ nad_class: null }))).toBe('SAND')
  })

  it('L9 — every one of the 31 classes answers one of the five soil families', () => {
    const families = new Set<string>()
    for (let n = 1; n <= 31; n++) {
      families.add(geotechUnitSoil(unit({ nad_class: n, litho_main_soil_code: null })))
    }
    expect([...families].sort()).toEqual(['CLAY', 'GRAVEL', 'PEAT', 'SAND', 'SILT'])
  })
})

describe('nadClassQualifier — the class row says firmness, never the soil again (L)', () => {
  it('L10 — the class row under SAND reads "medium dense", not "SAND, medium dense"', () => {
    expect(nadClassQualifier(6)).toBe('medium dense')
  })

  it('L11 — an admixture variant keeps its variant, still without the soil', () => {
    expect(nadClassQualifier(10)).toBe('silty/clayey, medium dense')
    expect(nadClassQualifier(25)).toBe('sandy, slightly firm')
  })

  it('L12 — no class yet reads "not yet classified" (the soil sits in the group header)', () => {
    expect(nadClassQualifier(null)).toBe('not yet classified')
  })

  it('L13 — soil + qualifier reconstructs the full name for all 31 classes', () => {
    // Structural pin on the split: the qualifier is DERIVED from
    // NAD_CLASS_NAMES rather than kept in a second 31-entry table, so this is
    // what proves the derivation never loses or duplicates a word.
    for (let n = 1; n <= 31; n++) {
      const f = unit({ nad_class: n, litho_main_soil_code: null })
      expect(`${geotechUnitSoil(f)}, ${nadClassQualifier(n)}`).toBe(NAD_CLASS_NAMES[n])
    }
  })

  it('L14 — no qualifier is empty, and none starts with its own soil word', () => {
    for (let n = 1; n <= 31; n++) {
      const q = nadClassQualifier(n)
      expect(q.length).toBeGreaterThan(0)
      expect(q.startsWith(geotechUnitSoil(unit({ nad_class: n, litho_main_soil_code: null })))).toBe(
        false,
      )
    }
  })
})
