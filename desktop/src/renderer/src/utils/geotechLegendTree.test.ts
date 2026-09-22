/**
 * Behavioural net for ``buildGeotechLegendTree`` — the nested 3-D LAYERS
 * legend (owner ruling 2026-08-26, mockup ``blend_viewer/geotech_ui_tidy_ideas.html`` (not kept in the repo)).
 *
 * The rule these pins paraphrase, in the owner's words: the flat legend shows
 * "34 rows of SAND/SAND/SAND/CLAY, identical text, different colours". It must
 * become "soil ▸ NAD class ▸ single bodies — closed by default at soil level
 * with body counts", where "the class row label is the FIRMNESS/DENSITY name,
 * not a repeat of the soil word", and a unit with no class yet is "not yet
 * classified" in neutral grey — never dropped.
 */

import { describe, expect, it } from 'vitest'

import { NAD_CLASS_NAMES, nadClassColor } from './nadClasses'
import {
  buildGeotechLegendTree,
  type GeotechLegendClassNode,
  type GeotechLegendFamilyNode,
  type GeotechLegendFormationInput,
  type GeotechLegendPanelInput,
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

/** One built body per formation id — "each of these units has something built". */
function bodiesFor(...formationIds: string[]): GeotechLegendSolidInput[] {
  return formationIds.map((fid, i) => body(`b-${fid}`, fid, i))
}

/** A fence wall (non-empty triangles) belonging to ``formationId``. */
function panel(formationId: string): GeotechLegendPanelInput {
  return { formationId, triangles: [[0, 1, 2]] }
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
    const tree = buildGeotechLegendTree(
      formations,
      bodiesFor('s1', 's2', 's3', 's4', 's5', 'c1', 'c2'),
    )

    expect(tree.map(f => f.label)).toEqual(['SAND', 'CLAY'])
  })

  it('GT2 — the class row is labelled by firmness/density, NEVER a repeat of the soil word', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 10), unit('c1', 'KLEI', 23)],
      bodiesFor('s1', 's2', 'c1'),
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
      bodiesFor('s1', 's2'),
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
    const tree = buildGeotechLegendTree([unit('x1', 'XZ', null)], bodiesFor('x1'))
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

  // RETIRED 2026-08-26: 'GT7 — a class with no built bodies still shows, with a
  // zero count'. Overturned by the owner on seeing it in the real legend: "why
  // are there suboptions like this ... not yet classified?". The replacement
  // rule is GT14–GT19 below.
})

// ---------------------------------------------------------------------------
// Only what the scene paints gets a row
//
// Owner ruling, dogfeed 2026-08-26, on the 3-D LAYERS legend: "why are there
// suboptions like this ... not yet classified?" A row whose eye cannot change
// anything on screen is noise — it describes a bin, not ground, and the engineer
// reads it as a model he has not built rather than as nothing at all.
//
// "Paints" is read PER VIEW MODE, because the two modes paint different things:
// solid mode paints body solids, fence mode paints walls and deliberately skips
// the solids. A class row therefore exists in solid mode when it has a built
// body, and in fence mode when one of its units has a wall — which is how a
// band with nothing built keeps its row (and its eye) on the fence diagram.
// ---------------------------------------------------------------------------

describe('buildGeotechLegendTree — only what the scene paints gets a row', () => {
  it('GT14 — a class with nothing built is not a row', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 8)],
      [body('b1', 's1', 0)],
    )

    expect(tree[0].classes.map(c => c.nadClass)).toEqual([6])
  })

  it('GT15 — a family whose every class has nothing built is not a row either', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('c1', 'KLEI', 22)],
      [body('b1', 's1', 0)],
    )

    expect(tree.map(f => f.label)).toEqual(['SAND'])
  })

  it('GT16 — "not yet classified" is not exempt: with nothing built it goes too', () => {
    // The row the owner pointed at. It was kept on the reasoning that it is the
    // prompt to go and classify — but with no solid behind it there is nothing
    // in the scene it can prompt about.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', null)],
      [body('b1', 's1', 0)],
    )

    expect(tree[0].classes.map(c => c.nadClass)).toEqual([6])
  })

  it('GT17 — a "not yet classified" unit WITH a built body keeps its row', () => {
    // The control for GT16: unclassified GROUND is content. Only an empty bin
    // goes.
    const tree = buildGeotechLegendTree([unit('s2', 'ZAND', null)], [body('b1', 's2', 0)])

    const cls = tree[0].classes[0]
    expect(cls.label).toBe('not yet classified')
    expect(cls.formationIds).toEqual(['s2'])
  })

  it('GT18 — in fence mode a class with WALLS but no solids is a row', () => {
    // Bands exist without solids: the fence walls are computed from the geotech
    // layers + accepted ties, with no Build involved. The row has to be there or
    // the engineer cannot hide the wall.
    const tree = buildGeotechLegendTree([unit('s1', 'ZAND', 6)], [], [panel('s1')])

    expect(tree[0].classes.map(c => c.nadClass)).toEqual([6])
    // Nothing built, so nothing to expand — the class carries no body rows.
    expect(tree[0].classes[0].bodies).toEqual([])
    expect(tree[0].classes[0].bodyCount).toBe(0)
  })

  it('GT19 — in fence mode a class with neither wall nor solid is not a row', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 8)],
      [],
      [panel('s1')],
    )

    expect(tree[0].classes.map(c => c.nadClass)).toEqual([6])
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
    const tree = buildGeotechLegendTree(
      formations,
      bodiesFor('p1', 'c1', 's2', 's1', 's0', 'g1', 't1'),
    )

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
      bodiesFor('s1', 's2', 's3'),
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

  it('GT20 — a colour the engineer picked is what the class row shows', () => {
    // Owner ruling 2026-08-26: "Colours on the right hand pane need to be
    // choosable if user wants." He picks on the pane; the 3-D legend has to
    // agree with what the scene is painting, or the swatch stops identifying
    // the body it stands for.
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6, { color_override: '#ff00ff' })],
      bodiesFor('s1'),
    )

    expect(tree[0].classes[0].color).toBe('#ff00ff')
  })

  it('GT21 — a class row whose units DISAGREE falls back to its NAD colour', () => {
    // One row, one swatch: it cannot honestly show two picks.
    const tree = buildGeotechLegendTree(
      [
        unit('s1', 'ZAND', 6, { color_override: '#ff00ff' }),
        unit('s2', 'ZAND', 6, { color_override: '#00ff00' }),
      ],
      bodiesFor('s1', 's2'),
    )

    expect(tree[0].classes[0].color).toBe(nadClassColor(6))
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

describe('buildGeotechLegendTree — the composed line never states a class that does not exist', () => {
  // Owner ruling 2026-08-26, verbatim: "why are there suboptions like this firm
  // sand ...? Look at the NAD table moderately firm sand just does not exist."
  //
  // The tree reads as a sentence: the family row names the soil and the class
  // row beneath it names the packing, so the eye composes "SAND" + "moderately
  // firm". The family word comes from the unit's LITHO soil code and the class
  // word from its NAD class, and those two can legitimately disagree — the
  // borehole extrapolation in SubdivideAllBodies falls back to "the nearest CPT
  // of ANY lithology" when no same-lithology CPT reaches that depth, so a unit
  // born from a ZAND litho body can carry a SILT/KLEI class. When it does, the
  // composed line must not read as a firm sand.
  const SILT_MODERATELY_FIRM = 14
  const SAND_DENSE = 7

  /**
   * The line the user actually reads for one class row — either the family word
   * completes the qualifier ("SAND" + "medium dense"), or the row already names
   * its own soil and stands alone.
   */
  const lineOf = (family: GeotechLegendFamilyNode, cls: GeotechLegendClassNode): string =>
    cls.label === NAD_CLASS_NAMES[cls.nadClass as number]
      ? cls.label
      : `${family.label}, ${cls.label}`

  it('GT_V1 — every rendered line is a NAD class that exists', () => {
    // The general law. A sand family row completing into "SAND, moderately
    // firm" is the failure the owner caught; this holds every row in the tree
    // to reconstructing its own true class name.
    const tree = buildGeotechLegendTree(
      [
        unit('s1', 'ZAND', 6),
        unit('s2', 'ZAND', 10),
        unit('s3', 'ZAND', SILT_MODERATELY_FIRM),
        unit('c1', 'KLEI', 23),
        unit('c2', 'KLEI', SAND_DENSE),
        unit('p1', 'VEEN', 31),
      ],
      bodiesFor('s1', 's2', 's3', 'c1', 'c2', 'p1'),
    )

    for (const family of tree) {
      for (const cls of family.classes) {
        if (cls.nadClass === null) continue
        expect(lineOf(family, cls), `${family.label} > ${cls.label}`).toBe(
          NAD_CLASS_NAMES[cls.nadClass],
        )
      }
    }
  })

  it('GT_V2 — a silt class under a sand body states its OWN soil, never "firm sand"', () => {
    const tree = buildGeotechLegendTree(
      [unit('s2', 'ZAND', SILT_MODERATELY_FIRM)],
      bodiesFor('s2'),
    )

    const sand = tree.find(f => f.label === 'SAND')!
    // It keeps its place under the sand body it subdivides (that grouping is
    // what the tree is for) but says which class it actually is.
    expect(sand.classes.map(c => c.label)).toEqual(['SILT, moderately firm'])
  })

  it('GT_V3 — the mirror: a sand class under a clay body never reads as "dense clay"', () => {
    const tree = buildGeotechLegendTree(
      [unit('c1', 'KLEI', 23), unit('c2', 'KLEI', SAND_DENSE)],
      bodiesFor('c1', 'c2'),
    )

    const clay = tree.find(f => f.label === 'CLAY')!
    expect(clay.classes.map(c => c.label)).toEqual(['SAND, dense', 'fairly firm'])
  })

  it('GT_V4 — a class that agrees with its family keeps the bare qualifier', () => {
    const tree = buildGeotechLegendTree(
      [unit('s1', 'ZAND', 6), unit('s2', 'ZAND', 10)],
      bodiesFor('s1', 's2'),
    )
    expect(tree[0].classes.map(c => c.label)).toEqual(['medium dense', 'silty/clayey, medium dense'])
  })
})
