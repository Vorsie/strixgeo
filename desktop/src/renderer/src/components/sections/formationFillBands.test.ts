/**
 * Stratigraphy-stage fill bands — the pinch-out wedge belongs to the unit that
 * disappears (owner ruling (b), 2026-10-14).
 *
 * Owner finding on the packaged 0.1.6 worked example, Stratigraphy stage,
 * GEO-25/021-S45 then GEO-07/181-S1: on S45 the column is Aangevuld / Quartair /
 * Formatie van Gent - Lid van Merelbeke / Formatie van Tielt; on S1 Quartair
 * lies directly on Tielt. The fill left the triangle between the Quartair base
 * and the Tielt top UNCOLOURED. Ruling: "the wedge is Merelbeke" — a unit
 * present on one test and absent on the next thins to zero AT the next test,
 * under the overlying unit's base; the overlying unit keeps its own base; the
 * wedge is never empty.
 *
 * Geometry is the real one: the contacts of the four Cross-section 2 columns
 * that carry stratigraphy (S23, S45, S1, S2) from the bundled worked example.
 */

import { describe, expect, it } from 'vitest'
import type { FormationSurfaceResponse } from '../../api/client'
import fixture from './__fixtures__/worked_example_s45_s1_merelbeke_2026-10-14.json'
import {
  buildFormationFillBands,
  type FormationFillBand,
  type FormationTopLine,
} from './formationFillBands'

const PX_PER_M_ALONG = 4
const PX_PER_M_LEVEL = 10
const TOP_LEVEL = 20
const PAD_PX = 20 * PX_PER_M_ALONG // ContactsLayer pads 20 m along the axis.

const QUARTAIR = '01a09c36-7cd9-79c6-ac6f-4d6b31f8df31'
const MERELBEKE = '01a09c36-7cdb-70b9-b2fc-4419eec4ecc3'
const TIELT = '01a09c36-7cdd-7475-81bf-3df3646214d6'
const S1_NAME = 'GEO-07/181-S1'

type Column = (typeof fixture.columns)[number]

const yAt = (level: number): number => (TOP_LEVEL - level) * PX_PER_M_LEVEL

/** Project the fixture's picks into one top polyline per formation. */
function linesFrom(columns: readonly Column[], xOf: (alongM: number) => number): FormationTopLine[] {
  return fixture.formations.map(f => ({
    formationId: f.id,
    color: f.color,
    vertices: columns.flatMap(col =>
      col.contacts
        .filter(c => c.formation_id === f.id)
        .map(c => ({ screenX: xOf(col.along_m), screenY: yAt(col.elevation_m - c.depth_top_m) })),
    ),
  }))
}

/** Every formation carries a fresh built surface (the worked example's state). */
const SURFACES = new Map<string, FormationSurfaceResponse>(
  fixture.formations.map(f => [
    f.id,
    { formation_id: f.id, is_stale: false, triangles: [[0, 1, 2]] } as unknown as FormationSurfaceResponse,
  ]),
)

function bands(columns: readonly Column[], xOf: (alongM: number) => number): FormationFillBand[] {
  return buildFormationFillBands({
    lines: linesFrom(columns, xOf),
    surfacesByFormationId: SURFACES,
    floor: yAt(-15),
    fillBufferPx: PAD_PX,
  })
}

/** Parse an ``M x y L x y … Z`` path into its vertices. */
function polygonOf(d: string): { x: number; y: number }[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
  return pts
}

/** Even-odd point-in-polygon. */
function inside(poly: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** The formations whose band covers the point (along m, level m). */
function formationsAt(
  out: readonly FormationFillBand[],
  xPx: number,
  level: number,
): string[] {
  return out.filter(b => inside(polygonOf(b.d), xPx, yAt(level))).map(b => b.formationId)
}

const col = (name: string): Column => {
  const c = fixture.columns.find(k => k.name === name)
  if (c === undefined) throw new Error(`fixture lacks ${name}`)
  return c
}
const levelOf = (name: string, formationId: string): number => {
  const c = col(name)
  const k = c.contacts.find(x => x.formation_id === formationId)
  if (k === undefined) throw new Error(`${name} lacks ${formationId}`)
  return c.elevation_m - k.depth_top_m
}

/**
 * A point inside the wedge, nearer S1: at 85 % of the way from S45 to S1,
 * halfway between the Quartair base (S45's Merelbeke top → S1's Tielt top)
 * and the Tielt top (S45 → S1).
 */
function wedgePoint(): { alongM: number; level: number } {
  const s45 = col('GEO-25/021-S45')
  const s1 = col(S1_NAME)
  const t = 0.85
  const alongM = s45.along_m + t * (s1.along_m - s45.along_m)
  const quartairBase =
    levelOf('GEO-25/021-S45', MERELBEKE) +
    t * (levelOf(S1_NAME, TIELT) - levelOf('GEO-25/021-S45', MERELBEKE))
  const tieltTop =
    levelOf('GEO-25/021-S45', TIELT) + t * (levelOf(S1_NAME, TIELT) - levelOf('GEO-25/021-S45', TIELT))
  return { alongM, level: (quartairBase + tieltTop) / 2 }
}

describe('Stratigraphy fill: the pinch-out wedge is the unit that disappears (owner ruling b, 2026-10-14)', () => {
  const forward = (alongM: number): number => alongM * PX_PER_M_ALONG
  // The mirror: the same section read right-to-left, so Merelbeke APPEARS on
  // the next test (S45) after being absent on S1.
  const mirrored = (alongM: number): number => (700 - alongM) * PX_PER_M_ALONG

  it('S45 → S1: the wedge between the Quartair base and the Tielt top is Merelbeke, never empty', () => {
    const { alongM, level } = wedgePoint()
    expect(formationsAt(bands(fixture.columns, forward), forward(alongM), level)).toEqual([MERELBEKE])
  })

  it('mirror (Merelbeke appears on the next test): its wedge grows from zero at S1, still Merelbeke', () => {
    const { alongM, level } = wedgePoint()
    expect(formationsAt(bands(fixture.columns, mirrored), mirrored(alongM), level)).toEqual([MERELBEKE])
  })

  it('Merelbeke thins to zero AT S1: just above the Tielt top on S1 is Quartair, not Merelbeke', () => {
    const s1 = col(S1_NAME)
    const out = bands(fixture.columns, forward)
    // 0.3 m above S1's Tielt top, a hair left of the S1 column.
    expect(formationsAt(out, forward(s1.along_m - 0.5), levelOf(S1_NAME, TIELT) + 0.3)).toEqual([QUARTAIR])
  })

  it('the overlying unit keeps its own base: above the wedge is Quartair', () => {
    const s45 = col('GEO-25/021-S45')
    const s1 = col(S1_NAME)
    const out = bands(fixture.columns, forward)
    const alongM = (s45.along_m + s1.along_m) / 2
    expect(formationsAt(out, forward(alongM), levelOf(S1_NAME, QUARTAIR) - 1)).toEqual([QUARTAIR])
  })

  it('guard: an outer pick with no test beyond keeps its flat 20 m pad (S23 to the left)', () => {
    const s23 = col('GEO-25/021-S23')
    const out = bands(fixture.columns, forward)
    const mid = (levelOf('GEO-25/021-S23', MERELBEKE) + levelOf('GEO-25/021-S23', TIELT)) / 2
    expect(formationsAt(out, forward(s23.along_m - 10), mid)).toEqual([MERELBEKE])
  })

  it('guard: a next test that never reached an older unit proves no absence — the flat pad stays', () => {
    // S1 without its Tielt pick (as if it stopped above Merelbeke's level):
    // nothing proves Merelbeke is absent there, so it keeps the 20 m pad
    // and does not pinch toward S1.
    const columns = fixture.columns.map(c =>
      c.name === S1_NAME ? { ...c, contacts: c.contacts.filter(k => k.formation_id !== TIELT) } : c,
    )
    const s45 = col('GEO-25/021-S45')
    const out = bands(columns, forward)
    const mid = (levelOf('GEO-25/021-S45', MERELBEKE) + levelOf('GEO-25/021-S45', TIELT)) / 2
    expect(formationsAt(out, forward(s45.along_m + 10), mid)).toEqual([MERELBEKE])
    expect(formationsAt(out, forward(s45.along_m + 40), mid)).not.toContain(MERELBEKE)
  })
})
