// Behavioural net for the Geotech-units tree builder.
//
// Owner ruling 2026-08-31 (walk interview), verbatim on the pane shape: "main
// litho is first level, one down is all litho bodies that are geometrically
// disconnected, one down is all disconnected packing bodies. Then if you group
// they get like a group 1 in parentheses behind." So the axis is three levels:
//
//   L1  main litho (soil)                       — SILT
//   L2  geometrically-disconnected litho bodies — SILT · #0, SILT · #1
//   L3  disconnected packing bodies             — SILT · SF #0, SILT · FF #1
//
// A packing (geotech) body homes under its PARENT litho body
// (``parent_litho_body_id``); one whose parent is not yet stamped falls into an
// "ungrouped" bucket under its soil rather than being dropped. The group number
// (D4) rides the packing-body leaf. Pins are on the pure builder; what the
// component renders around the tree is pinned in GeotechnicalUnitRoster.test.tsx.

import { describe, expect, it } from 'vitest'

import { nadClassColor } from '../../../utils/nadClasses'
import { buildGeotechUnitTree } from './geotechUnitTree'
import type { GeotechUnitTreeInput } from './geotechUnitTree'

// ---------------------------------------------------------------------------
// Scene builders
// ---------------------------------------------------------------------------

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

/** ``n`` accepted contacts for a unit — the header counter. */
function bands(formationId: string, n: number): GeotechUnitTreeInput['contacts'] {
  return Array.from({ length: n }, () => ({ formation_id: formationId }))
}

/** ``n`` accepted layers stamped to a geotech body — its leaf band count + badge. */
function bodyLayers(
  formationId: string,
  bodyId: string,
  n: number,
  confidence: 'low' | 'medium' | 'high' = 'high',
): GeotechUnitTreeInput['layers'] {
  return Array.from({ length: n }, () => ({
    formation_id: formationId,
    confidence,
    body_id: bodyId,
    status: 'accepted' as const,
  }))
}

/** One geotech (packing) body. */
function gbody(
  id: string,
  formationId: string,
  ordinal: number,
  overrides: Partial<{
    parentLithoBodyId: string | null
    name: string | null
    geoFormations: readonly string[]
  }> = {},
): NonNullable<GeotechUnitTreeInput['bodies']>[number] {
  return { id, formation_id: formationId, body_ordinal: ordinal, ...overrides }
}

/** One litho body roster entry (parent of a packing body). */
function lbody(
  formationId: string,
  ordinal: number,
  name: string | null = null,
): { name: string | null; body_ordinal: number; formation_id: string } {
  return { name, body_ordinal: ordinal, formation_id: formationId }
}

/** Build a tree from a scene, defaulting the parts a test does not care about. */
function tree(input: Partial<GeotechUnitTreeInput> & Pick<GeotechUnitTreeInput, 'units'>) {
  return buildGeotechUnitTree({ contacts: [], layers: [], ...input })
}

// ---------------------------------------------------------------------------
// N1 — the three levels (the shape the owner named)
// ---------------------------------------------------------------------------

describe('the pane is soil ▸ litho body ▸ packing body (N1)', () => {
  it('N1a — a soil with two disconnected litho bodies, each with a packing body', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [
        ...bodyLayers('u', 'g0', 2),
        ...bodyLayers('u', 'g1', 1),
      ],
      bodies: [
        gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' }),
        gbody('g1', 'u', 1, { parentLithoBodyId: 'lb1' }),
      ],
      lithoBodies: new Map([
        ['lb0', lbody('lu', 0)],
        ['lb1', lbody('lu', 1)],
      ]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })

    expect(t.groups.map(g => g.soil)).toEqual(['SAND'])
    const l2 = t.groups[0].lithoBodies
    expect(l2.map(n => n.lithoBodyId)).toEqual(['lb0', 'lb1'])
    expect(l2[0].packingBodies.map(p => p.bodyId)).toEqual(['g0'])
    expect(l2[1].packingBodies.map(p => p.bodyId)).toEqual(['g1'])
  })

  it('N1b — one litho body with two packing bodies of different classes', () => {
    const t = tree({
      units: [unit('sf', 13, { litho_main_soil_code: 'SILT' }), unit('ff', 15, { litho_main_soil_code: 'SILT', display_order: 1 })],
      layers: [...bodyLayers('sf', 'g0', 1), ...bodyLayers('ff', 'g1', 1)],
      bodies: [
        gbody('g0', 'sf', 0, { parentLithoBodyId: 'lb0' }),
        gbody('g1', 'ff', 1, { parentLithoBodyId: 'lb0' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SILT']]),
    })

    expect(t.groups[0].soil).toBe('SILT')
    expect(t.groups[0].lithoBodies).toHaveLength(1)
    expect(t.groups[0].lithoBodies[0].packingBodies.map(p => p.bodyId)).toEqual(['g0', 'g1'])
  })
})

// ---------------------------------------------------------------------------
// N2 — the null-parent fallback bucket
// ---------------------------------------------------------------------------

describe('a packing body with no stamped litho parent is not dropped (N2)', () => {
  it('N2a — a null parent_litho_body_id lands in an ungrouped bucket under its soil', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: null })],
    })

    expect(t.groups[0].soil).toBe('SAND')
    const l2 = t.groups[0].lithoBodies
    expect(l2).toHaveLength(1)
    expect(l2[0].lithoBodyId).toBeNull()
    expect(l2[0].packingBodies.map(p => p.bodyId)).toEqual(['g0'])
  })

  it('N2b — the ungrouped bucket sorts AFTER the stamped litho bodies', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'gstamped', 1), ...bodyLayers('u', 'gnull', 1)],
      bodies: [
        gbody('gnull', 'u', 0, { parentLithoBodyId: null }),
        gbody('gstamped', 'u', 1, { parentLithoBodyId: 'lb0' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })

    // Stamped litho body first, the null bucket last.
    expect(t.groups[0].lithoBodies.map(n => n.lithoBodyId)).toEqual(['lb0', null])
  })
})

// ---------------------------------------------------------------------------
// N3 — packing-body leaf labels + band counts
// ---------------------------------------------------------------------------

describe('every packing body says what it is (N3)', () => {
  it('N3a — auto label is soil + packing + ordinal, band count = accepted layers', () => {
    const t = tree({
      units: [unit('u', 6)], // ZAND + NAD 6 → SAND · MD
      layers: [...bodyLayers('u', 'gA', 2), ...bodyLayers('u', 'gB', 1)],
      bodies: [
        gbody('gB', 'u', 1, { parentLithoBodyId: 'lb0' }),
        gbody('gA', 'u', 0, { parentLithoBodyId: 'lb0' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })

    const packing = t.groups[0].lithoBodies[0].packingBodies
    // Ordinal order: gA (#0) then gB (#1).
    expect(packing.map(p => p.label)).toEqual(['SAND · MD #0', 'SAND · MD #1'])
    expect(packing.map(p => p.bandCount)).toEqual([2, 1])
  })

  it('N3b — a named packing body shows its name, not the auto label', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'gA', 1),
      bodies: [gbody('gA', 'u', 0, { parentLithoBodyId: 'lb0', name: 'Channel sand' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies[0].label).toBe('Channel sand')
  })
})

// ---------------------------------------------------------------------------
// N4 — litho-body (L2) labels, matching the CS jump breadcrumb (D5)
// ---------------------------------------------------------------------------

describe('the litho body reads the way it does everywhere else (N4)', () => {
  it('N4a — an unnamed litho body reads "<unit> · #<ordinal>"', () => {
    const t = tree({
      units: [unit('u', 13, { litho_main_soil_code: 'SILT' })],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 3)]]),
      lithoUnitNameById: new Map([['lu', 'SILT']]),
    })
    expect(t.groups[0].lithoBodies[0].label).toBe('SILT · #3')
  })

  it('N4b — a named litho body shows its name', () => {
    const t = tree({
      units: [unit('u', 13, { litho_main_soil_code: 'SILT' })],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0, 'Upper silt')]]),
      lithoUnitNameById: new Map([['lu', 'SILT']]),
    })
    expect(t.groups[0].lithoBodies[0].label).toBe('Upper silt')
  })
})

// ---------------------------------------------------------------------------
// N5 — ordering
// ---------------------------------------------------------------------------

describe('order (N5)', () => {
  it('N5a — packing bodies within a litho body run in ordinal order', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'late', 1), ...bodyLayers('u', 'early', 1)],
      bodies: [
        gbody('late', 'u', 9, { parentLithoBodyId: 'lb0' }),
        gbody('early', 'u', 1, { parentLithoBodyId: 'lb0' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies.map(p => p.bodyId)).toEqual(['early', 'late'])
  })

  it('N5b — litho bodies run in litho ordinal order', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'g0', 1), ...bodyLayers('u', 'g1', 1)],
      bodies: [
        gbody('g0', 'u', 0, { parentLithoBodyId: 'lbLate' }),
        gbody('g1', 'u', 1, { parentLithoBodyId: 'lbEarly' }),
      ],
      lithoBodies: new Map([
        ['lbLate', lbody('lu', 7)],
        ['lbEarly', lbody('lu', 2)],
      ]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies.map(n => n.lithoBodyId)).toEqual(['lbEarly', 'lbLate'])
  })

  it('N5c — soil groups follow stratigraphic order (lowest display_order first)', () => {
    const t = tree({
      units: [
        unit('k', 21, { litho_main_soil_code: 'KLEI', display_order: 5 }),
        unit('s', 6, { display_order: 2 }),
      ],
      layers: [...bodyLayers('k', 'gk', 1), ...bodyLayers('s', 'gs', 1)],
      bodies: [
        gbody('gk', 'k', 0, { parentLithoBodyId: 'lbk' }),
        gbody('gs', 's', 0, { parentLithoBodyId: 'lbs' }),
      ],
      lithoBodies: new Map([
        ['lbk', lbody('luk', 0)],
        ['lbs', lbody('lus', 0)],
      ]),
      lithoUnitNameById: new Map([['luk', 'CLAY'], ['lus', 'SAND']]),
    })
    expect(t.groups.map(g => g.soil)).toEqual(['SAND', 'CLAY'])
  })
})

// ---------------------------------------------------------------------------
// N6 — badges ride the packing-body leaf (per-body precision)
// ---------------------------------------------------------------------------

describe('badges are per packing body (N6)', () => {
  it('N6a — a body with a low fallback layer reads partial / low', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'g0', 2, 'high'), ...bodyLayers('u', 'g0', 1, 'low')],
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    const leaf = t.groups[0].lithoBodies[0].packingBodies[0]
    expect(leaf.provenance).toBe('partial')
    expect(leaf.confidence).toBe('low')
  })

  it('N6b — an all-cone body reads cpt / high', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 3, 'high'),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    const leaf = t.groups[0].lithoBodies[0].packingBodies[0]
    expect(leaf.provenance).toBe('cpt')
    expect(leaf.confidence).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// N6R — the litho body rolls up its packing bodies for the collapsed view
// (ux-reviewer 2026-09-01: collapsing must not hide the "No CPT" signal)
// ---------------------------------------------------------------------------

describe('the litho body rolls up worst provenance / confidence (N6R)', () => {
  it('N6R-a — worst provenance + confidence + a representative class on the node', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'g0', 2, 'high'), ...bodyLayers('u', 'g1', 1, 'low')],
      bodies: [
        gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' }),
        gbody('g1', 'u', 1, { parentLithoBodyId: 'lb0' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    const node = t.groups[0].lithoBodies[0]
    // g0 is cpt/high, g1 is none/low (a lone low layer never saw a cone).
    expect(node.provenance).toBe('none')
    expect(node.confidence).toBe('low')
    expect(node.nadClass).toBe(6)
  })

  it('N6R-b — a packing body carries a unit-level label (soil + packing, no ordinal)', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies[0].unitLabel).toBe('SAND · MD')
  })
})

// ---------------------------------------------------------------------------
// N7 — the crossed geological formations ride the leaf (R2)
// ---------------------------------------------------------------------------

describe('the crossed-formations list rides the packing body (N7)', () => {
  it('N7a — a body carries its own geoFormations, shallowest first', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [
        gbody('g0', 'u', 0, {
          parentLithoBodyId: 'lb0',
          geoFormations: ['Quartair', 'Pleistoceen'],
        }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies[0].geoFormations).toEqual([
      'Quartair',
      'Pleistoceen',
    ])
  })

  it('N7b — a body with no crossed formations reports an empty list, never undefined', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies[0].geoFormations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// N8 — the manual-group number rides the leaf (D4)
// ---------------------------------------------------------------------------

describe('a grouped packing body carries its group number (N8)', () => {
  it('N8a — a body in a multi-member group gets the number; a singleton gets null', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [...bodyLayers('u', 'g0', 1), ...bodyLayers('u', 'g1', 1)],
      bodies: [
        gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' }),
        gbody('g1', 'u', 1, { parentLithoBodyId: 'lb1' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)], ['lb1', lbody('lu', 1)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
      groupByBodyId: new Map([['g0', 1]]),
    })
    expect(t.groups[0].lithoBodies[0].packingBodies[0].groupNumber).toBe(1)
    expect(t.groups[0].lithoBodies[1].packingBodies[0].groupNumber).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// N9 — the picked colour rides the leaf (owner ruling 2026-08-26)
// ---------------------------------------------------------------------------

describe('the packing body draws its picked colour, else the NAD colour (N9)', () => {
  it('N9a — a body whose unit was given a colour draws it and reports the override', () => {
    const t = tree({
      units: [unit('u', 6, { color_override: '#ff00ff' })],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    const leaf = t.groups[0].lithoBodies[0].packingBodies[0]
    expect(leaf.color).toBe('#ff00ff')
    expect(leaf.colorOverride).toBe('#ff00ff')
    // The leaf names the home unit an edit must write to.
    expect(leaf.unitId).toBe('u')
  })

  it('N9b — with nobody having picked, the leaf draws its NAD colour and offers no reset', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('u', 'g0', 1),
      bodies: [gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    const leaf = t.groups[0].lithoBodies[0].packingBodies[0]
    expect(leaf.color).toBe(nadClassColor(6))
    expect(leaf.colorOverride).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// N10 — band-count roll-up
// ---------------------------------------------------------------------------

describe('band counts roll up leaf → litho body → soil (N10)', () => {
  it('N10a — a litho body sums its packing bodies; the soil sums its litho bodies', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: [
        ...bodyLayers('u', 'g0', 4),
        ...bodyLayers('u', 'g1', 3),
        ...bodyLayers('u', 'g2', 2),
      ],
      bodies: [
        gbody('g0', 'u', 0, { parentLithoBodyId: 'lb0' }),
        gbody('g1', 'u', 1, { parentLithoBodyId: 'lb0' }),
        gbody('g2', 'u', 2, { parentLithoBodyId: 'lb1' }),
      ],
      lithoBodies: new Map([['lb0', lbody('lu', 0)], ['lb1', lbody('lu', 1)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.groups[0].lithoBodies[0].bandCount).toBe(7)
    expect(t.groups[0].lithoBodies[1].bandCount).toBe(2)
    expect(t.groups[0].bandCount).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// N11 — the header counters describe the geotech units (unchanged)
// ---------------------------------------------------------------------------

describe('the header counts the units with content (N11)', () => {
  it('N11a — a unit with no bands and no layers is not counted', () => {
    const t = tree({
      units: [unit('a', 6), unit('empty', 7)],
      contacts: bands('a', 12),
      layers: bodyLayers('a', 'g0', 3),
      bodies: [gbody('g0', 'a', 0, { parentLithoBodyId: 'lb0' })],
      lithoBodies: new Map([['lb0', lbody('lu', 0)]]),
      lithoUnitNameById: new Map([['lu', 'SAND']]),
    })
    expect(t.unitCount).toBe(1)
    expect(t.bandCount).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// N12 — the empty scene
// ---------------------------------------------------------------------------

describe('the empty scene (N12)', () => {
  it('N12a — no units at all is an empty tree, not a crash', () => {
    const t = tree({ units: [] })
    expect(t.groups).toEqual([])
    expect(t.unitCount).toBe(0)
    expect(t.bandCount).toBe(0)
  })

  it('N12b — units but no bodies yet yields no soil groups (body-driven tree)', () => {
    const t = tree({ units: [unit('u', 6)], contacts: bands('u', 3) })
    expect(t.groups).toEqual([])
    // The header still reports the unit as having content.
    expect(t.unitCount).toBe(1)
  })

  it('N12c — a body whose home unit is absent is skipped, not crashed on', () => {
    const t = tree({
      units: [unit('u', 6)],
      layers: bodyLayers('ghost', 'g0', 1),
      bodies: [gbody('g0', 'ghost', 0, { parentLithoBodyId: 'lb0' })],
    })
    expect(t.groups).toEqual([])
  })
})
