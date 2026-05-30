"""Bidirectional FC↔LL mirror — unblocks the FE writer cut-over to /layers.

A4 slice 2 of the unified litho boundary model.

After A3 the contact-side trigger keeps ``litho_layer`` in sync when
the FE writes ``/contacts``. A4 slice 3 cuts the FE writers over to
``/layers``; for that to be safe (without breaking correlation FKs or
the bundle export that still reads ``formation_contact``), the inverse
direction has to be installed first: an LL→FC trigger that mirrors
layer-side writes back into ``formation_contact`` for accepted rows.

Two changes in one migration:

1. **Add the LL→FC trigger** with three branches:
   * ``INSERT|UPDATE LL WHERE status='accepted'`` → upsert matching FC
     (UUID-preserved, anchor + formation + depth + provenance copied).
   * ``UPDATE LL WHERE status flipped accepted→non-accepted`` → delete
     the matching FC (the row no longer represents a committed boundary).
   * ``DELETE LL WHERE OLD.status='accepted'`` → delete matching FC.
   Pending/rejected layer writes never touch FC.

2. **Patch the existing FC→LL trigger** to scope its DELETE-NOT-IN
   guard by ``status='accepted'``. Without this fix, a status flip
   ``accepted→pending`` on LL would propagate through LL→FC (which
   deletes the matching FC) and then the FC→LL recompute would see
   "LL.id not in FCs" and DELETE the LL row entirely — exactly the
   row the user wanted to keep as pending.

Recursion is bounded by ``pg_trigger_depth()``: a user write at depth 0
fires the first trigger at depth 1, which may write the other table at
depth 2, firing the inverse trigger at depth 2. The inverse trigger's
own write fires the original trigger at depth 3 — which the
``pg_trigger_depth() > 1`` guard in LL→FC short-circuits. The FC→LL
trigger doesn't need a depth guard because its writes target LL only
(no further LL-side write happens inside FC→LL beyond the recompute,
which already terminates).
"""

from __future__ import annotations

from alembic import op

revision = "p0j1k2l3m4n5"
down_revision = "o9i0j1k2l3m4"
branch_labels = None
depends_on = None


# Patched FC→LL function. Adds the ``status='accepted'`` filter on the
# DELETE-NOT-IN clause so pending/rejected layers survive a status flip
# that triggers the inverse FC delete.
_FC_TO_LL_FN_SQL = """
CREATE OR REPLACE FUNCTION mirror_litho_contact_to_layer()
RETURNS TRIGGER AS $$
DECLARE
    affected_model_id uuid;
    affected_borehole_id uuid;
    affected_cpt_id uuid;
    model_kind text;
    anchor_key uuid;
BEGIN
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

    IF affected_borehole_id IS NULL AND affected_cpt_id IS NULL THEN
        RETURN NULL;
    END IF;

    anchor_key := COALESCE(affected_borehole_id, affected_cpt_id);

    -- Prune orphan ACCEPTED layers only. Pending/rejected layers have no
    -- FC counterpart by design, so the FC absence is not a signal that
    -- the LL should also be deleted — leaving them alone is correct.
    DELETE FROM litho_layer
    WHERE model_id = affected_model_id
      AND COALESCE(borehole_id, cpt_id) = anchor_key
      AND status = 'accepted'
      AND id NOT IN (
          SELECT fc.id FROM formation_contact fc
          WHERE fc.model_id = affected_model_id
            AND COALESCE(fc.borehole_id, fc.cpt_id) = anchor_key
      );

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


# New LL→FC trigger function. Bounded recursion via pg_trigger_depth().
_LL_TO_FC_FN_SQL = """
CREATE OR REPLACE FUNCTION mirror_litho_layer_to_contact()
RETURNS TRIGGER AS $$
BEGIN
    -- Recursion guard. When our FC write re-fires FC→LL which writes LL
    -- which re-fires us, the second invocation is at depth >= 2 and
    -- short-circuits. The user-driven write is always at depth 1.
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- Only mirror the FC deletion when the layer that was deleted
        -- HAD a contact counterpart in the first place.
        IF OLD.status = 'accepted' THEN
            DELETE FROM formation_contact WHERE id = OLD.id;
        END IF;
        RETURN NULL;
    END IF;

    -- INSERT or UPDATE.
    IF NEW.status = 'accepted' THEN
        -- Upsert the FC mirror with the layer's current accepted state.
        INSERT INTO formation_contact (
            id, model_id, formation_id, borehole_id, cpt_id,
            depth_top_m, source, confidence,
            observation_id, observation_layer_id, parent_geo_contact_id, notes
        )
        VALUES (
            NEW.id, NEW.model_id, NEW.formation_id, NEW.borehole_id, NEW.cpt_id,
            NEW.depth_top_m,
            CASE NEW.source
                WHEN 'observation_layer' THEN 'borehole_observation'
                WHEN 'observation_interpretation' THEN 'borehole_observation'
                ELSE 'manual_pick'
            END,
            NEW.confidence,
            NEW.observation_id, NEW.observation_layer_id,
            NEW.parent_geo_contact_id, NEW.notes
        )
        ON CONFLICT (id) DO UPDATE SET
            formation_id = EXCLUDED.formation_id,
            depth_top_m = EXCLUDED.depth_top_m,
            confidence = EXCLUDED.confidence,
            source = EXCLUDED.source,
            observation_id = EXCLUDED.observation_id,
            observation_layer_id = EXCLUDED.observation_layer_id,
            parent_geo_contact_id = EXCLUDED.parent_geo_contact_id,
            notes = EXCLUDED.notes;
    ELSE
        -- Pending or rejected — there must be no FC mirror. If the
        -- layer was previously accepted and just flipped, this is how
        -- the FC retires; otherwise the WHERE clause matches no rows
        -- and the DELETE is a no-op.
        DELETE FROM formation_contact WHERE id = NEW.id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
"""


_LL_TO_FC_TRIGGER_SQL = """
CREATE TRIGGER trg_mirror_litho_layer_to_contact
AFTER INSERT OR UPDATE OR DELETE ON litho_layer
FOR EACH ROW EXECUTE FUNCTION mirror_litho_layer_to_contact();
"""


def upgrade() -> None:
    """Install the LL→FC trigger + patch the FC→LL trigger."""
    op.execute(_FC_TO_LL_FN_SQL)
    op.execute(_LL_TO_FC_FN_SQL)
    op.execute(_LL_TO_FC_TRIGGER_SQL)


def downgrade() -> None:
    """Drop the LL→FC trigger + function; restore the prior FC→LL function."""
    op.execute("DROP TRIGGER IF EXISTS trg_mirror_litho_layer_to_contact ON litho_layer;")
    op.execute("DROP FUNCTION IF EXISTS mirror_litho_layer_to_contact();")
    # Revert FC→LL function to the pre-A4-slice-2 shape (no status filter
    # on the DELETE-NOT-IN clause). Matches what A3a installed.
    op.execute(
        """
CREATE OR REPLACE FUNCTION mirror_litho_contact_to_layer()
RETURNS TRIGGER AS $$
DECLARE
    affected_model_id uuid;
    affected_borehole_id uuid;
    affected_cpt_id uuid;
    model_kind text;
    anchor_key uuid;
BEGIN
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

    IF affected_borehole_id IS NULL AND affected_cpt_id IS NULL THEN
        RETURN NULL;
    END IF;

    anchor_key := COALESCE(affected_borehole_id, affected_cpt_id);

    DELETE FROM litho_layer
    WHERE model_id = affected_model_id
      AND COALESCE(borehole_id, cpt_id) = anchor_key
      AND id NOT IN (
          SELECT fc.id FROM formation_contact fc
          WHERE fc.model_id = affected_model_id
            AND COALESCE(fc.borehole_id, fc.cpt_id) = anchor_key
      );

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
    )
