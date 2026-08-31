// Behavioral net for the Geotech-units tree builder.
//
// The owner pasted his "Geotech units" pane on 2026-08-26: ~94 flat rows, most
// of them repeating the same soil, several reading "SILT, slightly firm  0",
// and two that were literally just "0". His words on the proposed shape were
// "those ideas look like an improvement". The shape he approved
// (blend_viewer/geotech_ui_tidy_ideas.html, panel 2):
//
//   • soil header ▸ one row per NAD class underneath it
//   • the class row is labelled by FIRMNESS/DENSITY, never the soil again
//   • bands SUMMED per class across the unit instances that carry it
//   • provenance collapsed to the WORST badge in the group — "partial · low
//     bubbles up, that is the one you need to see"
//   • instances only when a class has more than one
//   • zero-content rows are not listed at all — the "show empty (N)" lever that
//     shipped with the tree was overturned the same day: "if a bin is empty
//     that means there is nothing in it and nothing exists"
//
// These pins are on the pure builder. What the component does with the tree is
// pinned in GeotechnicalInspector.test.tsx.

import { describe, expect, it } from 'vitest'

import { nadClassColor } from '../../../utils/nadClasses'
import { buildGeotechUnitTree } from './geotechUnitTree'
import type { GeotechUnitTreeInput } from './geotechUnitTree'

// ---------------------------------------------------------------------------
// Scene builders
// ---------------------------------------------------------------------------

let _seq = 0

/** One geotech unit (a formation row) for the scene. */
function unit(
  id: string,
  nadClass: number | null,
  overrides: Partial<{
    litho_main_soil_code: string | null
    name: string
    display_order: number
    color_override: string | null
  }> = {},
): GeotechUnitTreeInput['units'][number] {
  return {
    id,
    nad_class: nadClass,
    litho_main_soil_code: 'ZAND',
    name: `${id} (geotech)`,
    display_order: 0,
    source_litho_formation_id: `src-${id}`,
    ...overrides,
  }
}

/** ``n`` accepted bands for a unit — what the roster counts. */
function bands(formationId: string, n: number): GeotechUnitTreeInput['contacts'] {
  return Array.from({ length: n }, () => ({ formation_id: formationId }))
}

/** ``n`` layers of one confidence for a unit — what the provenance badge reads. */
function layers(
  formationId: string,
  confidence: 'low' | 'medium' | 'high',
  n = 1,
): GeotechUnitTreeInput['layers'] {
  return Array.from({ length: n }, () => {
    _seq += 1
    return { formation_id: formationId, confidence }
  })
}

/** Build a tree from a scene, defaulting the parts a test does not care about. */
function tree(input: Partial<GeotechUnitTreeInput> & Pick<GeotechUnitTreeInput, 'units'>) {
  return buildGeotechUnitTree({
    contacts: [],
    layers: [],
    ...input,
  })
}

// ---------------------------------------------------------------------------
// T1 — grouping
// ---------------------------------------------------------------------------

describe('the pane groups by soil, not one flat row per unit (T1)', () => {
  it('T1a — four sand units of different classes sit under ONE sand header', () => {
    const t = tree({
      units: [unit('a', 5), unit('b', 6), unit('c', 7), unit('d', 8)],
      contacts: [...bands('a', 1), ...bands('b', 1), ...bands('c', 1), ...bands('d', 1)],
    })

    expect(t.groups.map(g => g.soil)).toEqual(['SAND'])
    expect(t.groups[0].classes).toHaveLength(4)
  })

  it('T1b — different soils are different headers', () => {
    const t = tree({
      units: [
        unit('s', 6),
        unit('k', 21, { litho_main_soil_code: 'KLEI' }),
        unit('v', 29, { litho_main_soil_code: 'VEEN' }),
      ],
      contacts: [...bands('s', 1), ...bands('k', 1), ...bands('v', 1)],
    })

    expect(t.groups.map(g => g.soil).sort()).toEqual(['CLAY', 'PEAT', 'SAND'])
  })

  it('T1c — an unclassified unit groups under the soil it inherited, beside its classified siblings', () => {
    // The skeleton is the same ground as the classified sand next to it; a
    // separate "unknown" bucket would hide that.
    const t = tree({
      units: [unit('classified', 6), unit('skeleton', null)],
      contacts: [...bands('classified', 1), ...bands('skeleton', 1)],
    })

    expect(t.groups).toHaveLength(1)
    expect(t.groups[0].soil).toBe('SAND')
    expect(t.groups[0].classes.map(c => c.nadClass)).toEqual([6, null])
  })
})

// ---------------------------------------------------------------------------
// T2 — summed counts
// ---------------------------------------------------------------------------

describe('bands are summed per class, and per soil (T2)', () => {
  it('T2a — three units that are all "SAND, medium dense" report one row with their bands added up', () => {
    const t = tree({
      units: [unit('i1', 6), unit('i2', 6), unit('i3', 6)],
      contacts: [...bands('i1', 20), ...bands('i2', 5), ...bands('i3', 6)],
    })

    const classRows = t.groups[0].classes
    expect(classRows).toHaveLength(1)
    expect(classRows[0].bandCount).toBe(31)
  })

  it('T2b — the soil header carries the total across its classes', () => {
    const t = tree({
      units: [unit('a', 13, { litho_main_soil_code: 'SILT' }), unit('b', 14, { litho_main_soil_code: 'SILT' })],
      contacts: [...bands('a', 56), ...bands('b', 31)],
    })

    expect(t.groups[0].bandCount).toBe(87)
  })

  it('T2c — a band belonging to no unit on the roster is not counted anywhere', () => {
    const t = tree({
      units: [unit('a', 6)],
      contacts: [...bands('a', 3), ...bands('ghost-unit', 99)],
    })

    expect(t.groups[0].bandCount).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// T3 — worst badge bubbles up
// ---------------------------------------------------------------------------

describe('the class row shows the WORST badge in its group (T3)', () => {
  it('T3a — one partial instance among clean CPT ones makes the class row read partial', () => {
    // Owner: "partial/low bubbles up — that is the one you need to see."
    const t = tree({
      units: [unit('clean', 6), unit('mixed', 6)],
      contacts: [...bands('clean', 10), ...bands('mixed', 10)],
      layers: [...layers('clean', 'high', 3), ...layers('mixed', 'high'), ...layers('mixed', 'low')],
    })

    expect(t.groups[0].classes[0].provenance).toBe('partial')
  })

  it('T3b — an instance with no cone at all outranks a merely partial one', () => {
    const t = tree({
      units: [unit('partial', 6), unit('nocone', 6)],
      contacts: [...bands('partial', 5), ...bands('nocone', 5)],
      layers: [
        ...layers('partial', 'high'),
        ...layers('partial', 'low'),
        ...layers('nocone', 'low', 2),
      ],
    })

    expect(t.groups[0].classes[0].provenance).toBe('none')
  })

  it('T3c — all instances clean keeps the class row clean', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', 6)],
      contacts: [...bands('a', 5), ...bands('b', 5)],
      layers: [...layers('a', 'high', 2), ...layers('b', 'medium', 2)],
    })

    expect(t.groups[0].classes[0].provenance).toBe('cpt')
  })

  it('T3d — confidence bubbles the same way: one low instance makes the class row low', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', 6)],
      contacts: [...bands('a', 5), ...bands('b', 5)],
      layers: [...layers('a', 'high', 2), ...layers('b', 'low')],
    })

    expect(t.groups[0].classes[0].confidence).toBe('low')
  })

  it('T3e — medium beats high, and an instance with no layers does not drag the row down', () => {
    const t = tree({
      units: [unit('a', 6), unit('none', 6)],
      contacts: [...bands('a', 5), ...bands('none', 5)],
      layers: [...layers('a', 'medium')],
    })

    expect(t.groups[0].classes[0].confidence).toBe('medium')
  })

  it('T3f — a class where no instance has any layer reports no confidence at all', () => {
    const t = tree({ units: [unit('a', 6)], contacts: bands('a', 5), layers: [] })
    expect(t.groups[0].classes[0].confidence).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T4 — instances only when the class has more than one
// ---------------------------------------------------------------------------

describe('instances stay collapsed until a class actually has several (T4)', () => {
  it('T4a — a class carried by one unit reports a single instance (nothing to expand into)', () => {
    const t = tree({ units: [unit('only', 6)], contacts: bands('only', 4) })

    const row = t.groups[0].classes[0]
    expect(row.instances).toHaveLength(1)
    expect(row.instances[0].formationId).toBe('only')
  })

  it('T4b — a class carried by three units reports all three, each with its own band count', () => {
    const t = tree({
      units: [unit('i1', 6), unit('i2', 6), unit('i3', 6)],
      contacts: [...bands('i1', 20), ...bands('i2', 5), ...bands('i3', 6)],
    })

    const row = t.groups[0].classes[0]
    expect(row.instances.map(i => i.bandCount)).toEqual([20, 5, 6])
  })

  it('T4c — each instance keeps its OWN badge, so expanding shows which one is weak', () => {
    const t = tree({
      units: [unit('clean', 6), unit('weak', 6)],
      contacts: [...bands('clean', 5), ...bands('weak', 5)],
      layers: [...layers('clean', 'high', 2), ...layers('weak', 'low', 2)],
    })

    const row = t.groups[0].classes[0]
    expect(row.instances.map(i => i.provenance)).toEqual(['cpt', 'none'])
  })
})

// ---------------------------------------------------------------------------
// T5 — a bin with nothing in it is not a row
//
// Owner ruling, dogfeed 2026-08-26: "The show empty is weird though, if a bin
// is empty that means there is nothing in it and nothing exists". RETIRES T5b
// ("turning the toggle on brings it back") and the second half of T5c ("comes
// back with the toggle") — both pinned a lever that no longer exists — and
// drops the ``emptyCount`` assertions from T5a/T5d/T5e/T5f, which existed only
// to feed that lever's label. What each test claims about the FILTER is kept
// verbatim: the filter is unchanged, only the escape hatch is gone.
// ---------------------------------------------------------------------------

describe('a unit that describes nothing is not on the roster at all (T5)', () => {
  it('T5a — a unit with no bands is not in the tree', () => {
    const t = tree({
      units: [unit('live', 6), unit('empty', 7)],
      contacts: bands('live', 12),
    })

    expect(t.groups[0].classes.map(c => c.nadClass)).toEqual([6])
  })

  it('T5c — a soil whose every unit is empty loses its header too', () => {
    const t = tree({
      units: [unit('s', 6), unit('k', 21, { litho_main_soil_code: 'KLEI' })],
      contacts: bands('s', 3),
    })

    expect(t.groups.map(g => g.soil)).toEqual(['SAND'])
  })

  it('T5d — an UNCLASSIFIED unit that HAS bands stays in the tree', () => {
    // It is real ground the model has not classified — exactly the row the
    // engineer needs in front of him. Only "no content" drops a row; "no
    // class" is what the row is FOR.
    const t = tree({
      units: [unit('skeleton', null)],
      contacts: bands('skeleton', 9),
    })

    expect(t.unitCount).toBe(1)
    expect(t.groups[0].classes[0].nadClass).toBeNull()
    expect(t.groups[0].classes[0].bandCount).toBe(9)
  })

  it('T5f — a unit with layers but no ACCEPTED band is not empty either', () => {
    // "Empty" has to mean the same thing here as it does to the backend sweep
    // (no layer, no contact, no body). A unit whose bands are still pending
    // describes something; dropping it would hide a live unit the next verb
    // correctly leaves alone.
    const t = tree({
      units: [unit('pending', 6)],
      contacts: [],
      layers: layers('pending', 'high', 2),
    })

    expect(t.unitCount).toBe(1)
    expect(t.groups[0].classes[0].bandCount).toBe(0)
  })

  it('T5e — the header counts describe exactly the rows the pane shows', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', 7), unit('c', 8), unit('d', 5)],
      contacts: [...bands('a', 2), ...bands('b', 3)],
    })

    expect(t.unitCount).toBe(2)
    expect(t.bandCount).toBe(5)
    expect(t.groups.flatMap(g => g.classes).map(c => c.nadClass)).toEqual([6, 7])
  })
})

// ---------------------------------------------------------------------------
// T9 — the colour the engineer picked
//
// Owner ruling, dogfeed 2026-08-26: "Colours on the right hand pane need to be
// choosable if user wants." The swatch on this pane is on a CLASS row, which
// can stand for several units, so the row has to answer two questions: what
// colour to draw, and whether a pick is in force (that is what the row's
// reset-to-automatic affordance appears for).
// ---------------------------------------------------------------------------

describe('a picked colour wins over the automatic NAD colour (T9)', () => {
  it('T9a — the row draws the colour its unit was given', () => {
    const t = tree({
      units: [unit('a', 6, { color_override: '#ff00ff' })],
      contacts: bands('a', 3),
    })

    expect(t.groups[0].classes[0].color).toBe('#ff00ff')
    expect(t.groups[0].classes[0].colorOverride).toBe('#ff00ff')
  })

  it('T9b — with nobody having picked, the row draws its NAD colour and offers no reset', () => {
    const t = tree({ units: [unit('a', 6)], contacts: bands('a', 3) })

    expect(t.groups[0].classes[0].color).toBe(nadClassColor(6))
    expect(t.groups[0].classes[0].colorOverride).toBeNull()
  })

  it('T9c — a row standing for several units that agree draws the agreed colour', () => {
    const t = tree({
      units: [
        unit('a', 6, { color_override: '#ff00ff' }),
        unit('b', 6, { color_override: '#ff00ff', display_order: 1 }),
      ],
      contacts: [...bands('a', 1), ...bands('b', 1)],
    })

    expect(t.groups[0].classes[0].color).toBe('#ff00ff')
    expect(t.groups[0].classes[0].colorOverride).toBe('#ff00ff')
  })

  it('T9d — a row whose units DISAGREE falls back to the automatic colour', () => {
    // One row cannot honestly show two colours. Editing the row always writes
    // every unit under it, so disagreement only arises from outside — and the
    // automatic colour is the answer that misrepresents neither unit.
    const t = tree({
      units: [
        unit('a', 6, { color_override: '#ff00ff' }),
        unit('b', 6, { color_override: '#00ff00', display_order: 1 }),
      ],
      contacts: [...bands('a', 1), ...bands('b', 1)],
    })

    expect(t.groups[0].classes[0].color).toBe(nadClassColor(6))
    expect(t.groups[0].classes[0].colorOverride).toBeNull()
  })

  it('T9e — the row names every unit an edit has to write to', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', 6, { display_order: 1 })],
      contacts: [...bands('a', 1), ...bands('b', 1)],
    })

    expect(t.groups[0].classes[0].instances.map(i => i.formationId)).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// T6 — labels
// ---------------------------------------------------------------------------

describe('every row says what it is (T6)', () => {
  it('T6a — the class row is the firmness word, never the soil repeated', () => {
    const t = tree({ units: [unit('a', 6)], contacts: bands('a', 1) })
    expect(t.groups[0].classes[0].label).toBe('medium dense')
  })

  it('T6b — the unclassified class row says so instead of rendering blank', () => {
    // The bare "0" rows in the owner paste.
    const t = tree({ units: [unit('a', null)], contacts: bands('a', 1) })
    expect(t.groups[0].classes[0].label).toBe('not yet classified')
    expect(t.groups[0].classes[0].label).not.toBe('')
  })

  it('T6c — two same-soil unclassified units are told apart by their source litho unit', () => {
    const t = tree({
      units: [
        unit('k1', null, { litho_main_soil_code: 'KLEI' }),
        unit('k2', null, { litho_main_soil_code: 'KLEI' }),
      ],
      contacts: [...bands('k1', 2), ...bands('k2', 2)],
      sourceLithoNameById: new Map([
        ['src-k1', 'CLAY | sandy'],
        ['src-k2', 'CLAY | organic'],
      ]),
    })

    const instances = t.groups[0].classes[0].instances
    expect(instances.map(i => i.label)).toEqual([
      'CLAY — not yet classified (CLAY | sandy)',
      'CLAY — not yet classified (CLAY | organic)',
    ])
  })

  it('T6d — a LONE unclassified unit gets no parenthetical (nothing to tell it apart from)', () => {
    const t = tree({
      units: [unit('k1', null, { litho_main_soil_code: 'KLEI' })],
      contacts: bands('k1', 2),
      sourceLithoNameById: new Map([['src-k1', 'CLAY | sandy']]),
    })

    expect(t.groups[0].classes[0].instances[0].label).toBe('CLAY — not yet classified')
  })

  it('T6e — the class row carries the NAD swatch colour, grey when there is no class', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', null)],
      contacts: [...bands('a', 1), ...bands('b', 1)],
    })

    const [classed, unclassed] = t.groups[0].classes
    expect(classed.color).toBe('#d4b84a')
    expect(unclassed.color).toBe('#9ca3af')
  })
})

// ---------------------------------------------------------------------------
// T7 — ordering
// ---------------------------------------------------------------------------

describe('order (T7)', () => {
  it('T7a — classes within a soil run in packing order, loosest first', () => {
    const t = tree({
      units: [unit('c', 8), unit('a', 5), unit('b', 7)],
      contacts: [...bands('a', 1), ...bands('b', 1), ...bands('c', 1)],
    })

    expect(t.groups[0].classes.map(c => c.nadClass)).toEqual([5, 7, 8])
  })

  it('T7b — the unclassified row sits at the BOTTOM of its soil, after the packing sequence', () => {
    const t = tree({
      units: [unit('none', null), unit('a', 5), unit('b', 7)],
      contacts: [...bands('none', 1), ...bands('a', 1), ...bands('b', 1)],
    })

    expect(t.groups[0].classes.map(c => c.nadClass)).toEqual([5, 7, null])
  })

  it('T7c — soil groups follow stratigraphic order (lowest display_order first)', () => {
    const t = tree({
      units: [
        unit('k', 21, { litho_main_soil_code: 'KLEI', display_order: 5 }),
        unit('s', 6, { display_order: 2 }),
      ],
      contacts: [...bands('k', 1), ...bands('s', 1)],
    })

    expect(t.groups.map(g => g.soil)).toEqual(['SAND', 'CLAY'])
  })

  it('T7d — instances inside a class follow the same stratigraphic order', () => {
    const t = tree({
      units: [unit('late', 6, { display_order: 9 }), unit('early', 6, { display_order: 1 })],
      contacts: [...bands('late', 1), ...bands('early', 1)],
    })

    expect(t.groups[0].classes[0].instances.map(i => i.formationId)).toEqual(['early', 'late'])
  })
})

// ---------------------------------------------------------------------------
// T8 — the empty scene
// ---------------------------------------------------------------------------

describe('the empty scene (T8)', () => {
  it('T8a — no units at all is an empty tree, not a crash', () => {
    const t = tree({ units: [] })
    expect(t.groups).toEqual([])
    expect(t.unitCount).toBe(0)
    expect(t.bandCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T10 — the crossed geological formations, listed as a class-row subtitle
//
// Owner ruling 2026-08-31 (R2): a body crossing two geological formations LISTS
// them both, shallowest first — not a majority stamp. The units pane surfaces
// that list as a subtitle on the class row; a class row standing for several
// units unions their lists.
// ---------------------------------------------------------------------------

describe('a class row lists every geological formation its units cross (T10)', () => {
  it('T10a — a class row standing for two units unions their crossed formations', () => {
    const t = tree({
      units: [unit('a', 6), unit('b', 6, { display_order: 1 })],
      contacts: [...bands('a', 1), ...bands('b', 1)],
      geoFormationNamesById: new Map([
        ['a', ['Holoceen']],
        ['b', ['Holoceen', 'Pleistoceen']],
      ]),
    })

    // Union, deduped, shallowest-first order preserved (a's list, then b's new).
    expect(t.groups[0].classes[0].geoFormations).toEqual(['Holoceen', 'Pleistoceen'])
  })

  it('T10b — a single-unit class row carries just that unit list', () => {
    const t = tree({
      units: [unit('a', 6)],
      contacts: bands('a', 1),
      geoFormationNamesById: new Map([['a', ['Pleistoceen']]]),
    })

    expect(t.groups[0].classes[0].geoFormations).toEqual(['Pleistoceen'])
  })

  it('T10c — with no crossed-formation map the subtitle is empty, never undefined', () => {
    const t = tree({ units: [unit('a', 6)], contacts: bands('a', 1) })
    expect(t.groups[0].classes[0].geoFormations).toEqual([])
  })
})
