// Pure helpers for the one-contact-per-formation-per-test rule (walker finding
// 2026-10-12). The backend's CreateFormationContact refuses a second contact
// for the same (model, anchor, formation) with a 409; every 409 prints
// Chromium's "Failed to load resource" console line, so the renderer checks
// the rule against its loaded contacts and never sends a POST it knows the
// backend refuses.

import type { FormationContactResponse } from '../api/client'

/** The anchor + formation a create request would occupy. */
export interface ContactSlot {
  formation_id: string
  borehole_id: string | null
  cpt_id: string | null
}

/**
 * Find the contact that already occupies a create request's slot.
 *
 * A slot is one formation on one test (borehole OR CPT). A synthetic contact
 * (no anchor) never occupies a slot, and a request without an anchor never
 * matches one.
 *
 * @param contacts - The loaded contacts of the model the request targets.
 * @param slot - The formation + anchor of the request.
 * @returns The occupying contact, or ``undefined`` when the slot is free.
 */
export function findContactInSlot(
  contacts: Iterable<FormationContactResponse>,
  slot: ContactSlot,
): FormationContactResponse | undefined {
  if (slot.borehole_id === null && slot.cpt_id === null) return undefined
  for (const c of contacts) {
    if (c.formation_id !== slot.formation_id) continue
    if (slot.borehole_id !== null && c.borehole_id === slot.borehole_id) return c
    if (slot.cpt_id !== null && c.cpt_id === slot.cpt_id) return c
  }
  return undefined
}
