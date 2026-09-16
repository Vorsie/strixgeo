// Cross-language twin test — geotech packing-class key (debt #284).
//
// The packing-class identity ("same litho and packing density") lives once in
// TypeScript (utils/geotechHierarchicalFill/packingClassOf.ts — buildPackingClassOf)
// and once in Python (domain/services/voxel_litho/packing_class_key.py —
// packing_class_key_of). Both collapse a formation row that carries BOTH a NAD
// class and a soil code to "SOIL|CLASS" and keep a row missing either half at
// its own row identity, so the frontend fill and the backend voxel body merge
// agree on what "same body" means.
//
// This module and its Python twin
// (tests/unit/domain/services/test_twin_packing_class_key.py) read the SAME
// committed arbiter, tests/fixtures/contracts/packing_class_key.json. A fix on
// one side of the twin fails the other side's suite when it drifts.
//
// The two implementations differ in ONE faithful way: buildPackingClassOf
// returns a Map with no entry for a missing/unknown id and the call site applies
// "?? id" (e.g. PartitionFillOverlay.tsx), whereas the Python callable folds the
// "unknown id -> id itself" fallback in. The contract compares the EFFECTIVE key
// — map.get(id) ?? id here — which is exactly what the call sites rely on.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildPackingClassOf, type PackingClassMeta } from './packingClassOf'

// .../desktop/src/renderer/src/utils/geotechHierarchicalFill -> repo root is 6 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(6))
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/packing_class_key.json')

interface Row {
  formation_id: string
  nad_class: number | null
  soil_code: string | null
  effective_key: string
}

interface QueryCase {
  name: string
  description: string
  query_id: string
  expected_key: string
}

interface Fixture {
  rows: Row[]
  cases: QueryCase[]
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

/** Build the fill's class map from the fixture rows, exactly as SectionsCanvas feeds it. */
function classMap(): Map<string, string> {
  const entries: Array<readonly [string, PackingClassMeta]> = fixture.rows.map((r) => [
    r.formation_id,
    { nadClass: r.nad_class, soilCode: r.soil_code },
  ])
  return buildPackingClassOf(entries)
}

/** The effective key: the map entry when present, else the id itself (the call-site fallback). */
function effectiveKey(map: Map<string, string>, id: string): string {
  return map.get(id) ?? id
}

describe('packing-class key twin (debt #284)', () => {
  for (const row of fixture.rows) {
    it(`row ${row.formation_id}`, () => {
      expect(effectiveKey(classMap(), row.formation_id)).toBe(row.effective_key)
    })
  }

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(effectiveKey(classMap(), c.query_id)).toBe(c.expected_key)
    })
  }

  it('a fix on one side of the twin fails the other sides suite when it drifts', () => {
    // Two rows of the same class and soil under different ids must collapse to
    // ONE key (owner 2026-08-21 "one mass one body"); a row missing a half must
    // keep its own row identity (two unknowns are not known to be the same
    // density). Both facts are pinned in the fixture the Python twin also reads.
    const map = classMap()
    expect(effectiveKey(map, 'f-sand-6')).toBe(effectiveKey(map, 'f-sand-6-twin'))
    expect(effectiveKey(map, 'f-no-class')).toBe('f-no-class')
    expect(effectiveKey(map, 'f-no-soil')).toBe('f-no-soil')
  })
})
