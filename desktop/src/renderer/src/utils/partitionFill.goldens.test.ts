/**
 * Golden-fixture generator for the TS ``computeSectionFill`` output.
 *
 * Purpose
 * -------
 * These golden JSONs are the PARITY CONTRACT for the Python port of
 * ``computeSectionFill`` (Task 3 of the watertight loft builder plan).
 * The generator is the source of truth — the Python test
 * ``tests/unit/domain/test_section_partition_goldens.py`` reads these JSONs
 * and asserts identical region output. Never edit the JSONs by hand; rerun
 * this generator instead.
 *
 * Design rules
 * ------------
 * - Stable key order (alphabetical), deterministic values, 6-decimal float
 *   rounding.
 * - Full ``SectionRegion`` shape serialised (``kind``, ``bodyId``,
 *   ``formationId``, ``polygon``, ``gapIndex``, ``overlayTier``).
 * - Each scenario asserts ``regions.length > 0`` AND at least one region of
 *   the expected ``kind``/``overlayTier`` BEFORE writing, so the generator
 *   FAILS instead of silently writing a fixture that misses its named path.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the Python-side fixture directory (repo root relative). */
const FIXTURE_DIR = resolve(HERE, '../../../../../tests/unit/fixtures/partition_goldens')

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Round a float to 6 decimal places. */
function r6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000
}

/** Recursively round all numbers and sort all object keys (determinism). */
function roundDeep(v: unknown): unknown {
  if (typeof v === 'number') return r6(v)
  if (Array.isArray(v)) return v.map(roundDeep)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, roundDeep(val)]),
    )
  }
  return v
}

/**
 * Write a golden fixture JSON of shape
 * ``{ name, columns: PartitionColumn[], edges: CorrelationEdge[],
 *     regions: SectionRegion[] }``.
 */
function writeGolden(
  name: string,
  columns: PartitionColumn[],
  edges: CorrelationEdge[],
  regions: SectionRegion[],
): void {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const payload = roundDeep({ name, columns, edges, regions })
  writeFileSync(resolve(FIXTURE_DIR, `${name}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Scenario 1 — band_two_columns
//
// Two columns, each SAND (0–5 m) over CLAY (5–10 m), surfaces level at 0 mTAW.
// Edges correlate the SAND tops and the CLAY tops, so both pairs match with
// the maximum pair score (same lithology + edge + overlap) and emit as two
// full-width ``kind: 'quad'`` bands. (The CLAY base is the column floor —
// a floor contact can never correlate — but the matched pair still quads.)
// ---------------------------------------------------------------------------

describe('band_two_columns golden', () => {
  it('produces quad regions and writes the golden JSON', () => {
    const left: PartitionColumn = {
      investigationId: 'inv-A',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'SAND', bodyId: 'body-1', layerId: 'layer-a0' },
        { topDepthM: 5, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-2', layerId: 'layer-a1' },
      ],
    }
    const right: PartitionColumn = {
      investigationId: 'inv-B',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'SAND', bodyId: 'body-1', layerId: 'layer-b0' },
        { topDepthM: 5, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-2', layerId: 'layer-b1' },
      ],
    }
    const edges: CorrelationEdge[] = [
      { a: 'layer-a0', b: 'layer-b0' }, // SAND top ↔ SAND top
      { a: 'layer-a1', b: 'layer-b1' }, // CLAY top ↔ CLAY top (= SAND base ↔ SAND base)
    ]

    const regions = computeSectionFill([left, right], edges)

    expect(regions.length).toBeGreaterThan(0)
    // Both correlated pairs must band: two full-width quads.
    expect(regions.filter((r) => r.kind === 'quad').length).toBe(2)

    writeGolden('band_two_columns', [left, right], edges, regions)
  })
})

// ---------------------------------------------------------------------------
// Scenario 2 — onlap_one_corr
//
// "The upper unit's top is correlated but its base is not → onlap."
//
// Left:  TOPSAND (0–2 m), CLAY (2–3.5 m).            (shallow column)
// Right: TOPSAND (0–2 m), PEAT (2–4 m), CLAY (4–10 m).
// Edges: TOPSAND tops (the bracket band above) + PEAT top ↔ left CLAY top.
//
// PEAT's top contact (layer-r1) is correlated, its base contact (layer-r2)
// is not → exactly 1 correlated contact, so ``reduceColumn`` keeps it (only
// 0-contact lenses are pulled). The two CLAYs do not pair (no edge, and their
// elevation spans −2…−3.5 vs −4…−10 do not overlap), so the interval below
// the TOPSAND band holds left=[CLAY] / right=[PEAT, CLAY].
// ``extractIntervalMinorities`` then pulls PEAT as an onlap-top (it touches
// the top bracket, the CLAY matrix below it is present on both interval
// stacks) → emitted as ``kind: 'lens', overlayTier: 'onlap'``, while the
// merged CLAY matrix connects across as a quad.
// ---------------------------------------------------------------------------

describe('onlap_one_corr golden', () => {
  it('produces an onlap overlay region and writes the golden JSON', () => {
    const left: PartitionColumn = {
      investigationId: 'inv-C',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 2, formationId: 'TOPSAND', bodyId: 'body-3', layerId: 'layer-c0' },
        { topDepthM: 2, baseDepthM: 3.5, formationId: 'CLAY', bodyId: 'body-4', layerId: 'layer-c1' },
      ],
    }
    const right: PartitionColumn = {
      investigationId: 'inv-D',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 2, formationId: 'TOPSAND', bodyId: 'body-3', layerId: 'layer-d0' },
        // PEAT: top contact correlated (edge below), base contact not → onlap.
        { topDepthM: 2, baseDepthM: 4, formationId: 'PEAT', bodyId: 'body-5', layerId: 'layer-d1' },
        { topDepthM: 4, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-4', layerId: 'layer-d2' },
      ],
    }
    const edges: CorrelationEdge[] = [
      { a: 'layer-c0', b: 'layer-d0' }, // TOPSAND band (the bracket above)
      { a: 'layer-c1', b: 'layer-d1' }, // PEAT top ↔ left CLAY top (the 1 correlated contact)
    ]

    const regions = computeSectionFill([left, right], edges)

    expect(regions.length).toBeGreaterThan(0)
    // The PEAT must emit as an onlap overlay.
    expect(regions.some((r) => r.kind === 'lens' && r.overlayTier === 'onlap')).toBe(true)

    writeGolden('onlap_one_corr', [left, right], edges, regions)
  })
})

// ---------------------------------------------------------------------------
// Scenario 3 — lens_zero_corr
//
// Three columns. Left/right: SAND (0–5 m) over CLAY (5–10 m). The middle
// column carries a thin SILT interbed INSIDE the sand: SAND (0–2 m) /
// SILT (2–3 m) / SAND (3–5 m) / CLAY (5–10 m).
//
// The SILT's bounding contacts are its own top (layer-m1) and the lower
// SAND's top (layer-m2) — neither has any edge, so toward BOTH neighbours the
// SILT has 0 correlated contacts → ``reduceColumn`` pulls it as a lens and
// merges the same-formation SAND around it (the matrix bands across via its
// outer correlated boundaries). The SILT emits in both gaps as
// ``kind: 'lens', overlayTier: 'lens'``.
// ---------------------------------------------------------------------------

describe('lens_zero_corr golden', () => {
  it('produces a lens region and writes the golden JSON', () => {
    const left: PartitionColumn = {
      investigationId: 'inv-E',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'SAND', bodyId: 'body-6', layerId: 'layer-e0' },
        { topDepthM: 5, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-7', layerId: 'layer-e1' },
      ],
    }
    const middle: PartitionColumn = {
      investigationId: 'inv-M',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 2, formationId: 'SAND', bodyId: 'body-6', layerId: 'layer-m0' },
        // SILT — 0 correlated contacts toward either neighbour → lens.
        { topDepthM: 2, baseDepthM: 3, formationId: 'SILT', bodyId: 'body-8', layerId: 'layer-m1' },
        { topDepthM: 3, baseDepthM: 5, formationId: 'SAND', bodyId: 'body-6', layerId: 'layer-m2' },
        { topDepthM: 5, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-7', layerId: 'layer-m3' },
      ],
    }
    const right: PartitionColumn = {
      investigationId: 'inv-F',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'SAND', bodyId: 'body-6', layerId: 'layer-f0' },
        { topDepthM: 5, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-7', layerId: 'layer-f1' },
      ],
    }
    // Correlate SAND tops + CLAY tops on both gaps; the SILT's contacts
    // (layer-m1 / layer-m2) carry no edges at all.
    const edges: CorrelationEdge[] = [
      { a: 'layer-e0', b: 'layer-m0' },
      { a: 'layer-m0', b: 'layer-f0' },
      { a: 'layer-e1', b: 'layer-m3' },
      { a: 'layer-m3', b: 'layer-f1' },
    ]

    const regions = computeSectionFill([left, middle, right], edges)

    expect(regions.length).toBeGreaterThan(0)
    // The SILT must appear as a lens overlay in BOTH gaps.
    const lenses = regions.filter((r) => r.kind === 'lens' && r.overlayTier === 'lens')
    expect(lenses.some((r) => r.gapIndex === 0)).toBe(true)
    expect(lenses.some((r) => r.gapIndex === 1)).toBe(true)

    writeGolden('lens_zero_corr', [left, middle, right], edges, regions)
  })
})

// ---------------------------------------------------------------------------
// Scenario 4 — reentrant_same_body
//
// A bodyId appearing TWICE on one column, above and below a different unit:
// Left:  SAND/body-9 (0–3 m), SILT/body-10 (3–5 m), SAND/body-9 (5–8 m),
//        CLAY/body-11 (8–10 m).
// Right: SAND/body-9 (0–8 m), CLAY/body-11 (8–10 m).
//
// Both left SAND occurrences carry an edge to the single right SAND, but the
// monotonic LCS can match the right unit only once — the golden pins WHICH
// occurrence wins and how the loser + the uncorrelated SILT (1 correlated
// contact via layer-g2 → kept, not lens-pulled) tile the remaining interval.
// ---------------------------------------------------------------------------

describe('reentrant_same_body golden', () => {
  it('produces regions for a re-entrant body column and writes the golden JSON', () => {
    const left: PartitionColumn = {
      investigationId: 'inv-G',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 3, formationId: 'SAND', bodyId: 'body-9', layerId: 'layer-g0' },
        { topDepthM: 3, baseDepthM: 5, formationId: 'SILT', bodyId: 'body-10', layerId: 'layer-g1' },
        // Second occurrence of body-9: re-entrant.
        { topDepthM: 5, baseDepthM: 8, formationId: 'SAND', bodyId: 'body-9', layerId: 'layer-g2' },
        { topDepthM: 8, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-11', layerId: 'layer-g3' },
      ],
    }
    const right: PartitionColumn = {
      investigationId: 'inv-H',
      surfaceElevM: 0,
      units: [
        { topDepthM: 0, baseDepthM: 8, formationId: 'SAND', bodyId: 'body-9', layerId: 'layer-h0' },
        { topDepthM: 8, baseDepthM: 10, formationId: 'CLAY', bodyId: 'body-11', layerId: 'layer-h1' },
      ],
    }
    const edges: CorrelationEdge[] = [
      { a: 'layer-g0', b: 'layer-h0' }, // left SAND first occurrence ↔ right SAND
      { a: 'layer-g2', b: 'layer-h0' }, // left SAND second occurrence ↔ right SAND
      { a: 'layer-g3', b: 'layer-h1' }, // CLAY ↔ CLAY
    ]

    const regions = computeSectionFill([left, right], edges)

    expect(regions.length).toBeGreaterThan(0)
    // Re-entrant body pins the output ordering — at least one quad must exist.
    expect(regions.some((r) => r.kind === 'quad')).toBe(true)

    writeGolden('reentrant_same_body', [left, right], edges, regions)
  })
})
