/**
 * THE FILL SWEEP ACROSS FAMILIES (owner ruling 2026-08-21, option 3 of the
 * gap0_lens_dissolve_choice page — *"option 3 ofcourse"*, on top of *"yes one
 * mass one body"*): a closed lens touching a same-class mass from ANOTHER
 * litho family welds into it — in the renderer, and in the database through
 * the layer ids the welded region carries into the body-recompute evidence.
 *
 * The litho stage closed such a lens with no litho tie, so it is its own
 * family and the per-family merge can never reach it. This pass runs the SAME
 * weld (``mergeFaces``) over a whole gap's classed faces, keyed on the CLASS.
 * Faces from different family runs state their shared boundary at different
 * granularities (one long edge vs two split halves), so every ring is first
 * split at the other rings' vertices that lie on its edges — then the edge
 * census cancels exactly. A component that cannot close into one simple ring
 * keeps its faces (an honest mosaic beats a wrong outline), but still carries
 * the component's combined layer ids: the EVIDENCE welds even where the
 * outline cannot.
 *
 * @module utils/geotechHierarchicalFill/crossFamilyWeld
 */
import { mergeFaces } from './constructive/mergeFaces'
import type { SectionRegion } from '../sectionPartition'

/**
 * Point-to-segment distance below which a vertex lies ON the edge. Faces from
 * different family arrangements are quantised independently on the engine's
 * 1e-5 snap grid, so a lens tip sits up to a few grains off the neighbour's
 * line (measured: 3.3e-6 on the H12 scene, `0.33333` vs 1/3). The weld must
 * match at the grain the faces themselves disagree by; inserting a vertex
 * this close bends the edge by less than the snap the geometry already has.
 */
const ON_EDGE_EPS = 5e-5

type Pt = { fraction: number; elevation: number }

const vkey = (p: Pt): string =>
  `${Math.round(p.fraction * 1e7)}:${Math.round(p.elevation * 1e7)}`

/**
 * Insert, into each ring, the OTHER rings' vertices that lie on its edges, so
 * a boundary two faces share at different granularities cancels edge-for-edge.
 */
function splitAtSharedVertices(rings: readonly Pt[][]): Pt[][] {
  const pool: Pt[] = []
  const seen = new Set<string>()
  for (const ring of rings) {
    for (const p of ring) {
      const k = vkey(p)
      if (seen.has(k)) continue
      seen.add(k)
      pool.push(p)
    }
  }
  return rings.map((ring) =>
    ring.flatMap((a, i) => {
      const b = ring[(i + 1) % ring.length]
      const df = b.fraction - a.fraction
      const de = b.elevation - a.elevation
      const len2 = df * df + de * de
      if (len2 < 1e-18) return [a]
      const inserted: { t: number; p: Pt }[] = []
      for (const p of pool) {
        const t = ((p.fraction - a.fraction) * df + (p.elevation - a.elevation) * de) / len2
        if (t <= 1e-9 || t >= 1 - 1e-9) continue
        const fx = a.fraction + t * df
        const fe = a.elevation + t * de
        const d = Math.hypot(p.fraction - fx, p.elevation - fe)
        if (d < ON_EDGE_EPS) inserted.push({ t, p })
      }
      inserted.sort((x, y) => x.t - y.t)
      return [a, ...inserted.map((x) => x.p)]
    }),
  )
}

/**
 * Weld touching same-class faces across litho families, per gap.
 *
 * @param regions The classed faces of the whole section, any gap order.
 * @param classKeyOf Formation row → canonical class key (row id fallback).
 * @returns The swept regions and the number of welded components.
 */
export function weldAcrossFamilies(
  regions: readonly SectionRegion[],
  classKeyOf: (formationId: string) => string,
): { regions: SectionRegion[]; welds: number } {
  const byGap = new Map<number, SectionRegion[]>()
  for (const region of regions) {
    const list = byGap.get(region.gapIndex)
    if (list === undefined) byGap.set(region.gapIndex, [region])
    else list.push(region)
  }
  let welds = 0
  const out: SectionRegion[] = []
  for (const gapRegions of byGap.values()) {
    // Pre-split only where a weld is possible: keys carried by ≥2 faces.
    const byKey = new Map<string, number[]>()
    gapRegions.forEach((r, i) => {
      const key = classKeyOf(r.formationId)
      const list = byKey.get(key)
      if (list === undefined) byKey.set(key, [i])
      else list.push(i)
    })
    const rings = gapRegions.map((r) => r.polygon)
    for (const members of byKey.values()) {
      if (members.length < 2) continue
      const split = splitAtSharedVertices(members.map((i) => rings[i]))
      members.forEach((i, k) => {
        rings[i] = split[k]
      })
    }
    const merged = mergeFaces(
      gapRegions.map((region, i) => ({
        key: classKeyOf(region.formationId),
        label: region,
        ring: rings[i],
      })),
    )
    for (const entry of merged) {
      if (entry.members.length === 1) {
        // Untouched by the sweep — the original region, verbatim.
        out.push(entry.label)
        continue
      }
      const layerIds = [...new Set(entry.members.flatMap((m) => m.layerIds ?? []))].sort()
      if (entry.welded) {
        welds += 1
        out.push({
          gapIndex: entry.label.gapIndex,
          formationId: entry.label.formationId,
          bodyId: entry.label.bodyId,
          // A welded mass is a mass, not an overlay — never painted last.
          kind: 'quad',
          polygon: entry.ring,
          layerIds,
        })
      } else {
        // The outline could not close into one simple ring — the face stays,
        // but it carries the whole component's layer ids: the evidence welds
        // even where the outline cannot.
        out.push({ ...entry.label, layerIds })
      }
    }
  }
  return { regions: out, welds }
}
