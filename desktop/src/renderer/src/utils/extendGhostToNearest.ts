// Pure helper for the right-click "Extend to nearest contacts" gesture
// on a manual ghost layer.
//
// Given the ghost's current state, an index into the suggestions array,
// the committed contacts on that anchor, and the investigation's max
// depth, computes new depth_top_m / depth_base_m by:
//
//   top    = max(contact.depth_top_m : contact < clicked_depth)  OR 0
//   bottom = min(contact.depth_top_m : contact > clicked_depth)  OR maxDepthM
//
// Then validates no overlap with other ghost suggestions on the same
// anchor.  Returns either the new ghost state or an error reason.
//
// ``useGeologicalModel.handleExtendLithoGhostToNearestContacts`` is a
// thin wrapper that feeds this transform through ``setGhostsByAnchor``.

import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'

/** Thin contact shape — only the fields this helper needs. */
interface CommittedContact {
  depth_top_m: number
}

/**
 * Extend ghost layer at ``idx`` to span between the nearest committed
 * contacts above and below its midpoint.
 *
 * Parameters
 * ----------
 * existing
 *     The anchor's current ghost state.
 * idx
 *     Index of the ghost layer to extend.
 * contactsOnAnchor
 *     Committed contacts for this anchor (depth_top_m values only).
 *     Need not be sorted — the helper sorts internally.
 * investigationMaxDepthM
 *     Maximum depth of the investigation in metres.  Used as the
 *     fallback bottom when no committed contact exists below.
 *
 * Returns
 * -------
 * ``{ ok: true, next: BulkAnchorGhost }`` on success, or
 * ``{ ok: false, reason: string }`` when the extension would overlap
 * another ghost suggestion on the same anchor.
 */
export function extendGhostToNearest(
  existing: BulkAnchorGhost,
  idx: number,
  contactsOnAnchor: readonly CommittedContact[],
  investigationMaxDepthM: number,
): { ok: true; reason?: undefined; next: BulkAnchorGhost } | { ok: false; reason: string; next?: undefined } {
  const layer = existing.suggestions[idx]
  if (layer === undefined) {
    return { ok: false, reason: `No ghost layer at index ${idx}` }
  }

  // Use the layer's midpoint as the reference depth for the neighbour
  // search.  For a freshly-created 0.01 m sentinel this equals depth_top;
  // for a partially-extended layer it is more natural than pure top.
  const refDepth = (layer.depth_top_m + layer.depth_base_m) / 2

  // Committed contacts sorted ascending.
  const sorted = [...contactsOnAnchor].sort((a, b) => a.depth_top_m - b.depth_top_m)

  // Nearest contact ABOVE (strictly less than refDepth).
  let newTop = 0
  for (const c of sorted) {
    if (c.depth_top_m < refDepth) newTop = c.depth_top_m
    else break
  }

  // Nearest contact BELOW (strictly greater than refDepth).
  let newBottom = investigationMaxDepthM
  for (const c of sorted) {
    if (c.depth_top_m > refDepth) {
      newBottom = c.depth_top_m
      break
    }
  }

  // Overlap check against other ghost suggestions on the same anchor.
  // A ghost overlaps when its effective range intersects [newTop, newBottom).
  // We use half-open intervals: [top, base) — two layers touching at an
  // exact shared boundary is NOT an overlap.
  for (let i = 0; i < existing.suggestions.length; i++) {
    if (i === idx) continue
    const other = existing.suggestions[i]
    const otherEdit = existing.edits.get(i)
    const otherTop = otherEdit?.depth_top_m ?? other.depth_top_m
    const otherBase = otherEdit?.depth_base_m ?? other.depth_base_m
    // Overlap: [newTop, newBottom) ∩ [otherTop, otherBase) is non-empty.
    // i.e.  newTop < otherBase  &&  newBottom > otherTop
    if (newTop < otherBase && newBottom > otherTop) {
      return {
        ok: false,
        reason: `Would overlap with existing suggestion at depth ${otherTop.toFixed(2)} m`,
      }
    }
  }

  // Build the updated ghost — only replace the target layer's depths.
  const nextSuggestions = existing.suggestions.map((s, i) =>
    i === idx
      ? { ...s, depth_top_m: newTop, depth_base_m: newBottom }
      : s,
  )

  // Clear any prior depth edits on this idx so they don't override the
  // freshly-extended bounds (the edit would win over the new raw values).
  const nextEdits = new Map(existing.edits)
  const priorEdit = nextEdits.get(idx)
  if (priorEdit !== undefined) {
    const { depth_top_m: _t, depth_base_m: _b, ...rest } = priorEdit
    if (Object.keys(rest).length > 0) {
      nextEdits.set(idx, rest)
    } else {
      nextEdits.delete(idx)
    }
  }

  return {
    ok: true,
    next: { ...existing, suggestions: nextSuggestions, edits: nextEdits },
  }
}
