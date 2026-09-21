/**
 * Shared builders for the PartitionFillOverlay test scene.
 *
 * Every ``PartitionFillOverlay.*.test.tsx`` (and ``unifiedLithoHandle.rules``,
 * ``conflictKeys``) hand-rolled a near-identical ``layer()`` → ``LithoLayerResponse``
 * and ``column()`` → ``PlacedColumn``. Two clashing all-``string`` positional
 * orders were in circulation — ``(id, inv, bodyId, formationId, top, base)`` and
 * ``(id, inv, formationId, top, base, bodyId)`` — which ``tsc`` cannot tell apart,
 * so a fixture line ported between files silently swapped ``body_id`` and
 * ``formation_id`` and still type-checked. These builders take an OVERRIDES OBJECT,
 * so the swap can no longer happen: a mislabelled key is a compile error, and an
 * omitted key falls back to a named default rather than the wrong positional slot.
 *
 * Extracted per the KonMari duplication inventory family #1 (debt #275); direct
 * precedent ``correlationOverlayScene.tsx`` in this same folder ("extracted when
 * the second test file needed it").
 *
 * The defaults reproduce, field for field, what the per-file builders hard-coded:
 * an accepted / manual / high-confidence BOREHOLE layer, 0–10 m, and a borehole
 * column whose screen x equals its along-position. The only fields that ever
 * varied between the old copies were ``model_id`` and the ``created_at`` /
 * ``updated_at`` stamps, neither of which ``PartitionFillOverlay`` reads and
 * neither of which any of those suites asserts — so a single default is safe.
 */

import type { LithoLayerResponse } from '../../../api/client'
import type { PlacedColumn } from '../utils'

/**
 * Overrides for {@link layer}. The friendly keys map onto the awkward
 * ``LithoLayerResponse`` field names; any raw field of the response may also be
 * passed through (e.g. ``status``, ``cpt_id``, ``notes``) and wins over the default.
 */
export interface LayerOverrides extends Partial<LithoLayerResponse> {
  /** The column the layer belongs to — written to ``borehole_id`` (this scene is all boreholes). */
  investigationId?: string
  /** Formation the layer resolves to — written to ``formation_id``. */
  formationId?: string
  /** Body the resolver over-lumps the layer into — written to ``body_id``. */
  bodyId?: string
  /** Top of the layer, metres below collar — written to ``depth_top_m``. */
  depthTopM?: number
  /** Base of the layer, metres below collar — written to ``depth_base_m``. */
  depthBaseM?: number
}

/**
 * Build a ``LithoLayerResponse`` row for the partition-fill scene.
 *
 * @param overrides - Named fields to set; everything else takes the scene default.
 * @returns A fully-populated ``LithoLayerResponse`` (fields absent from the type's
 *   optional surface are supplied via the cast, exactly as the old per-file builders did).
 */
export function layer(overrides: LayerOverrides = {}): LithoLayerResponse {
  const { investigationId, formationId, bodyId, depthTopM, depthBaseM, ...rest } = overrides
  return {
    id: 'l1',
    model_id: 'm1',
    formation_id: formationId ?? 'fSand',
    borehole_id: investigationId ?? 'L',
    cpt_id: null,
    depth_top_m: depthTopM ?? 0,
    depth_base_m: depthBaseM ?? 10,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId ?? 'b1',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...rest,
  } as LithoLayerResponse
}

/** Overrides for {@link column}. */
export interface ColumnOverrides {
  /** Investigation id written to ``proj.item.id``. */
  investigationId?: string
  /** Along-section position (metres) — sets ``proj.along`` and, by default, the screen x. */
  along?: number
  /** Collar elevation written to ``proj.item.elevation_m``. */
  elevationM?: number
  /** Column kind; the scene is boreholes unless a test says otherwise. */
  kind?: PlacedColumn['kind']
  /** Screen x after nudging; defaults to ``along`` (no displacement). */
  nudgedX?: number
  /** Un-nudged screen x; defaults to ``nudgedX``. */
  trueX?: number
  /** Column width in px. */
  width?: number
  /** Whether the column was pushed off its true x to avoid an overlap. */
  displaced?: boolean
}

/**
 * Build a ``PlacedColumn`` for the partition-fill scene: a borehole whose screen x
 * equals its along-position, collar at ``elevationM``.
 *
 * @param overrides - Named fields to set; everything else takes the scene default.
 * @returns A ``PlacedColumn`` populated with the fields these suites exercise (cast,
 *   as the old per-file builders were).
 */
export function column(overrides: ColumnOverrides = {}): PlacedColumn {
  const {
    investigationId = 'L',
    along = 0,
    elevationM = 10,
    kind = 'borehole',
    nudgedX = along,
    trueX = nudgedX,
    width = 40,
    displaced = false,
  } = overrides
  return {
    kind,
    nudgedX,
    trueX,
    width,
    displaced,
    proj: { along, offset: 0, item: { id: investigationId, elevation_m: elevationM } },
  } as unknown as PlacedColumn
}
