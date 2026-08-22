// Soil-level dissolve for the geotech axis's litho outline pass.
//
// Owner ruling 2026-08-13 put the litho frame on the geotech axis as dark
// outlines ("litho boundaries persist"); drawing every region's FULL ring
// also painted the machine partition's internal seams — the boundary between
// two touching same-soil litho units, an onlap's diagonal, a termination
// fan — as near-black lines indistinguishable from real litho contacts.
// Owner dogfeed 2026-08-18: "weird ass horizontal black lines without
// meaning to the user". The outline is a SOIL boundary, so an edge draws
// only when the soil actually changes across it (or nothing sits on the
// other side — the frame's outer envelope).
//
// Edge matching relies on the v2 arrangement's guarantee that adjacent
// regions share their cut vertices verbatim (T-junctions are split with
// shared points), so a seam appears as identical segments in both rings.
import type { SectionRegion } from './partitionFill'

/** One outline segment to draw, in gap-fraction × elevation space. */
export interface OutlineSegment {
  gapIndex: number
  a: { fraction: number; elevation: number }
  b: { fraction: number; elevation: number }
}

/** Vertex quantum for edge identity — well under the engine's 1 mm snap. */
const KEY_DECIMALS = 6

/**
 * How close to a gap's own edge a VERTICAL segment must be to count as
 * lying on the column line rather than inside the ground.
 *
 * Exact equality is wrong: the v2 arrangement snaps its vertices, so a
 * gap's column edges land a hair inside it rather than at exactly 0 and 1.
 * MEASURED on the owner's real model, all 14 sections: of 465 vertical
 * outline segments, 464 sit at a column edge with a worst offset of
 * 1.228e-3, and the ONE genuine interior vertical sits at fraction 0.5 —
 * the law's own mid-gap "two statements meet" seam. This threshold sits 8×
 * above the worst column offset and 50× below that seam.
 */
const COLUMN_LINE_FRACTION_EPS = 0.01

interface EdgeOwners {
  gapIndex: number
  a: { fraction: number; elevation: number }
  b: { fraction: number; elevation: number }
  soils: (string | null)[]
  nonLensCount: number
}

/**
 * Compute the litho outline segments after the soil-level dissolve.
 *
 * Rules, per gap:
 * - an edge shared by two regions of the SAME soil dissolves (internal seam);
 * - an edge shared by regions of DIFFERENT soils draws once (real contact);
 * - a single-owner edge draws (outer envelope) — unless its only owner is a
 *   lens (a lens outline reads as a lithology boundary it is not; its real
 *   boundary shows via the enclosing ring when the soils differ);
 * - ``null`` soil never equals anything, itself included — when the soil is
 *   unknown the honest render is the line, not the dissolve.
 */
export function lithoOutlineEdges(
  regions: readonly SectionRegion[],
  soilByFormationId: ReadonlyMap<string, string | null>,
): OutlineSegment[] {
  const edges = new Map<string, EdgeOwners>()
  const keyOf = (p: { fraction: number; elevation: number }): string =>
    `${p.fraction.toFixed(KEY_DECIMALS)},${p.elevation.toFixed(KEY_DECIMALS)}`

  for (const r of regions) {
    const soil = soilByFormationId.get(r.formationId) ?? null
    const isLens = r.kind === 'lens'
    const n = r.polygon.length
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i]
      const b = r.polygon[(i + 1) % n]
      const ka = keyOf(a)
      const kb = keyOf(b)
      if (ka === kb) continue // zero-length (snap debris)
      // A COLUMN IS NOT A CONTACT (owner, 2026-08-22, on gap 0: *"there is a
      // black line between the SF silt on column 0 and the quad to the right
      // of it"*). An edge lying on a column line has only one owner here — the
      // neighbouring gap is keyed separately, and the test's own card is not
      // in this pass at all — so it read as outer envelope and drew a line
      // through ground that simply continues onto the card.
      //
      // The test is PROXIMITY, not equality (owner, same day: *"when i turn
      // on the fill there is a black vertical line top to bottom on the left
      // of every column"*). The first version asked for exactly 0 or 1 and
      // the v2 arrangement's snap puts a gap's column edges a hair inside it
      // — 4.9e-5 on his CS1 — so every column vertical sailed past the guard
      // and drew, stacking contiguously into one line per column edge. See
      // {@link COLUMN_LINE_FRACTION_EPS} for the measurement.
      if (Math.abs(a.fraction - b.fraction) < 1e-9) {
        const onColumn =
          Math.abs(a.fraction) < COLUMN_LINE_FRACTION_EPS ||
          Math.abs(a.fraction - 1) < COLUMN_LINE_FRACTION_EPS
        if (onColumn) continue
      }
      const key = ka < kb ? `${r.gapIndex}|${ka}|${kb}` : `${r.gapIndex}|${kb}|${ka}`
      const owners = edges.get(key)
      if (owners) {
        owners.soils.push(soil)
        if (!isLens) owners.nonLensCount++
      } else {
        edges.set(key, { gapIndex: r.gapIndex, a, b, soils: [soil], nonLensCount: isLens ? 0 : 1 })
      }
    }
  }

  const out: OutlineSegment[] = []
  for (const e of edges.values()) {
    if (e.nonLensCount === 0) continue
    if (e.soils.length >= 2) {
      const first = e.soils[0]
      const allSame = first !== null && e.soils.every((s) => s === first)
      if (allSame) continue
    }
    out.push({ gapIndex: e.gapIndex, a: e.a, b: e.b })
  }
  return out
}
