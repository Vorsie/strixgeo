// Collapse a section's fence panels to ONE panel per connected body — Phase 7
// of debt #278, the fence follow-on (owner ruling 2026-08-31: "emit one panel
// per connected body per section").
//
// ``buildFencePanels`` emits one panel per REGION and there is one region per
// gap, so a body that spans N gaps is drawn as N panels meeting at N−1 vertical
// seams. On the owner's model that is 775-of-898 spurious seams — the geo-label
// twins of one connected body. This module regroups the section's panels by the
// body they belong to and welds each group into a single triangle soup.
//
// WHY THE RESOLVER IS PRIMARY AND THE LABEL IS THE FALLBACK. A panel's ``bodyId``
// is the fill-region LABEL. On the geotech (hierarchical) fill those labels are
// per-gap mints — the same connected mass carries a different label in each gap,
// so grouping on the label would merge nothing. The label-INDEPENDENT identity
// is the panel's ``layerIds`` resolved through ``litho_layer.body_id`` (the same
// authority ``regionBodyId.ts`` and the cutout filter use). So the caller passes
// a ``resolveBody`` closure and that is the grouping key. Only when no resolver
// is supplied do we fall back to ``formationId|bodyId`` label grouping — safe on
// the LITHO arm, whose labels ARE cross-gap consistent (``mergeTouchingBodies``),
// and used by the plain ``buildProjectFence`` callers (tests / non-scoped use).
//
// WHY WELDING MAKES THE SEAM VANISH. Fraction 1 of gap g and fraction 0 of gap
// g+1 are the SAME column's world point, and the two regions cut that column at
// the same snapped elevations, so the shared column edge's endpoints coincide
// (to floating-point round-off). Welding them to single indices makes the seam
// edge index-shared by triangles from BOTH gaps — which is exactly what the DXF
// exporter marks invisible (index-shared interior edge) and what removes the
// on-screen hairline. Genuinely disjoint parts of one body (no shared vertices)
// stay in the SAME panel as two triangle islands: consumers treat a panel as a
// triangle soup, so one panel is the simplest faithful output (brief D7).

import type { FencePanel } from './fencePanels'

/**
 * Weld tolerance in project-CRS metres (0.1 mm).
 *
 * Deliberately FINER than the section fill's 1 mm snap grid, so two genuinely
 * distinct cut points (≥ 1 mm apart) never fuse, while the same column point
 * computed from two adjacent gaps (which differ only by floating-point
 * round-off, ~1e-8 m) always does.
 */
const WELD_TOLERANCE_M = 1e-4

/** A merge group: the panels of one body and the body id the merged wall carries. */
interface PanelGroup {
  /** Grouping key — a resolved body, a label, or a unique unmergeable token. */
  key: string
  /** Body id stamped on the merged panel (resolved body, or the label's body). */
  bodyId: string | null
  members: FencePanel[]
}

/**
 * Merge a section's fence panels so each connected body renders as ONE panel.
 *
 * Panels are grouped by body and each multi-member group is welded into a
 * single panel; lone groups (and unresolved panels) pass through by identity so
 * the common one-region-per-body case is untouched. Group order follows the
 * first appearance of each body in ``panels`` (render order preserved).
 *
 * Parameters
 * ----------
 * panels : readonly FencePanel[]
 *     One section's panels, as ``buildFencePanels`` produced them (one per gap).
 * resolveBody : optional
 *     ``layerIds → body id | null`` — the label-independent identity. Supplied
 *     by the scoped call sites (backed by ``resolveRegionBodyId`` + the axis's
 *     ``litho_layer id → body_id`` map). A panel whose layers resolve to ``null``
 *     NEVER merges: ``null`` means "no body identity", not "same body". When
 *     omitted, grouping falls back to the ``formationId|bodyId`` label (and a
 *     ``null`` label likewise never merges).
 *
 * Returns
 * -------
 * FencePanel[]
 *     One panel per connected body per section. A merged panel carries the
 *     ``formationId`` of its FIRST member (render order → deterministic), the
 *     resolved (or label) ``bodyId``, and the UNION of its members' ``layerIds``.
 *
 *     ⚠ KNOWN LIMITATION — the single-``formationId`` stamp. A resolved body's
 *     panels do NOT always share one formation: ``crossFamilyWeld`` already welds
 *     a closed lens into a same-class mass from ANOTHER litho family and carries
 *     the combined layer ids into the body-recompute evidence (owner's "one mass
 *     one body" / option-3 ruling 2026-08-21), so a body's panels can span two
 *     litho families whose regions each keep one member's formationId. Merging
 *     extends that single first-member stamp across the whole connected body, and
 *     everything that keys off a panel's ``formationId`` — the unit-scope cutout
 *     filter, the legend's "walled" mark, the DXF layer name — then credits only
 *     that one formation for the merged wall. Flagged to the owner alongside the
 *     standing ``crossFamilyWeld`` eyeball item ("only same litho parents can be
 *     joined"): the body-identity question is being settled as a whole (debt
 *     #278 ruling 2 — a body crossing formations LISTS both), and until it is,
 *     grouping purely by resolved body is the brief's instruction.
 */
export function mergeFencePanels(
  panels: readonly FencePanel[],
  resolveBody?: (layerIds: readonly string[] | undefined) => string | null,
): FencePanel[] {
  // Nothing can merge below two panels — return as-is (identity preserved).
  if (panels.length <= 1) return [...panels]

  const groups: PanelGroup[] = []
  const byKey = new Map<string, PanelGroup>()
  let unmergeableCount = 0

  for (const panel of panels) {
    // The grouping decision: resolver first, label fallback second. The key is
    // computed only in the mergeable branch — the unmergeable branch mints its
    // own unique key below, so there is nothing to key it by here.
    const resolved = resolveBody ? resolveBody(panel.layerIds) : null
    const mergeable = resolveBody ? resolved !== null : panel.bodyId !== null
    const bodyId = resolveBody ? (resolved ?? panel.bodyId) : panel.bodyId

    if (!mergeable) {
      // A unique key so this panel is its own group and passes through untouched.
      groups.push({ key: `unmerged:${unmergeableCount++}`, bodyId, members: [panel] })
      continue
    }

    const key = resolveBody ? `body:${resolved}` : `label:${panel.formationId}|${panel.bodyId}`
    const existing = byKey.get(key)
    if (existing) {
      existing.members.push(panel)
    } else {
      const group: PanelGroup = { key, bodyId, members: [panel] }
      byKey.set(key, group)
      groups.push(group)
    }
  }

  return groups.map(group =>
    group.members.length === 1 ? group.members[0] : mergeGroup(group.members, group.bodyId),
  )
}

/**
 * Weld one body's panels into a single triangle-soup panel.
 *
 * Vertices within {@link WELD_TOLERANCE_M} of an already-emitted vertex reuse
 * its index (so the shared column seam becomes index-shared); triangles are
 * concatenated with their indices remapped. A spatial hash on the tolerance
 * grid keeps the weld near-O(n) — each vertex only probes its own cell and the
 * 26 neighbours, which is every cell a within-tolerance match could sit in.
 */
function mergeGroup(members: readonly FencePanel[], bodyId: string | null): FencePanel {
  const vertices: [number, number, number][] = []
  const triangles: [number, number, number][] = []
  const layerIds = new Set<string>()
  // Tolerance-grid cell key → indices of the vertices that fall in it.
  const cellIndex = new Map<string, number[]>()

  for (const member of members) {
    const remap = member.vertices.map(v => weldVertex(v, vertices, cellIndex))
    for (const [a, b, c] of member.triangles) {
      const t: [number, number, number] = [remap[a], remap[b], remap[c]]
      // Drop a triangle whose corners welded onto fewer than 3 distinct indices:
      // it has collapsed to zero area and would only ship a degenerate to the
      // renderer / DXF. Cheap insurance — today's ≥ 1 mm real-point spacing keeps
      // a triangle's own corners well outside the 0.1 mm weld tolerance, but a
      // future snap-grid change must not leak zero-area triangles downstream.
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue
      triangles.push(t)
    }
    for (const layerId of member.layerIds ?? []) layerIds.add(layerId)
  }

  return {
    // First member in render order (deterministic). See the public docstring's
    // KNOWN LIMITATION: a cross-family-welded body spans two formations, and this
    // stamps the whole merged wall with just this one.
    formationId: members[0].formationId,
    bodyId,
    layerIds: layerIds.size > 0 ? [...layerIds] : undefined,
    vertices,
    triangles,
  }
}

/** Integer tolerance-grid cell of one coordinate axis. */
function cellOf(value: number): number {
  return Math.floor(value / WELD_TOLERANCE_M)
}

/**
 * Return the index of the pooled vertex within tolerance of ``v``, adding ``v``
 * to the pool (and the spatial hash) when there is none.
 *
 * Determinism: among all in-tolerance candidates the LOWEST index wins, so the
 * remap does not depend on cell-iteration order.
 */
function weldVertex(
  v: readonly [number, number, number],
  pool: [number, number, number][],
  cellIndex: Map<string, number[]>,
): number {
  const cx = cellOf(v[0])
  const cy = cellOf(v[1])
  const cz = cellOf(v[2])

  let match = -1
  // A within-tolerance vertex differs by ≤ one cell per axis, so the 3×3×3 block
  // around v's cell contains every candidate. Single-linkage to the pool: v
  // snaps to the FIRST pooled point within tolerance, so a chain of near-points
  // can fuse pairs up to ~2× tolerance apart via a shared earlier pool point — a
  // non-issue here, real cut points sit ≥ the 1 mm fill grid apart, an order of
  // magnitude above the 0.1 mm tolerance.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = cellIndex.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (!bucket) continue
        for (const i of bucket) {
          const p = pool[i]
          if (Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) <= WELD_TOLERANCE_M) {
            if (match === -1 || i < match) match = i
          }
        }
      }
    }
  }
  if (match !== -1) return match

  const index = pool.length
  pool.push([v[0], v[1], v[2]])
  const key = `${cx},${cy},${cz}`
  const bucket = cellIndex.get(key)
  if (bucket) bucket.push(index)
  else cellIndex.set(key, [index])
  return index
}
