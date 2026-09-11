// Pure helper for debt #98 — split a pending litho ghost layer in two
// at its midpoint. The user reaches this via the per-layer right-click
// menu ("Split layer"); both halves inherit the original layer's
// effective composition (raw + any edit). The user then drag-resizes
// the new shared boundary and edits whichever half differs.
//
// Kept module-level + pure so the index-shift math has a tight unit
// test surface without rendering. ``useGeologicalModel.handleSplitLithoLayer``
// is a thin wrapper that applies this transform inside ``setGhostsByAnchor``.

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../hooks/useGeologicalModel'

/**
 * Split layer ``idx`` of ``ghost`` in two at its midpoint and shift
 * every index-keyed state by +1 above the split point.
 *
 * The upper half stays at ``idx`` (its ``depth_base_m`` is edited down
 * to the midpoint, preserving any existing lithology / admixture edits).
 * A new layer is inserted at ``idx + 1`` spanning [midpoint, base],
 * inheriting the upper half's EFFECTIVE composition — raw merged with
 * the edit. ``confidence`` becomes ``'high'`` and ``source`` becomes
 * ``'manual_pick'`` on the new layer (it is a user-created body, not a
 * segmenter output). ``spans_boundary`` is forced to ``false`` on the
 * new layer — if the original layer was a straddler the backend re-
 * resolves parent assignment at accept time (debt #87 extrapolation).
 *
 * Pure: returns a new ``BulkAnchorGhost`` — the caller passes it
 * through ``setGhostsByAnchor``.
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state.
 * idx
 *     The pending layer to split. Caller-enforced — the layer must be
 *     pending (the right-click menu is gated on this).
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     A new ghost with the layer split + indices shifted, or the SAME ghost
 *     (by identity) when ``idx`` is not on the column — the caller detects
 *     that identity and reports the refusal.
 */
export function splitLithoLayer(
  ghost: BulkAnchorGhost,
  idx: number,
): BulkAnchorGhost {
  // Refuse rather than throw (owner dogfeed 2026-09-11 — "a whole suggestion
  // disappeared"). A stale index — a menu click resolved against a ghost list
  // that has since been replaced or shortened — used to read
  // ``undefined.depth_top_m`` inside the setGhostsByAnchor updater, and a throw
  // there takes the whole stage down with it.
  if (ghost.suggestions[idx] === undefined) return ghost
  const raw = ghost.suggestions[idx]
  const edit = ghost.edits.get(idx)

  // Resolve the EFFECTIVE depths + composition of the layer being
  // split — the edit overrides raw, mirroring how the rect renders.
  const effectiveTop = edit?.depth_top_m ?? raw.depth_top_m
  const effectiveBase = edit?.depth_base_m ?? raw.depth_base_m
  const effectiveLitho = edit?.suggested_lithology ?? raw.suggested_lithology
  const effectiveAdmix = edit?.suggested_admixtures ?? raw.suggested_admixtures

  const midM = (effectiveTop + effectiveBase) / 2

  // The new lower-half layer carries the upper half's effective
  // composition by value (so a future edit to one half does not
  // accidentally update both).
  const newLayer: LithoLayerSuggestion = {
    depth_top_m: midM,
    depth_base_m: effectiveBase,
    suggested_lithology: effectiveLitho,
    suggested_admixtures: effectiveAdmix.map(a => ({ ...a })),
    suggested_nad_class: raw.suggested_nad_class,
    mean_qc_mpa: raw.mean_qc_mpa,
    dr_pct: raw.dr_pct,
    confidence: 'high',
    source: 'manual_pick',
    parent_formation_id: raw.parent_formation_id,
    // User-created body; parent gets re-resolved at accept time per #87.
    spans_boundary: false,
  }

  const newSuggestions = [
    ...ghost.suggestions.slice(0, idx + 1),
    newLayer,
    ...ghost.suggestions.slice(idx + 1),
  ]

  // Indices > idx shift by +1; indices ≤ idx are unchanged. idx itself
  // stays at idx (it became the upper half — same index, edited base).
  const shift = (i: number): number => (i > idx ? i + 1 : i)
  const newAccepted = new Set<number>()
  for (const i of ghost.accepted) newAccepted.add(shift(i))
  const newRejected = new Set<number>()
  for (const i of ghost.rejected) newRejected.add(shift(i))

  // Edits Map: shift keys above idx, then patch idx's edit to set
  // depth_base_m to the midpoint. Lithology / admixture / depth_top_m
  // edits on idx are preserved.
  const newEdits = new Map<number, LithoSuggestionEdit>()
  for (const [k, v] of ghost.edits) newEdits.set(shift(k), v)
  const priorIdxEdit = newEdits.get(idx) ?? {}
  newEdits.set(idx, { ...priorIdxEdit, depth_base_m: midM })

  return {
    ...ghost,
    suggestions: newSuggestions,
    accepted: newAccepted,
    rejected: newRejected,
    edits: newEdits,
  }
}
