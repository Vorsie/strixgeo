/**
 * LITHO FAMILIES — the litho body as it appears in one section.
 *
 * The hierarchical fill runs the partition engine once per family, so a family
 * has to be exactly the thing the owner means by "a litho": the chain of litho
 * units that read as ONE mass on this section. Two facts make that chain:
 *
 *  1. an approved litho correlation joins two units — the engineer said they are
 *     the same body, which is the trustworthy signal the whole fill is built on;
 *  2. two units bound the SAME painted litho region — the engine already welded
 *     them (``SectionRegion.layerIds`` names only units of the region's OWN
 *     formation, so this can never weld a clay to a sand).
 *
 * Every litho region is then attributed to exactly one family, which is what
 * makes the families' clipped outputs tile without overlapping: the litho
 * partition is a true partition, and each of its faces belongs to one chain.
 *
 * A region the engine painted with no unit of its own formation bounding it
 * (substrate below every log, some flood faces) carries no ``layerIds`` and
 * cannot be attributed structurally. It is attributed to the nearest family OF
 * ITS OWN FORMATION on the gap's two columns — the same reach the engine used
 * when it chose that paint — and never to a family of another formation.
 *
 * @module utils/geotechHierarchicalFill/families
 */

import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

/** One litho body as it appears on this section. */
export interface LithoFamily {
  /** Stable id: the alphabetically first member layer id. */
  id: string
  /** Every litho ``layerId`` in the chain. */
  lithoLayerIds: ReadonlySet<string>
  /** The family's own litho regions, per gap index. */
  regionsByGap: ReadonlyMap<number, SectionRegion[]>
}

/** The family split of one section's litho frame. */
export interface LithoFamilySplit {
  families: LithoFamily[]
  /** Litho ``layerId`` → family id. */
  familyOfLithoLayer: ReadonlyMap<string, string>
  /** Regions no family could claim — rendered as bare litho, never classed. */
  unattributed: SectionRegion[]
}

/** Union-find over litho layer ids. */
class DisjointSet {
  private readonly parent = new Map<string, string>()

  find(x: string): string {
    let root = this.parent.get(x)
    if (root === undefined) {
      this.parent.set(x, x)
      return x
    }
    while (root !== this.parent.get(root)) root = this.parent.get(root) as string
    this.parent.set(x, root)
    return root
  }

  has(x: string): boolean {
    return this.parent.has(x)
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/**
 * Split a section's litho frame into families and attribute every region.
 *
 * @param lithoColumns The frame's columns, left to right.
 * @param lithoEdges The frame's APPROVED correlation edges.
 * @param lithoRegions The frame partition (the engine's own output).
 * @returns The families, the layer→family index, and the regions no family
 *   could claim.
 */
export function buildLithoFamilies(
  lithoColumns: readonly PartitionColumn[],
  lithoEdges: readonly CorrelationEdge[],
  lithoRegions: readonly SectionRegion[],
): LithoFamilySplit {
  const sets = new DisjointSet()
  // Seed with the drilled units only — an edge naming a layer that is not on
  // this section (edges are section-scoped but a stale row can survive) must
  // not invent a family.
  const formationOfLayer = new Map<string, string>()
  for (const column of lithoColumns) {
    for (const unit of column.units) {
      sets.find(unit.layerId)
      formationOfLayer.set(unit.layerId, unit.formationId)
    }
  }
  for (const edge of lithoEdges) {
    if (!sets.has(edge.a) || !sets.has(edge.b)) continue
    // SAME LITHOLOGY ONLY — the body resolver's own rule. The engineer draws
    // cross-soil correlations deliberately (a clay top tied to the sand that
    // replaces it laterally); such an edge states a CONTACT, not one body.
    // Welding across one chains the whole section into a single family —
    // measured on the owner's Cross-section 1: 67 of 142 units, three
    // lithologies, every column — and a family owning both a clay cover and a
    // sand cover is exactly the whole-section run this construction replaces.
    if (formationOfLayer.get(edge.a) !== formationOfLayer.get(edge.b)) continue
    sets.union(edge.a, edge.b)
  }
  for (const region of lithoRegions) {
    const ids = (region.layerIds ?? []).filter((id) => sets.has(id))
    for (let i = 1; i < ids.length; i++) sets.union(ids[0], ids[i])
  }

  // Canonical id per component: the alphabetically first member, so the family
  // ids do not depend on the order the server returned the rows in.
  const membersByRoot = new Map<string, string[]>()
  for (const column of lithoColumns) {
    for (const unit of column.units) {
      const root = sets.find(unit.layerId)
      const list = membersByRoot.get(root)
      if (list === undefined) membersByRoot.set(root, [unit.layerId])
      else list.push(unit.layerId)
    }
  }
  const idOfRoot = new Map<string, string>()
  for (const [root, members] of membersByRoot) {
    idOfRoot.set(root, [...members].sort()[0])
  }
  const familyOfLithoLayer = new Map<string, string>()
  for (const [root, members] of membersByRoot) {
    for (const member of members) familyOfLithoLayer.set(member, idOfRoot.get(root) as string)
  }

  // Unit geometry per layer, for the fallback attribution below.
  const unitAt = new Map<
    string,
    { formationId: string; midElev: number; columnIndex: number; topElev: number; baseElev: number }
  >()
  for (let ci = 0; ci < lithoColumns.length; ci++) {
    const column = lithoColumns[ci]
    for (const unit of column.units) {
      unitAt.set(unit.layerId, {
        formationId: unit.formationId,
        midElev: column.surfaceElevM - (unit.topDepthM + unit.baseDepthM) / 2,
        columnIndex: ci,
        topElev: column.surfaceElevM - unit.topDepthM,
        baseElev: column.surfaceElevM - unit.baseDepthM,
      })
    }
  }

  const regionsByFamily = new Map<string, Map<number, SectionRegion[]>>()
  const unattributed: SectionRegion[] = []
  const push = (familyId: string, region: SectionRegion): void => {
    let byGap = regionsByFamily.get(familyId)
    if (byGap === undefined) {
      byGap = new Map()
      regionsByFamily.set(familyId, byGap)
    }
    const list = byGap.get(region.gapIndex)
    if (list === undefined) byGap.set(region.gapIndex, [region])
    else list.push(region)
  }

  for (const region of lithoRegions) {
    // The named unit has to be WHERE THE REGION IS. ``layerIds`` names the drilled units that
    // produced a face's paint, but when the fill merged a same-formation sandwich into one host
    // (an enclosed interbed of another soil between them) the merged host keeps only the TOP
    // piece's id — so the LOWER piece's own cover comes back named after the upper one. On CS1
    // gap 5 that put a silt unit's cover into a chain whose only banded tests stand two gaps
    // away, and its class was painted from there instead of from its own two bands. So a named
    // unit is used only when its own extent actually meets the region's; otherwise the
    // geometric pick below answers, which is the same rule already used for an unnamed face.
    const named = (region.layerIds ?? [])
      .filter((id) => familyOfLithoLayer.has(id))
      .find((id) => {
        const unit = unitAt.get(id)
        if (unit === undefined) return true
        let lo = Infinity
        let hi = -Infinity
        for (const p of region.polygon) {
          if (p.elevation < lo) lo = p.elevation
          if (p.elevation > hi) hi = p.elevation
        }
        return Math.min(unit.topElev, hi) - Math.max(unit.baseElev, lo) > 0
      })
    if (named !== undefined) {
      push(familyOfLithoLayer.get(named) as string, region)
      continue
    }
    // No unit of its own formation bounds this face. Reach for the nearest one
    // ON THIS GAP'S TWO COLUMNS, of the SAME formation — never another soil.
    const centroid =
      region.polygon.reduce((sum, p) => sum + p.elevation, 0) / Math.max(1, region.polygon.length)
    let bestLayer: string | null = null
    let bestDistance = Infinity
    for (const [layerId, unit] of unitAt) {
      if (unit.formationId !== region.formationId) continue
      if (unit.columnIndex !== region.gapIndex && unit.columnIndex !== region.gapIndex + 1) continue
      const distance = Math.abs(unit.midElev - centroid)
      // Deterministic on a tie: the lower layer id wins.
      if (distance < bestDistance || (distance === bestDistance && bestLayer !== null && layerId < bestLayer)) {
        bestDistance = distance
        bestLayer = layerId
      }
    }
    if (bestLayer === null) {
      unattributed.push(region)
      continue
    }
    push(familyOfLithoLayer.get(bestLayer) as string, region)
  }

  const families: LithoFamily[] = []
  for (const [root, members] of membersByRoot) {
    const id = idOfRoot.get(root) as string
    families.push({
      id,
      lithoLayerIds: new Set(members),
      regionsByGap: regionsByFamily.get(id) ?? new Map(),
    })
  }
  families.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { families, familyOfLithoLayer, unattributed }
}
