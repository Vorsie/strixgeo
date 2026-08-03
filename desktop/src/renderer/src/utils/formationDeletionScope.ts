/**
 * Which formations an "overwrite" Fill run would remove.
 *
 * Exists so the confirmation the engineer sees can NAME the units that die.
 * "Removes 4 units" is not a decision they can make; "removes Boom Klei,
 * Formatie van Diest, …" is.
 *
 * The rule mirrors the server's delete pass in
 * ``auto_populate_contacts_from_stratigraphy`` exactly:
 *
 *   * candidate iff the formation has at least one contact in THIS model —
 *     ``GeologicalFormation`` is a project-wide vocabulary shared by the
 *     geological / litho / geotech sibling models, so a formation that only
 *     appears in a sibling model is invisible to the delete and must not be
 *     named here either;
 *   * doomed iff its stable key is NOT in the selection, compared through the
 *     same normalisation the server uses (see ``formationKey``).
 */

import { formationStableKey, normaliseFormationKey } from './formationKey'

/** A formation the confirmation dialog needs to name. */
export interface DoomedFormation {
  /** Formation id — stable handle for keys / test assertions. */
  id: string
  /** Display name — what the engineer actually reads. */
  name: string
}

/**
 * Compute the formations an overwrite would delete.
 *
 * @param formations - Every formation in the project (the model filter comes
 *   from `contacts`, not from this list).
 * @param contacts - Contacts of the model being filled. Only formations
 *   referenced here are in the server's delete scope.
 * @param selectedKeys - Stable candidate keys the user chose to keep.
 * @returns The doomed formations, in `formations` order. Empty when the run is
 *   a pure addition — the caller then applies without asking anything.
 */
export function computeDoomedFormations(
  formations: readonly { id: string; name: string; regional_ref?: string | null }[],
  contacts: readonly { formation_id: string }[],
  selectedKeys: ReadonlySet<string>,
): DoomedFormation[] {
  const selected = new Set<string>()
  for (const key of selectedKeys) selected.add(normaliseFormationKey(key))
  const inThisModel = new Set(contacts.map(c => c.formation_id))
  return formations
    .filter(f => inThisModel.has(f.id) && !selected.has(formationStableKey(f)))
    .map(f => ({ id: f.id, name: f.name }))
}
