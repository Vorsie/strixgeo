// Cross-language twin test — section corridor membership (debt #284).
//
// The rule "is this investigation ON this section?" (inside the lateral buffer
// AND between the two drawn endpoints, with a 1 micron endpoint tolerance)
// lives once in TypeScript (utils/sectionProjection.ts — investigationsOnSection)
// and once in Python (infrastructure/gis/section_projection.py —
// project_onto_section_corridor). The 2026-09-06 endpoint-tolerance bug had to
// be fixed on BOTH sides by hand and nothing would have caught a fix landing on
// one side only ("Koppelprofiel 4 contains one test").
//
// This module and its Python twin
// (tests/unit/infrastructure/gis/test_twin_section_corridor_membership.py) read
// the SAME committed arbiter, tests/fixtures/contracts/section_corridor_membership.json.
// A fix on one side of the twin fails the other side's suite when it drifts: to
// change the membership rule you must change the fixture, which turns both
// suites red at once (proven once by flipping a value and watching both go red).

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { investigationsOnSection, type SectionEndpoints } from './sectionProjection'

// .../desktop/src/renderer/src/utils -> repo root is 5 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(5))
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/section_corridor_membership.json')

interface Case {
  name: string
  description: string
  section: { start_x: number; start_y: number; end_x: number; end_y: number }
  buffer_m: number
  point_x: number
  point_y: number
  expected: { on_section: boolean; along: number | null; offset: number | null }
}

interface Fixture {
  along_offset_abs_tol_m: number
  cases: Case[]
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture
// Both implementations use the identical formula (same IEEE-754 ops in the same
// order), so along/offset agree to float noise; the fixture's absolute tolerance
// is the drift guard, applied directly rather than via toBeCloseTo's digit window.
const ABS_TOL = fixture.along_offset_abs_tol_m

describe('section corridor membership twin (debt #284)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const section: SectionEndpoints & { projection_buffer_m: number } = {
        ...c.section,
        projection_buffer_m: c.buffer_m,
      }
      // investigationsOnSection is the exact function the renderer uses to turn
      // a project's investigations into the columns the engineer sees; running
      // it on a single point reproduces the membership decision per case.
      const kept = investigationsOnSection(section, [
        { id: c.name, location_x: c.point_x, location_y: c.point_y },
      ])
      const onSection = kept.length === 1
      // The membership decision is the drift-sensitive part — assert it strictly.
      expect(onSection).toBe(c.expected.on_section)
      if (c.expected.on_section) {
        expect(Math.abs(kept[0].along - (c.expected.along as number))).toBeLessThanOrEqual(ABS_TOL)
        expect(Math.abs(kept[0].offset - (c.expected.offset as number))).toBeLessThanOrEqual(
          ABS_TOL,
        )
      }
    })
  }

  it('a fix on one side of the twin fails the other sides suite when it drifts', () => {
    // The far-endpoint case is the 2026-09-06 regression: a test whose
    // coordinate IS the section's far endpoint must count as a member even
    // though float noise can push the computed along a hair past length.
    const far = fixture.cases.find((c) => c.name === 'far_endpoint_exact')
    expect(far).toBeDefined()
    const section: SectionEndpoints & { projection_buffer_m: number } = {
      ...(far as Case).section,
      projection_buffer_m: (far as Case).buffer_m,
    }
    const kept = investigationsOnSection(section, [
      { id: 'far', location_x: (far as Case).point_x, location_y: (far as Case).point_y },
    ])
    expect(kept.length).toBe(1)
  })
})
