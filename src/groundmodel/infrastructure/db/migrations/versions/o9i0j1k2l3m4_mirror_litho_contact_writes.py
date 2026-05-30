"""Trigger-based bridge that mirrors litho-model formation_contact writes into litho_layer.

The A3 read-path switch on the frontend reads from ``/layers`` — the
new Shape A source of truth — but litho writes still flow through the
existing ``/contacts`` use cases during the cut-over. Without a bridge
between the two stores, every write would produce a stale read on the
next fetch.

This migration installs a PostgreSQL trigger on ``formation_contact``
that fires after INSERT/UPDATE/DELETE. When the affected row's model
is ``kind='lithostratigraphic'``, the trigger upserts the corresponding
``litho_layer`` row (UUID preserved) and prunes orphans within the
same (model, anchor) scope.

Lifecycle
---------
This bridge is INTENTIONALLY TEMPORARY. As each FE writer is rewired
to the layer endpoints (POST /layers, PATCH /layers/{id}, etc.), the
contact path for that gesture goes away. Once all litho writes flow
through the layer endpoints, the trigger has nothing to mirror and
the A4 migration drops it.

Why a trigger, not a repository hook
------------------------------------
* the contact write surface is wide (8+ use cases), and a repository
  hook would need a coordinated change in every call site
* a trigger is one file, removable in one statement
* the only logic the trigger needs is the same window-function
  re-derivation the A2.5 backfill already encodes — no new semantics

Synthetic pinch-out contacts (no anchor) are skipped — Shape A
requires anchor XOR.
"""

from __future__ import annotations

from alembic import op

revision = "o9i0j1k2l3m4"
down_revision = "n8h9i0j1k2l3"
branch_labels = None
depends_on = None


_TRIGGER_FN_SQL = """
CREATE OR REPLACE FUNCTION mirror_litho_contact_to_layer()
RETURNS TRIGGER AS $$
DECLARE
    affected_model_id uuid;
    affected_borehole_id uuid;
    affected_cpt_id uuid;
    model_kind text;
    anchor_key uuid;
BEGIN
    -- Determine the (model, anchor) scope from OLD or NEW depending on op.
    IF TG_OP = 'DELETE' THEN
        affected_model_id := OLD.model_id;
        affected_borehole_id := OLD.borehole_id;
        affected_cpt_id := OLD.cpt_id;
    ELSE
        affected_model_id := NEW.model_id;
        affected_borehole_id := NEW.borehole_id;
        affected_cpt_id := NEW.cpt_id;
    END IF;

    SELECT kind INTO model_kind FROM geological_model WHERE id = affected_model_id;
    IF model_kind IS DISTINCT FROM 'lithostratigraphic' THEN
        RETURN NULL;
    END IF;

    -- Synthetic pinch-out (no anchor) — Shape A doesn't model these.
    IF affected_borehole_id IS NULL AND affected_cpt_id IS NULL THEN
        RETURN NULL;
    END IF;

    anchor_key := COALESCE(affected_borehole_id, affected_cpt_id);

    -- Prune orphan layers: ones whose contact no longer exists in this
    -- (model, anchor). Catches DELETE + UPDATE-of-anchor.
    DELETE FROM litho_layer
    WHERE model_id = affected_model_id
      AND COALESCE(borehole_id, cpt_id) = anchor_key
      AND id NOT IN (
          SELECT fc.id FROM formation_contact fc
          WHERE fc.model_id = affected_model_id
            AND COALESCE(fc.borehole_id, fc.cpt_id) = anchor_key
      );

    -- Upsert layers from current contact state, depth_base_m derived
    -- via the same window-function rule as the backfill migration.
    -- GREATEST guards the litho_layer_depth_ordered CHECK.
    WITH ordered_contacts AS (
        SELECT
            fc.id, fc.model_id, fc.formation_id,
            fc.borehole_id, fc.cpt_id,
            fc.depth_top_m,
            fc.source, fc.confidence,
            fc.observation_id, fc.observation_layer_id,
            fc.parent_geo_contact_id, fc.notes,
            fc.created_at, fc.updated_at,
            LEAD(fc.depth_top_m) OVER (ORDER BY fc.depth_top_m) AS next_top_m
        FROM formation_contact fc
        WHERE fc.model_id = affected_model_id
          AND COALESCE(fc.borehole_id, fc.cpt_id) = anchor_key
    )
    INSERT INTO litho_layer (
        id, model_id, formation_id, borehole_id, cpt_id,
        depth_top_m, depth_base_m,
        status, source, confidence,
        observation_id, observation_layer_id, parent_geo_contact_id, notes,
        created_at, updated_at
    )
    SELECT
        c.id, c.model_id, c.formation_id, c.borehole_id, c.cpt_id,
        c.depth_top_m,
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
        c.observation_id, c.observation_layer_id, c.parent_geo_contact_id, c.notes,
        c.created_at, c.updated_at
    FROM ordered_contacts c
    ON CONFLICT (id) DO UPDATE SET
        formation_id = EXCLUDED.formation_id,
        depth_top_m = EXCLUDED.depth_top_m,
        depth_base_m = EXCLUDED.depth_base_m,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        observation_id = EXCLUDED.observation_id,
        observation_layer_id = EXCLUDED.observation_layer_id,
        parent_geo_contact_id = EXCLUDED.parent_geo_contact_id,
        notes = EXCLUDED.notes,
        updated_at = EXCLUDED.updated_at;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
"""


_TRIGGER_SQL = """
CREATE TRIGGER trg_mirror_litho_contact_to_layer
AFTER INSERT OR UPDATE OR DELETE ON formation_contact
FOR EACH ROW EXECUTE FUNCTION mirror_litho_contact_to_layer();
"""


def upgrade() -> None:
    """Install the trigger function + the AFTER-INSERT/UPDATE/DELETE trigger."""
    op.execute(_TRIGGER_FN_SQL)
    op.execute(_TRIGGER_SQL)


def downgrade() -> None:
    """Drop the trigger + function (A4 retirement path)."""
    op.execute("DROP TRIGGER IF EXISTS trg_mirror_litho_contact_to_layer ON formation_contact;")
    op.execute("DROP FUNCTION IF EXISTS mirror_litho_contact_to_layer();")
