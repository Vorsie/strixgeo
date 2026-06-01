// Pure helpers for body-boundary shaping and per-side extent dispatch.
//
// Replaces lensBoundary.ts (renamed in Slice 6). Carries forward the
// boundary-polyline + content_key / lens-roles logic and adds the new
// per-side extent dispatch used by BodyExtentOverlay.
//
// No React, no I/O.

import type { BodyBoundaryNode, BodyRenderStyle } from '../api/client'

// ---------------------------------------------------------------------------
// Boundary polyline helpers (carried forward from lensBoundary.ts)
// ---------------------------------------------------------------------------

/** Merge anchor endpoints + control nodes into one list sorted by along_m. */
function mergeSorted(
  anchors: readonly BodyBoundaryNode[],
  nodes: readonly BodyBoundaryNode[],
): BodyBoundaryNode[] {
  return [...anchors, ...nodes].slice().sort((p, q) => p.along_m - q.along_m)
}

/** Expand a polyline into a midpoint staircase (the 'blocky' style). */
function stepify(points: readonly BodyBoundaryNode[]): BodyBoundaryNode[] {
  if (points.length < 2) return points.slice()
  const out: BodyBoundaryNode[] = [points[0]]
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
 * Renderable polyline for one body boundary, mirroring the backend geometry.
 *
 * ``straight`` / ``rounded`` return the merged points verbatim (the rounded
 * curve is applied at render time via Catmull-Rom); ``blocky`` returns the
 * staircase expansion.
 *
 * Parameters
 * ----------
 * anchors : readonly BodyBoundaryNode[]
 *     Fixed endpoint anchors (e.g. source + pinch endpoints).
 * nodes : readonly BodyBoundaryNode[]
 *     User-placed control nodes between the anchors.
 * style : BodyRenderStyle
 *     Boundary rendering style.
 *
 * Returns
 * -------
 * BodyBoundaryNode[]
 *     Sorted, style-applied polyline points.
 */
export function bodyBoundaryPolyline(
  anchors: readonly BodyBoundaryNode[],
  nodes: readonly BodyBoundaryNode[],
  style: BodyRenderStyle,
): BodyBoundaryNode[] {
  const merged = mergeSorted(anchors, nodes)
  return style === 'blocky' ? stepify(merged) : merged
}

// ---------------------------------------------------------------------------
// Content-key + lens-roles helpers (carried forward from lensBoundary.ts)
// ---------------------------------------------------------------------------

/** Split a body content_key ('id|id|id') into its 3 sorted contact ids. */
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
 *
 * Parameters
 * ----------
 * contactIds : readonly string[]
 *     The three contact ids forming the body's content_key.
 * edges : readonly { a: string; b: string }[]
 *     All approved correlation edges.
 * depthByContact : ReadonlyMap<string, number>
 *     depth_top_m per contact id (for above/below ordering).
 *
 * Returns
 * -------
 * LensRoles | null
 *     Resolved roles, or null if the topology is not 1→2.
 */
export function resolveLensRoles(
  contactIds: readonly string[],
  edges: readonly { a: string; b: string }[],
  depthByContact: ReadonlyMap<string, number>,
): LensRoles | null {
  if (contactIds.length !== 3) return null
  const idSet = new Set(contactIds)
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

// ---------------------------------------------------------------------------
// Per-side extent kind discriminant
// ---------------------------------------------------------------------------

/** The four recognised extent_<side>_kind values (lowercase, matches backend). */
export type ExtentKind = 'to_target' | 'pinch_out_halfway' | 'extrapolated' | 'open'

/**
 * Return true iff ``kind`` is a recognised ExtentKind value.
 *
 * Parameters
 * ----------
 * kind : string | null
 *     The raw extent_<side>_kind from the API.
 *
 * Returns
 * -------
 * boolean
 */
export function isExtentKind(kind: string | null | undefined): kind is ExtentKind {
  return (
    kind === 'to_target' ||
    kind === 'pinch_out_halfway' ||
    kind === 'extrapolated' ||
    kind === 'open'
  )
}
