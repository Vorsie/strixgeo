// Cross-language twin test — admixture -> NAD-fork detection (debt #284/#275).
//
// Whether a litho unit's pure-vs-with-admixture NAD choice is a real fork (owner
// ruling 2026-09-04) is decided once in TypeScript
// (utils/admixtureNadChoice.ts — unitAdmixtureIsAmbiguous, via
// SECONDARY_ADMIXTURE_CODES ported verbatim from nad_classification_constants.py)
// and once in Python (domain/services/nad_admixture_choice.py —
// unit_admixture_is_ambiguous, via NAD_QC_BANDS + the _SECONDARY_ADMIXTURE_CODES
// sets). Both must agree on which soils fork and which admixture codes fork them,
// or the geotech prompt asks (or hides) a unit on one platform that the other
// treats differently.
//
// admixtureNadChoice.test.ts and test_nad_admixture_choice.py were two
// hand-maintained mirrors with nothing enforcing they stay in step. This module
// and its Python twin
// (tests/unit/domain/services/test_twin_nad_admixture_choice.py) read the SAME
// committed arbiter, tests/fixtures/contracts/nad_admixture_fork.json. A drift on
// either side turns the other side's suite red.
//
// Scope: the arbiter pins the DETECTION rule only. The sibling "which NAD column
// a stored answer binds to" (pure->clean / with_admixture->secondary) is resolved
// on the backend alone, so it has no cross-language twin.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AdmixtureItem } from '../api/clients/geology.types'
import { unitAdmixtureIsAmbiguous } from './admixtureNadChoice'

// .../desktop/src/renderer/src/utils -> repo root is 5 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(5))
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/nad_admixture_fork.json')

interface ForkCase {
  name: string
  description: string
  soil: string
  admixture_codes: string[]
  expected_ambiguous: boolean
}

interface Fixture {
  cases: ForkCase[]
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

/** Build the detector's admixture input from the fixture codes, exactly as a
 *  formation's ``litho_admixtures`` would arrive (amount does not affect the
 *  fork rule — only soil_code). */
function admixtures(codes: string[]): AdmixtureItem[] {
  return codes.map(code => ({ soil_code: code, amount: 'M', locally: false }))
}

describe('admixture NAD-fork detection twin (debt #284/#275)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(unitAdmixtureIsAmbiguous(c.soil, admixtures(c.admixture_codes))).toBe(
        c.expected_ambiguous,
      )
    })
  }
})
