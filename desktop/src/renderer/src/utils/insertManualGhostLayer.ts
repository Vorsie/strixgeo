// Pure helper for the left-click-creates-ghost UX shift.
//
// Inserts a zero-thickness manual-pick ghost layer into an anchor's
// BulkAnchorGhost at a given depth.  No index-shift is needed here
// because the new layer is APPENDED to the suggestions array and is
// always at a brand-new depth (it didn't exist before this click);
// the array is re-sorted by depth_top_m ascending so existing layers
// stay in order.
//
// ``useGeologicalModel.handleCreateManualLithoGhost`` is a thin wrapper
// that feeds this transform through ``setGhostsByAnchor``.

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'

/**
 * Insert a manual-pick ghost layer at ``depth_m`` into ``existing``.
 *
 * When ``existing`` is ``undefined`` (no prior ghost for this anchor),
 * a fresh BulkAnchorGhost is created with default empty accepted /
 * rejected / edits sets.
 *
 * The new layer always has:
 *   - ``depth_top_m = depth_m``
 *   - ``depth_base_m = depth_m + 0.01`` (smallest meaningful sentinel —
 *     the user extends it via "Extend to nearest contacts")
 *   - ``source = 'manual_pick'``
 *   - ``confidence = 'medium'``
 *
 * The suggestions array is re-sorted by ``depth_top_m`` ascending after
 * insertion so rendering order is consistent regardless of click order.
 *
 * Parameters
 * ----------
 * existing
 *     The anchor's current ghost state, or ``undefined`` when this is
 *     the first manual ghost placed on this anchor.
 * anchorKind
 *     ``'cpt'`` or ``'borehole'`` — used when creating a fresh
 *     BulkAnchorGhost from scratch.
 * surfaceElevationM
 *     Surface elevation in mTAW — required when creating a fresh entry
 *     so the ghost column can convert depth → mTAW for rendering.
 *     Ignored when ``existing`` is provided (its own elevation is kept).
 * depth_m
 *     Depth below surface in metres where the user clicked.
 * lithology
 *     Main soil code for the new layer (e.g. ``'ZAND'``, ``'KLEI'``).
 * admixtures
 *     Admixture list (may be empty).
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     A new BulkAnchorGhost with the manual layer appended and
 *     suggestions re-sorted by ``depth_top_m``.
 */
export function insertManualGhostLayer(
  existing: BulkAnchorGhost | undefined,
  anchorKind: 'cpt' | 'borehole',
  surfaceElevationM: number | null,
  depth_m: number,
  lithology: string,
  admixtures: readonly { soil_code: string; amount: string; locally: boolean }[],
): BulkAnchorGhost {
  const newLayer: LithoLayerSuggestion = {
    depth_top_m: depth_m,
    depth_base_m: depth_m + 0.01,
    suggested_lithology: lithology,
    suggested_admixtures: admixtures.map(a => ({ ...a })),
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'manual_pick',
    parent_formation_id: null,
    spans_boundary: false,
  }

  if (existing === undefined) {
    return {
      kind: anchorKind,
      surfaceElevationM,
      suggestions: [newLayer],
      accepted: new Set(),
      rejected: new Set(),
      edits: new Map(),
    }
  }

  // Append then re-sort so clicking at any depth stays ordered.
  const sorted = [...existing.suggestions, newLayer].sort(
    (a, b) => a.depth_top_m - b.depth_top_m,
  )

  return { ...existing, suggestions: sorted }
}
