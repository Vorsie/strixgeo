/**
 * Shared test fixture helpers for body-related component tests.
 *
 * Export a single ``makeBody`` factory so ``BodyContextMenu.test.tsx`` and
 * ``BodyExtentOverlay.test.tsx`` (and any future consumers) don't each
 * maintain a private copy of the default ``BodyListItem`` shape.
 */

import type { BodyListItem } from '../../../api/client'

/**
 * Build a ``BodyListItem`` with all extent fields defaulting to null.
 *
 * Parameters
 * ----------
 * overrides : Partial<BodyListItem>
 *     Fields to override on the default fixture shape.
 *
 * Returns
 * -------
 * BodyListItem
 *     A fully-typed body item suitable for component test props.
 */
export function makeBody(overrides: Partial<BodyListItem> = {}): BodyListItem {
  return {
    id: 'B1',
    app_project_id: 'p1',
    model_id: 'm1',
    formation_id: 'f1',
    body_ordinal: 0,
    source_investigation_id: 'inv-source',
    name: null,
    primary_section_id: null,
    content_key: null,
    extent_left_kind: null,
    extent_left_target_contact_id: null,
    extent_left_neighbour_inv_id: null,
    extent_right_kind: null,
    extent_right_target_contact_id: null,
    extent_right_neighbour_inv_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
