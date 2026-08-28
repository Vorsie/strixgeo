/**
 * Language pins for buildGeotechLegendTree — the load-bearing display/logic
 * split. Under NL the family + class LABELS render Dutch, but the family SORT
 * order stays the norm's geological order (GRAVEL→PEAT), because it keys off the
 * English family word, not the display label. Get that wrong and a Dutch UI
 * sorts families alphabetically instead of geologically.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { getLanguage, setLanguage } from '../i18n/languageSelect'
import {
  buildGeotechLegendTree,
  type GeotechLegendFormationInput,
  type GeotechLegendSolidInput,
} from './geotechLegendTree'
import { nadClassColor } from './nadClasses'

function unit(
  id: string,
  soil: string | null,
  nadClass: number | null,
): GeotechLegendFormationInput {
  return {
    id,
    name: `${soil ?? 'unit'} (geotech)`,
    color: nadClassColor(nadClass),
    nad_class: nadClass,
    litho_main_soil_code: soil,
    litho_admixtures: null,
  }
}

function bodiesFor(...formationIds: string[]): GeotechLegendSolidInput[] {
  return formationIds.map((fid, i) => ({
    body_id: `b-${fid}`,
    formation_id: fid,
    body_ordinal: i,
    triangles: [[0, 1, 2]],
  }))
}

afterEach(() => {
  setLanguage('en')
})

describe('buildGeotechLegendTree under NL', () => {
  // Deliberately scrambled input order so the assertion proves the SORT, not the
  // insertion order.
  const formations = [
    unit('c', 'KLEI', 21),
    unit('g', 'GRIND', 1),
    unit('v', 'VEEN', 29),
    unit('z', 'ZAND', 6),
    unit('s', 'SILT', 13),
  ]
  const solids = bodiesFor('c', 'g', 'v', 'z', 's')

  it('GTNL1 — family rows read as Dutch soil words', () => {
    setLanguage('nl')
    const tree = buildGeotechLegendTree(formations, solids)
    expect(tree.map(f => f.label)).toEqual(['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN'])
  })

  it('GTNL2 — the family order is geological, NOT Dutch-alphabetical', () => {
    // Alphabetical Dutch would be GRIND, KLEI, SILT, VEEN, ZAND. The norm order
    // (gravel→sand→silt→clay→peat) must survive the translation.
    setLanguage('nl')
    const tree = buildGeotechLegendTree(formations, solids)
    const order = tree.map(f => f.label)
    expect(order.indexOf('ZAND')).toBeLessThan(order.indexOf('KLEI'))
    expect(order.indexOf('KLEI')).toBeLessThan(order.indexOf('VEEN'))
  })

  it('GTNL3 — the class row renders the Dutch packing phrase', () => {
    setLanguage('nl')
    const tree = buildGeotechLegendTree(formations, solids)
    const zand = tree.find(f => f.label === 'ZAND')!
    // NAD 6 = "ZAND, matig gepakt" → packing phrase "matig gepakt".
    expect(zand.classes.map(c => c.label)).toEqual(['matig gepakt'])
  })

  it('GTNL4 — the same tree in English is unchanged (parity)', () => {
    setLanguage('en')
    const tree = buildGeotechLegendTree(formations, solids)
    expect(tree.map(f => f.label)).toEqual(['GRAVEL', 'SAND', 'SILT', 'CLAY', 'PEAT'])
    const sand = tree.find(f => f.label === 'SAND')!
    expect(sand.classes.map(c => c.label)).toEqual(['medium dense'])
  })
})
