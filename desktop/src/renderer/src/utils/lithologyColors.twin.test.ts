// Cross-language twin test — base-lithology display colours (debt #284/#275).
//
// The base-lithology -> display-hex table lives once in TypeScript
// (utils/lithoConstants.ts — LITHOLOGY_COLORS + LITHOLOGY_FALLBACK_COLOR) and
// once in Python (shared/constants/litho_constants.py — LITHOLOGY_COLORS +
// LITHOLOGY_FALLBACK_COLOR). Both docstrings already assert the two MUST stay
// byte-identical: the ghost-suggestion overlay renders a layer with the TS
// colour BEFORE any formation row exists, and on accept the backend stamps
// geological_formation.color from the Python colour (debt #145), so a hex drift
// on either side lets a preview disagree with the accepted band.
//
// This module and its Python twin
// (tests/unit/shared/constants/test_twin_lithology_colors.py) read the SAME
// committed arbiter, tests/fixtures/contracts/lithology_colors.json. A drift on
// either side — a changed hex, an added key, a dropped key — turns the other
// side's suite red.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LITHOLOGY_COLORS, LITHOLOGY_FALLBACK_COLOR } from './lithoConstants'

// .../desktop/src/renderer/src/utils -> repo root is 5 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(5))
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/lithology_colors.json')

interface Fixture {
  colors: Record<string, string>
  fallback_color: string
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

describe('lithology colours twin (debt #284/#275)', () => {
  it('the colour table equals the shared contract exactly', () => {
    // Exact-object equality catches a changed hex, an added lithology, or a
    // dropped one — any of which would let the accepted band diverge from its
    // ghost.
    expect(LITHOLOGY_COLORS).toEqual(fixture.colors)
  })

  it('the fallback colour equals the shared contract', () => {
    expect(LITHOLOGY_FALLBACK_COLOR).toBe(fixture.fallback_color)
  })
})
