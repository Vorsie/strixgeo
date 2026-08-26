/**
 * Behavioural net for ``buildGeotechLegendTree`` — the nested 3-D LAYERS
 * legend (owner ruling 2026-08-26, mockup ``blend_viewer/geotech_ui_tidy_ideas.html``).
 *
 * The rule these pins paraphrase, in the owner's words: the flat legend shows
 * "34 rows of SAND/SAND/SAND/CLAY, identical text, different colours". It must
 * become "soil ▸ NAD class ▸ single bodies — closed by default at soil level
 * with body counts", where "the class row label is the FIRMNESS/DENSITY name,
 * not a repeat of the soil word", and a unit with no class yet is "not yet
 * classified" in neutral grey — never dropped.
 */

import { describe, expect, it } from 'vitest'

import { nadClassColor } from './nadClasses'
import {
  buildGeotechLegendTree,
  type GeotechLegendFormationInput,
  type GeotechLegendSolidInput,
} from './geotechLegendTree'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function unit(
  id: string,
  soil: string | null,
  nadClass: number | null,
  extra: Partial<GeotechLegendFormationInput> = {},
): GeotechLegendFormationInput {
  return {
    id,
    name: `${soil ?? 'unit'} (geotech)`,
    color: nadClassColor(nadClass),
    nad_class: nadClass,
    litho_main_soil_code: soil,
    litho_admixtures: null,
    ...extra,
  }
}

/** A BUILT body (non-empty triangles) belonging to ``formationId``. */
function body(
  bodyId: string,
  formationId: string,
  ordinal: number,
  extra: Partial<GeotechLegendSolidInput> = {},
): GeotechLegendSolidInput {
  return {
    body_id: bodyId,
    formation_id: formationId,
    body_ordinal: ordinal,
    triangles: [[0, 1, 2]],
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildGeotechLegendTree — grouping', () => {
  it('GT1 — many same-soil units collapse to ONE family row per soil', () => {
    // The owner's screenshot: rows whose text is identical because they are the
    // same soil. Five SAND units + two CLAY units must read as two rows when
    // closed, not seven.
    const formations = [
      unit('s1', 'ZAND', 5),
      unit('s2', 'ZAND', 6),
      unit('s3', 'ZAND', 6),
      unit('s4', 'ZAND', 7),
      unit('s5', 'ZAND', 8),
      unit('c1', 'KLEI', 21),
      unit('c2', 'KLEI', 22),
    ]
    const tree = buildGeotechLegendTree(formations, [])

    expect(tree.map(f => f.label)).toEqual(['SAND', 'CLAY'])
  })

  it('GT2 — the class row is labelled by firmness/density, NEVER a repeat of the soil word', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 10), unit('c1', 'KLEI', 23)],
      [],
    )

    const sand = tree.find(f => f.label === 'SAND')!
    expect(sand.classes.map(c => c.label)).toEqual([
      'medium dense',
      'silty/clayey, medium dense',
    ])
    // No class label repeats its family's soil word.
    for (const family of tree) {
      for (const cls of family.classes) {
        expect(cls.label.toUpperCase()).not.toContain(family.label)
      }
    }
    const clay = tree.find(f => f.label === 'CLAY')!
    expect(clay.classes.map(c => c.label)).toEqual(['fairly firm'])
  })

  it('GT3 — a unit with no class yet groups under its soil as neutral-grey "not yet classified"', () => {
    // The "(geotech)" skeletons: nad_class NULL. They must NOT be hidden.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', null)],
      [],
    )

    const sand = tree.find(f => f.label === 'SAND')!
    const unclassified = sand.classes.find(c => c.nadClass === null)!
    expect(unclassified.label).toBe('not yet classified')
    expect(unclassified.color).toBe(nadClassColor(null))
    expect(unclassified.color).toBe('#9ca3af')
    expect(unclassified.formationIds).toEqual(['s2'])
  })

  it('GT4 — a unit with an unknown soil code still gets a family row', () => {
    // Soil codes come from DOV; an uncurated token must never silently vanish
    // from the legend (it is real ground the viewer is painting).
    const tree = buildGeotechLegendTree([unit('x1', 'XZ', null)], [])
    expect(tree).toHaveLength(1)
    expect(tree[0].label).toBe('XZ')
  })
})

describe('buildGeotechLegendTree — counts', () => {
  it('GT5 — the family count is the number of bodies beneath it, summed over its classes', () => {
    const formations = [unit('s1', 'ZAND', 5), unit('s2', 'ZAND', 6)]
    const solids = [
      body('b1', 's1', 0),
      body('b2', 's1', 1),
      body('b3', 's1', 2),
      body('b4', 's2', 0),
      body('b5', 's2', 1),
    ]
    const tree = buildGeotechLegendTree(formations, solids)

    const sand = tree[0]
    expect(sand.bodyCount).toBe(5)
    expect(sand.classes.map(c => [c.label, c.bodyCount])).toEqual([
      ['loose', 3],
      ['medium dense', 2],
    ])
  })

  it('GT6 — an unbuilt solid (no triangles) is not a body', () => {
    // A flagged/empty slab carries no geometry; counting it would promise a
    // body the viewer never paints.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6)],
      [body('b1', 's1', 0), { body_id: 'b2', formation_id: 's1', body_ordinal: 1, triangles: [] }],
    )
    expect(tree[0].bodyCount).toBe(1)
    expect(tree[0].classes[0].bodies.map(b => b.bodyId)).toEqual(['b1'])
  })

  it('GT7 — a class with no built bodies still shows, with a zero count', () => {
    // Before Build (and in Fence mode) there are no solids at all; the legend
    // must still list what the model contains.
    const tree = buildGeotechLegendTree([unit('s1', 'ZAND', 6)], [])
    expect(tree[0].bodyCount).toBe(0)
    expect(tree[0].classes[0].bodies).toEqual([])
  })
})

describe('buildGeotechLegendTree — ordering + identity', () => {
  it('GT8 — families follow the NAD soil order and classes ascend, unclassified last', () => {
    const formations = [
      unit('p1', 'VEEN', 29),
      unit('c1', 'KLEI', 22),
      unit('s2', 'ZAND', null),
      unit('s1', 'ZAND', 7),
      unit('s0', 'ZAND', 5),
      unit('g1', 'GRIND', 1),
      unit('t1', 'SILT', 13),
    ]
    const tree = buildGeotechLegendTree(formations, [])

    expect(tree.map(f => f.label)).toEqual(['GRAVEL', 'SAND', 'SILT', 'CLAY', 'PEAT'])
    const sand = tree.find(f => f.label === 'SAND')!
    expect(sand.classes.map(c => c.nadClass)).toEqual([5, 7, null])
  })

  it('GT9 — bodies ascend by ordinal within their class', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6)],
      [body('b3', 's1', 2), body('b1', 's1', 0), body('b2', 's1', 1)],
    )
    expect(tree[0].classes[0].bodies.map(b => b.label)).toEqual(['#0', '#1', '#2'])
  })

  it('GT10 — a class row carries EVERY formation id beneath it (what the eye toggles)', () => {
    // Two litho units subdivided to the same packing class share one row; the
    // row's eye has to hide both of them.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 6), unit('s3', 'ZAND', 8)],
      [],
    )
    const sand = tree[0]
    expect(sand.formationIds).toEqual(['s1', 's2', 's3'])
    expect(sand.classes[0].formationIds).toEqual(['s1', 's2'])
    expect(sand.classes[1].formationIds).toEqual(['s3'])
  })

  it('GT11 — when one class row spans several units, its body labels name the unit', () => {
    // Otherwise the third level reproduces the disease the tree is fixing:
    // two rows reading "#0" under the same class.
    const clayey = unit('s2', 'ZAND', 6, {
      litho_admixtures: [{ soil_code: 'KL', amount: 'W', locally: false }],
    })
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), clayey],
      [body('b1', 's1', 0), body('b2', 's2', 0)],
    )
    expect(tree[0].classes[0].bodies.map(b => b.label)).toEqual([
      'SAND #0',
      'SAND | slightly clayey #0',
    ])
  })
})

describe('buildGeotechLegendTree — colour', () => {
  it('GT12 — the class swatch is its NAD colour; a body keeps its own override', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 7)],
      [body('b1', 's1', 0), body('b2', 's1', 1, { display_color: '#ff00ff' })],
    )
    const cls = tree[0].classes[0]
    expect(cls.color).toBe(nadClassColor(7))
    expect(cls.bodies[0].color).toBe(nadClassColor(7))
    expect(cls.bodies[1].color).toBe('#ff00ff')
  })

  it('GT13 — the family swatch is its most-populated class colour', () => {
    // The family row has to read as ONE hue: within a family the NAD ramp is a
    // lightness ramp of a single hue, and the class carrying the most bodies is
    // the family's dominant packing.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 5), unit('s2', 'ZAND', 7)],
      [body('b1', 's1', 0), body('b2', 's2', 0), body('b3', 's2', 1)],
    )
    expect(tree[0].color).toBe(nadClassColor(7))
  })
})
