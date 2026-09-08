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
  geotechUnitColor,
  geotechUnitLabel,
  geotechUnitSoil,
  nadClassColor,
  nadClassName,
  nadClassIsForeignToSoil,
  nadClassQualifier,
  nadClassesForSoil,
  nadColoredFormations,
  nadCompactFromName,
  nadSoilFamilyName,
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

  it('UC4 — a colour the engineer picked survives the recolour', () => {
    // Owner ruling 2026-08-26: "Colours on the right hand pane need to be
    // choosable if user wants". The 3-D bodies are one of the places his pick
    // has to win, and this transform is the seam that feeds them.
    const out = nadColoredFormations([
      { id: 'f', nad_class: 6, color: '#c2b280', color_override: '#ff00ff' },
      { id: 'g', nad_class: 6, color: '#c2b280', color_override: null },
    ])

    expect(out[0].color).toBe('#ff00ff')
    expect(out[1].color).toBe(nadClassColor(6))
  })
})

// ---- geotechUnitColor — the one rule for "what colour is this unit" ---------

describe('geotechUnitColor', () => {
  it('UC1 — with nobody having chosen, the unit reads its NAD packing colour', () => {
    expect(geotechUnitColor({ nad_class: 6 })).toBe(nadClassColor(6))
    expect(geotechUnitColor({ nad_class: null, color_override: null })).toBe(nadClassColor(null))
  })

  it('UC2 — a colour the engineer picked wins over the automatic one', () => {
    expect(geotechUnitColor({ nad_class: 6, color_override: '#ff00ff' })).toBe('#ff00ff')
  })

  it('UC3 — picking exactly the automatic colour is still a choice', () => {
    // The reason the override is its own field rather than a comparison against
    // the computed default: he is allowed to pick the colour the rule would
    // have produced, and that decision has to outlive a change of class. Here
    // the unit is reclassified 6 → 8 and his colour does NOT move.
    const picked = nadClassColor(6)

    expect(geotechUnitColor({ nad_class: 6, color_override: picked })).toBe(picked)
    expect(geotechUnitColor({ nad_class: 8, color_override: picked })).toBe(picked)
    expect(geotechUnitColor({ nad_class: 8 })).toBe(nadClassColor(8))
  })

  // Owner ruling (installer #26, 2026-09-08): "is gravel grey in color, seems
  // too close to clay for me?". An unclassified gravel unit fell to the neutral
  // null grey, which is confusable with clay's blue-greys. Gravel is routinely
  // unclassifiable (CPTs refuse in gravel), so it should read as GRAVEL, not as
  // a missing-CPT exception — colour it by its lithology instead of grey.
  it('UC4 — an unclassified GRAVEL unit is NOT the null grey (it reads as gravel)', () => {
    const grey = nadClassColor(null)
    const gravel = geotechUnitColor({
      nad_class: null,
      color_override: null,
      litho_main_soil_code: 'GRIND',
    })
    // It is no longer the grey that clashes with clay…
    expect(gravel).not.toBe(grey)
    // …and it is a real hex colour, distinct from an unclassified clay unit,
    // which keeps the neutral grey.
    expect(gravel).toMatch(HEX_RE)
    const clay = geotechUnitColor({
      nad_class: null,
      color_override: null,
      litho_main_soil_code: 'KLEI',
    })
    expect(gravel).not.toBe(clay)
    expect(clay).toBe(grey)
  })

  it('UC5 — a colour the engineer picked still wins on an unclassified gravel unit', () => {
    expect(
      geotechUnitColor({
        nad_class: null,
        color_override: '#ff00ff',
        litho_main_soil_code: 'GRIND',
      }),
    ).toBe('#ff00ff')
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

// ---- vocabulary axis: sands are never firm, cohesives are never dense ------

describe('NAD vocabulary axis — each soil family takes ONE axis of words (V)', () => {
  // The owner's ruling, in his words (2026-08-26): "why are there suboptions
  // like this firm sand ...? Look at the NAD table moderately firm sand just
  // does not exist."
  //
  // In the NAD classification a GRANULAR soil is described by how densely it is
  // PACKED (Dutch "gepakt"/gp) and a COHESIVE soil by how FIRM it is (Dutch
  // "vast"). The two vocabularies never cross: there is no firm sand and no
  // dense clay in the table. These pins hold the English translation to that
  // rule, so the class of defect the owner caught can never come back through
  // a future re-wording of NAD_CLASS_NAMES.

  /** Families described by packing density — GRIND + ZAND (backend gp / gepakt). */
  const DENSITY_CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  /** Families described by firmness — SILT + KLEI + VEEN (backend "vast"). */
  const FIRMNESS_CLASSES = [
    13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ]

  /** The only density words the table may use (backend los/matig/dicht/zeer dicht gp). */
  const DENSITY_WORDS = ['loose', 'medium dense', 'dense', 'very dense']
  /** The only firmness words the table may use (backend weinig/matig/vrij vast, vast). */
  const FIRMNESS_WORDS = ['slightly firm', 'moderately firm', 'fairly firm', 'firm']

  /**
   * The packing phrase with any admixture field stripped — "silty/clayey,
   * medium dense" → "medium dense". The admixture is a separate axis and is
   * allowed on either family.
   */
  const packingWordOf = (n: number): string => {
    const parts = nadClassQualifier(n).split(', ')
    return parts[parts.length - 1]
  }

  it('V1 — every GRAVEL and SAND class is described by DENSITY, never firmness', () => {
    for (const n of DENSITY_CLASSES) {
      expect(DENSITY_WORDS, `NAD ${n} (${nadClassName(n)})`).toContain(packingWordOf(n))
      expect(nadClassName(n), `NAD ${n} must not call a granular soil firm`).not.toMatch(/firm/i)
    }
  })

  it('V2 — every SILT, CLAY and PEAT class is described by FIRMNESS, never density', () => {
    for (const n of FIRMNESS_CLASSES) {
      expect(FIRMNESS_WORDS, `NAD ${n} (${nadClassName(n)})`).toContain(packingWordOf(n))
      expect(nadClassName(n), `NAD ${n} must not call a cohesive soil dense/loose`).not.toMatch(
        /\b(dense|loose)\b/i,
      )
    }
  })

  it('V3 — the two axes cover all 31 classes exactly once (no class escapes the rule)', () => {
    expect([...DENSITY_CLASSES, ...FIRMNESS_CLASSES].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    )
  })
})

// ---- soil <-> class family coupling ----------------------------------------

describe('nadClassesForSoil â€” the picker asks the SOIL, never the current class', () => {
  // Owner ruling 2026-08-26: "no a zand body can never carry a silt packing
  // class" â€” "the nad coupling is absolute". The menu is built from the band's
  // LITHO soil, so a band that wrongly carries a foreign class can still be
  // corrected back to its own family. Keying off the current class is what
  // made a stranger band uncorrectable.

  const SOILS = ['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN']

  it('F1 â€” a sand unit offers the eight SAND classes and nothing else', () => {
    expect(nadClassesForSoil('ZAND')).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('F2 â€” every base lithology offers its own family, by the norm table', () => {
    expect(nadClassesForSoil('GRIND')).toEqual([1, 2, 3, 4])
    expect(nadClassesForSoil('SILT')).toEqual([13, 14, 15, 16, 17, 18, 19, 20])
    expect(nadClassesForSoil('KLEI')).toEqual([21, 22, 23, 24, 25, 26, 27, 28])
    expect(nadClassesForSoil('VEEN')).toEqual([29, 30, 31])
  })

  it('F3 â€” the classes a soil offers all name that soil back', () => {
    // Structural: the offer and the label are derived from the same table, so
    // this cannot pass while the menu offers a class of another family.
    for (const soil of SOILS) {
      const expected = geotechUnitSoil({ nad_class: null, litho_main_soil_code: soil })
      for (const cls of nadClassesForSoil(soil)) {
        expect(nadSoilFamilyName(cls)).toBe(expected)
      }
    }
  })

  it('F4 â€” the five families together are exactly the 31 classes, no gaps, no overlap', () => {
    const all = SOILS.flatMap(s => nadClassesForSoil(s))
    expect([...all].sort((a, b) => a - b)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
  })

  it('F5 â€” a soil the table does not know offers nothing, rather than guessing', () => {
    expect(nadClassesForSoil('SCHIST')).toEqual([])
    expect(nadClassesForSoil(null)).toEqual([])
    expect(nadClassesForSoil(undefined)).toEqual([])
    expect(nadClassesForSoil('')).toEqual([])
  })

  it('F6 â€” a sand band carrying a silt class is a stranger, and its own family still answers', () => {
    // The owner's case. The band reads NAD 14 today; asking the SOIL still
    // returns the sand classes, which is what lets the engineer heal it.
    expect(nadClassIsForeignToSoil(14, 'ZAND')).toBe(true)
    expect(nadClassesForSoil('ZAND')).toContain(6)
    expect(nadClassesForSoil('ZAND')).not.toContain(14)
  })

  it('F8 â€” STRUCTURAL: the class-keyed family helper stays deleted', async () => {
    // Mirrors the collision-law deletion pin: the mechanism is gone, and this
    // fails if anyone brings it back. `nadClassFamily(currentClass)` answered
    // "what else could this class have been", and building the hand-set menu
    // from it is what made a stranger band uncorrectable. Any future helper of
    // that shape has to answer to this test first.
    const mod: Record<string, unknown> = await import('./nadClasses')
    expect(Object.keys(mod)).not.toContain('nadClassFamily')
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(/^nadClassFamily/)
    }
  })

  it('F7 â€” an own-family class is not a stranger, and neither is an unclassified band', () => {
    expect(nadClassIsForeignToSoil(6, 'ZAND')).toBe(false)
    expect(nadClassIsForeignToSoil(null, 'ZAND')).toBe(false)
    // No soil to judge against means no verdict â€” never a false accusation.
    expect(nadClassIsForeignToSoil(14, null)).toBe(false)
    expect(nadClassIsForeignToSoil(14, 'SCHIST')).toBe(false)
  })
})
