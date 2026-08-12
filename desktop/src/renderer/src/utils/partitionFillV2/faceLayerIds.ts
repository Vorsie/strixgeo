/**
 * partitionFillV2/faceLayerIds.ts — resolve the ``litho_layer`` ids that PRODUCED a
 * labelled face's paint (``LabelledFace.layerIds``).
 *
 * Layer ids are the label-independent identity currency of the body recompute:
 * they never change, whereas ``bodyId`` is the label the recompute itself
 * rewrites — body-labelled evidence fed back on itself and oscillated in
 * production (facts flapping 74→3→69 live, dogfeed 2026-08-12 evening).
 *
 * The rule: a face's layers are the drilled units MATCHING the face's own
 * formation. A bounding unit of a DIFFERENT formation merely abuts the face —
 * it did not produce the paint, and naming it would state a false cross-litho
 * connectivity fact. Two sources are consulted:
 *
 *   - the bounding ``col<ci>:u<ui>`` unit refs (``LabelledFace.units``), and
 *   - on the seed path, ``col<ci>:lens<j>`` seed refs — the ruling-8r id-split
 *     gave an enclosed lens's sub-segment its own column edge, and the lens's
 *     minority unit was spliced out of ``col.units`` so only this form can
 *     resolve it.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ColumnGeom } from './sectionGeom'
import { COL_LENS_SEED_RE } from './seedClassifier'

/**
 * The deduped layer ids of the drilled units matching ``formationId`` among a
 * face's bounding unit refs (plus optional lens seed refs).
 *
 * Parameters
 * ----------
 * formationId : string
 *     The face's OWN formation — only same-formation units name their layer.
 * units : readonly { ci: number; ui: number }[]
 *     The bounding column-vertical unit refs (``LabelledFace.units``).
 * columns : readonly ColumnGeom[]
 *     The normalised columns the refs index into.
 * seedRefs : readonly string[], optional
 *     Seed-path refs; only the ``col<ci>:lens<j>`` form is consulted here (the
 *     ``col:u`` form is already covered by ``units``).
 *
 * Returns
 * -------
 * string[]
 *     Deduped layer ids in deterministic order (units sorted by (ci, ui), then
 *     seed refs in their sorted order). Empty when no drilled unit matches.
 */
export function faceLayerIds(
  formationId: string,
  units: readonly { ci: number; ui: number }[],
  columns: readonly ColumnGeom[],
  seedRefs?: readonly string[],
): string[] {
  const ids: string[] = []
  // Same (ci, ui) ordering as resolveLabel's bodyId pick, so the two stay aligned.
  const ordered = [...units].sort((a, b) => a.ci - b.ci || a.ui - b.ui)
  for (const { ci, ui } of ordered) {
    const u = columns[ci]?.units[ui]
    if (u && u.formationId === formationId && !ids.includes(u.layerId)) ids.push(u.layerId)
  }
  if (seedRefs) {
    for (const ref of seedRefs) {
      const ml = COL_LENS_SEED_RE.exec(ref)
      if (!ml) continue
      const el = columns[Number(ml[1])]?.enclosedLenses[Number(ml[2])]
      if (el && el.lens.formationId === formationId && !ids.includes(el.lens.layerId))
        ids.push(el.lens.layerId)
    }
  }
  return ids
}

/**
 * Assign ``layerIds`` on a labelled-face-shaped object: set when non-empty,
 * DELETED when empty (the absent-when-empty contract that keeps deep-equal pins
 * on layerless output byte-identical). Mutates and returns ``entry``.
 *
 * Parameters
 * ----------
 * entry : T
 *     The labelled face under construction (spreads may have inherited a stale
 *     ``layerIds`` from a base labelled under a different formation).
 * ids : string[]
 *     The freshly resolved layer ids for the entry's OWN formation.
 *
 * Returns
 * -------
 * T
 *     The same object, ``layerIds`` set or removed.
 */
export function withFaceLayerIds<T extends { layerIds?: string[] }>(entry: T, ids: string[]): T {
  if (ids.length > 0) entry.layerIds = ids
  else delete entry.layerIds
  return entry
}
