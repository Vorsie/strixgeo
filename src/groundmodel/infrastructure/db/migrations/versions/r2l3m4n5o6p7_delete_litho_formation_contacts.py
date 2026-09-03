"""Delete formation_contact rows for litho models (A4 final cleanup).

After the AcceptLithoSuggestions + SeedLithoFromGeologicalModel
refactors, every accepted litho boundary lives natively in
``litho_layer`` and the FC row is a mirror — created by the LL→FC
trigger on each accepted layer INSERT, kept in sync on each layer
UPDATE. The mirror is vestigial: nothing in the BE or FE litho code
paths reads or writes FC for litho models anymore.

Bundle export emits empty ``contacts`` for litho models (slice 4c).
The correlation edge FK points at ``litho_layer.id`` (slice 4a).
The /contacts API endpoint is unused by the FE for litho models
(every writer moved to /layers in the A4 cleanup pass).

This migration removes the historical mirror rows. Post-migration,
the LL→FC trigger continues to re-materialise FCs on new accepted
LL writes — so any code that DOES query the contact mirror will see
fresh rows for newly-committed layers; only the historical data is
pruned.

Two safety guards
-----------------
1. The FC→LL trigger is disabled for the DELETE window. If left
   active, the trigger's DELETE-NOT-IN clause would observe the FC
   deletion and wipe every accepted LL row on the same (model,
   anchor) — exactly the data this migration is trying to preserve.
   Disable / re-enable wraps the DELETE itself.
2. Synthetic pinch-out FCs (``borehole_id`` AND ``cpt_id`` both NULL,
   carrying ``synthetic_x/y/elevation_m``) are EXCLUDED from the
   delete. Litho pinch-outs are debt #131-b future work — they have
   no LL counterpart by Shape A, so deleting their FC would silently
   lose the only persistent record of the synthetic boundary.

Idempotent — re-running the migration is a no-op (DELETE matches 0
rows the second time). The downgrade re-materialises FC mirrors
from the surviving accepted LL rows (mirrors the LL→FC trigger
logic in bulk for the litho scope).
"""

from __future__ import annotations

from alembic import op

revision = "r2l3m4n5o6p7"
down_revision = "q1k2l3m4n5o6"
branch_labels = None
depends_on = None

# Declares that ``upgrade()`` deletes existing user rows (DELETEs the litho
# formation-contact rows) so the migrator's pre-migration backup step names it
# among the pending data-rewriting migrations (production-readiness audit H2b).
DATA_REWRITE = True


# Each step is its own statement — asyncpg rejects multi-statement
# strings (PostgresSyntaxError: "cannot insert multiple commands
# into a prepared statement"). Callers and the test harness execute
# these in order, all inside the same transaction.

_DISABLE_FC_TRIGGER_SQL = (
    "ALTER TABLE formation_contact DISABLE TRIGGER trg_mirror_litho_contact_to_layer"
)

_ENABLE_FC_TRIGGER_SQL = (
    "ALTER TABLE formation_contact ENABLE TRIGGER trg_mirror_litho_contact_to_layer"
)

_DELETE_LITHO_FCS_SQL = """
DELETE FROM formation_contact
WHERE model_id IN (
    SELECT id FROM geological_model WHERE kind = 'lithostratigraphic'
)
-- Preserve synthetic pinch-out FCs (debt #131-b future work; no LL counterpart).
AND NOT (borehole_id IS NULL AND cpt_id IS NULL)
"""

_REMATERIALISE_LITHO_FCS_SQL = """
INSERT INTO formation_contact (
    id, model_id, formation_id, borehole_id, cpt_id,
    depth_top_m, source, confidence,
    observation_id, observation_layer_id, parent_geo_contact_id, notes,
    created_at, updated_at
)
SELECT
    ll.id, ll.model_id, ll.formation_id, ll.borehole_id, ll.cpt_id,
    ll.depth_top_m,
    CASE ll.source
        WHEN 'observation_layer' THEN 'borehole_observation'
        WHEN 'observation_interpretation' THEN 'borehole_observation'
        ELSE 'manual_pick'
    END,
    ll.confidence,
    ll.observation_id, ll.observation_layer_id, ll.parent_geo_contact_id, ll.notes,
    ll.created_at, ll.updated_at
FROM litho_layer ll
JOIN geological_model gm ON gm.id = ll.model_id
WHERE gm.kind = 'lithostratigraphic'
  AND ll.status = 'accepted'
ON CONFLICT (id) DO NOTHING
"""


def upgrade() -> None:
    """Delete the historical FC mirror rows for litho models."""
    op.execute(_DISABLE_FC_TRIGGER_SQL)
    op.execute(_DELETE_LITHO_FCS_SQL)
    op.execute(_ENABLE_FC_TRIGGER_SQL)


def downgrade() -> None:
    """Re-materialise FC mirrors from accepted LL rows (litho scope)."""
    op.execute(_DISABLE_FC_TRIGGER_SQL)
    op.execute(_REMATERIALISE_LITHO_FCS_SQL)
    op.execute(_ENABLE_FC_TRIGGER_SQL)
