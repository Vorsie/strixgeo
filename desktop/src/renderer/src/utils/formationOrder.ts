/**
 * Formation list ordering helpers.
 *
 * ``display_order`` is the age axis: lower = older = deeper in the
 * stratigraphic column. Renderers paint ASCENDING (older first, younger on
 * top — the geological superposition rule). But list presentations that the
 * engineer reads like a borehole log / stratigraphic column show YOUNGEST
 * first (surface at the top, oldest at depth) — the GeologyInspector list, the
 * 3D ``Layers`` legend, and the click-to-place formation picker all share this
 * reading order. This helper is the single source of that descending order so
 * the three stay in sync.
 */

import type { GeologicalFormationResponse } from '../api/client'

/**
 * Return a copy of *rows* ordered youngest-first (descending ``display_order``).
 *
 * Mirrors ``GeologyInspector``'s "sort ascending, then reverse": formations are
 * first ordered ascending by ``display_order`` (name as a stable tiebreak),
 * then reversed, so equal-``display_order`` rows fall in the same order the
 * inspector shows. Pure — does not mutate the input.
 *
 * @param rows - Formations in any order (the model bus delivers ascending).
 * @returns A new array, youngest formation first.
 */
export function formationsYoungestFirst<T extends GeologicalFormationResponse>(
  rows: readonly T[],
): T[] {
  return [...rows]
    .sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    .reverse()
}
