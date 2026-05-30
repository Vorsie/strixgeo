"""Backfill litho_layer rows from existing FormationContact rows on litho models.

A2.5 of the unified litho boundary model
(spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).

The FE re-shape in A3 swaps ``lithoContacts`` for ``lithoLayers`` — but
all existing per-project litho data lives in ``formation_contact`` today.
This migration moves it across **with preserved UUIDs** so:

* every ``litho_correlation_edge.contact_a_id / contact_b_id`` continues
  to resolve as a layer-top boundary (no edge-table rewrite needed in A3)
* every ``cross_section.seeded_formation_contact_ids`` UUID array
  continues to point at something visible (the layer at that top)
* every ``formation_contact.parent_geo_contact_id`` couple survives
  (mirrored onto the matching layer row)

Boundary derivation
-------------------
A FormationContact carries only ``depth_top_m`` — its base is implied
by the next contact at the same anchor in the same model. The window
function partitions by ``(model_id, COALESCE(borehole_id, cpt_id))`` —
the XOR CHECK on the source table guarantees exactly one of those is
non-null, so the coalesce picks the anchor cleanly.

For the **last** contact at an anchor, ``LEAD`` returns NULL and we
fall back to the anchor's total depth (``borehole.total_depth_m`` /
``cpt.max_depth_m``). If even that's NULL or sits at the same depth as
the contact, we use ``depth_top_m + 1.0`` as a safe sentinel so the
``litho_layer_depth_ordered`` CHECK (``top < base``) is never violated.

Skipped rows
------------
Synthetic pinch-out contacts (``borehole_id`` AND ``cpt_id`` both NULL,
carrying ``synthetic_x/y/elevation_m``) are skipped — the litho_layer
schema requires an anchor (XOR CHECK). Litho pinch-outs are deferred
to debt #131-b; until then they don't fit Shape A and there's nothing
to migrate.

Source mapping
--------------
``FormationContact.source`` enum → ``LithoLayer.source`` whitelist:

* ``'borehole_observation'`` → ``'observation_layer'``
* anything else (``'manual_pick'``, ``'interpolated'``,
  ``'geological_model_seed'``) → ``'manual'`` — the user has at some
  point accepted these (they're committed contacts), and the litho
  source enum has no closer match.

Idempotency
-----------
``ON CONFLICT (id) DO NOTHING`` — re-running the migration is safe.
The forward sweep is the only direction that ships data; downgrade
removes only the rows this migration could have created.
"""

from __future__ import annotations

from alembic import op

revision = "n8h9i0j1k2l3"
down_revision = "m7g8h9i0j1k2"
branch_labels = None
depends_on = None


_BACKFILL_SQL = """
WITH litho_contacts AS (
    SELECT
        fc.id,
        fc.model_id,
        fc.formation_id,
        fc.borehole_id,
        fc.cpt_id,
        fc.depth_top_m,
        fc.source,
        fc.confidence,
        fc.observation_id,
        fc.observation_layer_id,
        fc.parent_geo_contact_id,
        fc.notes,
        fc.created_at,
        fc.updated_at,
        LEAD(fc.depth_top_m) OVER (
            PARTITION BY fc.model_id, COALESCE(fc.borehole_id, fc.cpt_id)
            ORDER BY fc.depth_top_m
        ) AS next_top_m
    FROM formation_contact fc
    JOIN geological_model m ON m.id = fc.model_id
    WHERE m.kind = 'lithostratigraphic'
      -- skip synthetic pinch-out contacts (no anchor)
      AND (fc.borehole_id IS NOT NULL OR fc.cpt_id IS NOT NULL)
)
INSERT INTO litho_layer (
    id, model_id, formation_id, borehole_id, cpt_id,
    depth_top_m, depth_base_m,
    status, source, confidence,
    observation_id, observation_layer_id, parent_geo_contact_id, notes,
    created_at, updated_at
)
SELECT
    c.id,
    c.model_id,
    c.formation_id,
    c.borehole_id,
    c.cpt_id,
    c.depth_top_m,
    -- next contact's top OR anchor total depth OR +1m sentinel.
    -- GREATEST guards against depth_base_m == depth_top_m violating
    -- the litho_layer_depth_ordered CHECK.
    GREATEST(
        c.depth_top_m + 0.001,
        COALESCE(
            c.next_top_m,
            (SELECT total_depth_m FROM borehole WHERE id = c.borehole_id),
            (SELECT max_depth_m FROM cpt WHERE id = c.cpt_id),
            c.depth_top_m + 1.0
        )
    ) AS depth_base_m,
    'accepted' AS status,
    CASE c.source
        WHEN 'borehole_observation' THEN 'observation_layer'
        ELSE 'manual'
    END AS source,
    c.confidence,
    c.observation_id,
    c.observation_layer_id,
    c.parent_geo_contact_id,
    c.notes,
    c.created_at,
    c.updated_at
FROM litho_contacts c
ON CONFLICT (id) DO NOTHING;
"""


_DOWNGRADE_SQL = """
DELETE FROM litho_layer
WHERE id IN (
    SELECT fc.id
    FROM formation_contact fc
    JOIN geological_model m ON m.id = fc.model_id
    WHERE m.kind = 'lithostratigraphic'
);
"""


def upgrade() -> None:
    """Run the FormationContact → LithoLayer backfill SQL."""
    op.execute(_BACKFILL_SQL)


def downgrade() -> None:
    """Remove litho_layer rows whose ids match a litho-model FormationContact."""
    op.execute(_DOWNGRADE_SQL)
