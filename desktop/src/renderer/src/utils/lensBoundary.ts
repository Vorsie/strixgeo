// Pure helpers for body-boundary shaping (#163f Slice 2 frontend, renamed Slice 5).
//
// Mirrors the backend geometry (lens_boundary_geometry.py) so the section
// overlay can render the wedge, and derives the body's pinch/top/base roles
// from its stable content_key + the correlation edges — no extra backend
// call needed. No React, no I/O.

import type { BodyBoundaryNode, BodyRenderStyle } from '../api/client'

// Backwards-compat aliases used by LensWedgeOverlay (renamed in slice 6).
type LensBoundaryNode = BodyBoundaryNode
type LensRenderStyle = BodyRenderStyle

/** Merge anchor endpoints + control nodes into one list sorted by along_m. */
function mergeSorted(
  anchors: readonly LensBoundaryNode[],
  nodes: readonly LensBoundaryNode[],
): LensBoundaryNode[] {
  return [...anchors, ...nodes].slice().sort((p, q) => p.along_m - q.along_m)
}

/** Expand a polyline into a midpoint staircase (the 'blocky' style). */
function stepify(points: readonly LensBoundaryNode[]): LensBoundaryNode[] {
  if (points.length < 2) return points.slice()
  const out: LensBoundaryNode[] = [points[0]]
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const mid = (a.along_m + b.along_m) / 2
    out.push({ along_m: mid, elevation_m: a.elevation_m })
    out.push({ along_m: mid, elevation_m: b.elevation_m })
    out.push({ along_m: b.along_m, elevation_m: b.elevation_m })
  }
  return out
}

/**
 * Renderable polyline for one body boundary, mirroring the backend.
 * ``straight`` / ``rounded`` return the merged points verbatim (the rounded
 * curve is applied at render time via d3); ``blocky`` returns the staircase.
 */
export function lensBoundaryPolyline(
  anchors: readonly LensBoundaryNode[],
  nodes: readonly LensBoundaryNode[],
  style: LensRenderStyle,
): LensBoundaryNode[] {
  const merged = mergeSorted(anchors, nodes)
  return style === 'blocky' ? stepify(merged) : merged
}

/** Split a lens content_key ('id|id|id') into its 3 sorted contact ids. */
export function parseContentKey(key: string | null | undefined): string[] {
  if (!key) return []
  return key.split('|')
}

export interface LensRoles {
  /** The pinch contact (joined by an edge to BOTH other defining contacts). */
  targetId: string
  /** The shallower of the two source contacts (the lens top). */
  aboveId: string
  /** The deeper of the two source contacts (the lens base). */
  belowId: string
}

/**
 * Derive a lens body's pinch/top/base roles from its three defining contact
 * ids + the correlation edges among them.
 *
 * The "target" (pinch point) is the contact joined by an edge to BOTH other
 * defining contacts; the remaining two are ordered by depth (shallower =
 * above/top, deeper = below/base). Returns ``null`` when no clean pinch
 * target exists (not the 1→2 lens topology).
 */
export function resolveLensRoles(
  contactIds: readonly string[],
  edges: readonly { a: string; b: string }[],
  depthByContact: ReadonlyMap<string, number>,
): LensRoles | null {
  if (contactIds.length !== 3) return null
  const idSet = new Set(contactIds)
  // For each candidate, the set of the OTHER defining contacts it is edged to.
  const linkedOthers = new Map<string, Set<string>>(contactIds.map(id => [id, new Set<string>()]))
  for (const e of edges) {
    if (!idSet.has(e.a) || !idSet.has(e.b)) continue
    linkedOthers.get(e.a)?.add(e.b)
    linkedOthers.get(e.b)?.add(e.a)
  }
  const targetId = contactIds.find(id => (linkedOthers.get(id)?.size ?? 0) >= 2)
  if (targetId === undefined) return null
  const rest = contactIds.filter(id => id !== targetId)
  if (rest.length !== 2) return null
  const [x, y] = rest
  const dx = depthByContact.get(x) ?? 0
  const dy = depthByContact.get(y) ?? 0
  const [aboveId, belowId] = dx <= dy ? [x, y] : [y, x]
  return { targetId, aboveId, belowId }
}
