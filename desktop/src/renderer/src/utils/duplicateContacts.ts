// How much does Dedupe delete?
//
// "Dedupe" removes formation contacts from the database, so per docs/ux.md
// ("Reversible vs irreversible") it has to confirm first — and a confirmation
// that cannot say how much it will destroy is barely a confirmation at all. The
// contact list the Stratigraphy stage already holds is the whole model's, which is
// the same set the server groups, so the number is knowable before the call.
//
// The grouping mirrors DeduplicateFormationContacts.execute
// (application/deduplicate_formation_contacts.py): key on (anchor, formation)
// where the anchor is the borehole OR the CPT, skip rows with neither, and count
// every member past the survivor. The two must agree or the dialog lies; if the
// server-side grouping ever changes, this changes with it.
//
// The count is a preview of a server-side decision, not a promise: the list here
// is as fresh as the last refresh. The toast after the run reports what actually
// went.

import type { FormationContactResponse } from '../api/clients/geology.types'

/** What one Dedupe run would remove, as seen from the loaded contact list. */
export interface DuplicateContactCount {
  /** Contacts that would be deleted — every pick past the survivor in its pair. */
  contacts: number
  /** Distinct (investigation, formation) pairs carrying at least one duplicate. */
  pairs: number
}

/**
 * Count the duplicate contacts in a geological model's contact list.
 *
 * Parameters
 * ----------
 * contacts : readonly FormationContactResponse[]
 *     The active geological model's contacts, model-wide — typically
 *     ``geoModel.contacts`` straight off the shell bus.
 *
 * Returns
 * -------
 * DuplicateContactCount
 *     How many contacts the cleanup would delete, and across how many
 *     (investigation, formation) pairs. Both are zero for a clean model.
 */
export function countDuplicateContacts(
  contacts: readonly FormationContactResponse[],
): DuplicateContactCount {
  const perPair = new Map<string, number>()
  for (const c of contacts) {
    // Anchor XOR: a contact hangs off a borehole or a CPT. A synthetic
    // pinch-out tip has neither and belongs to no pair — the server skips it,
    // so it can never be a duplicate here either.
    const anchor = c.borehole_id ?? c.cpt_id
    if (anchor == null) continue
    // The anchor flavour is part of the key: a borehole and a CPT are distinct
    // investigations even in the (impossible today, cheap to honour) case that
    // their ids collide.
    const flavour = c.borehole_id != null ? 'b' : 'c'
    const key = `${flavour}:${anchor}\u0000${c.formation_id}`
    perPair.set(key, (perPair.get(key) ?? 0) + 1)
  }

  let removed = 0
  let pairs = 0
  for (const members of perPair.values()) {
    if (members <= 1) continue
    removed += members - 1
    pairs += 1
  }
  return { contacts: removed, pairs }
}
