"""Enforce litho-layer column contiguity at commit (no gaps possible).

Owner directive 2026-06-08: "I thought no gaps were possible." The FC↔LL mirror
triggers keep each accepted litho column gap-free by re-deriving every layer's
``depth_base_m`` from the next contact — but that recompute only fires on
*contact* changes. A layer base that was stranded before the current trigger
regime (legacy data) or by a future path that writes ``depth_base_m`` without a
contact change can leave a GAP that never self-heals, and the partition fill
then shows a hole (dogfeed 2026-06-08, S13: SILT base 7.09 with the next contact
at 8.16 — a 1.07 m hole). The invariant was enforced per-write-path, with holes.

This migration moves the guarantee to the data layer:

1. **One-time sweep** — re-derive every accepted layer's base from the next
   accepted layer's top per (model, anchor), closing any existing gap/overlap.
2. **Deferred constraint trigger** ``trg_litho_column_contiguous`` — at COMMIT,
   assert each accepted layer's base meets the next accepted layer's top (within
   1 cm). Any transaction that would commit a gap/overlap now fails loudly
   instead of corrupting the column silently. Normal flows re-derive contiguity
   before commit (FC→LL recompute), so the assert never fires in practice; it is
   a backstop that turns a silent data bug into an immediate, named error.

Backwards-compat is suspended pre-ship — clean install, simple downgrade.
"""

from __future__ import annotations

from alembic import op

revision = "e1c2d3a4b5f6"
down_revision = "d8868bb27884"
branch_labels = None
depends_on = None


# One-time sweep: snap each non-last accepted layer's base to the next accepted
# layer's top, per (model, anchor). Closes gaps AND overlaps. The deepest layer
# (no LEAD) keeps its own base — the column floor.
_SWEEP_SQL = """
WITH recomputed AS (
    SELECT
        id,
        LEAD(depth_top_m) OVER (
            PARTITION BY model_id, COALESCE(borehole_id, cpt_id)
            ORDER BY depth_top_m
        ) AS next_top
    FROM litho_layer
    WHERE status = 'accepted'
)
UPDATE litho_layer ll
SET depth_base_m = r.next_top
FROM recomputed r
WHERE ll.id = r.id
  AND r.next_top IS NOT NULL
  AND abs(ll.depth_base_m - r.next_top) > 0.001;
"""


_ASSERT_FN_SQL = """
CREATE OR REPLACE FUNCTION assert_litho_column_contiguous()
RETURNS TRIGGER AS $$
DECLARE
    affected_model uuid;
    affected_anchor uuid;
    gap_count int;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_model := OLD.model_id;
        affected_anchor := COALESCE(OLD.borehole_id, OLD.cpt_id);
    ELSE
        affected_model := NEW.model_id;
        affected_anchor := COALESCE(NEW.borehole_id, NEW.cpt_id);
    END IF;
    IF affected_anchor IS NULL THEN
        RETURN NULL;
    END IF;

    -- Count consecutive accepted layers whose base does NOT meet the next
    -- layer's top (gap or overlap) beyond a 1 cm tolerance (matches the
    -- litho-snap epsilon; the trigger derives min-thickness bases at
    -- top + 0.001, which the next layer's top meets exactly).
    SELECT count(*) INTO gap_count
    FROM (
        SELECT
            depth_base_m,
            LEAD(depth_top_m) OVER (ORDER BY depth_top_m) AS next_top
        FROM litho_layer
        WHERE model_id = affected_model
          AND COALESCE(borehole_id, cpt_id) = affected_anchor
          AND status = 'accepted'
    ) q
    WHERE next_top IS NOT NULL
      AND abs(next_top - depth_base_m) > 0.01;

    IF gap_count > 0 THEN
        RAISE EXCEPTION
            'litho_layer column not contiguous: % gap/overlap(s) on anchor % (model %)',
            gap_count, affected_anchor, affected_model;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
"""


_ASSERT_TRIGGER_SQL = """
CREATE CONSTRAINT TRIGGER trg_litho_column_contiguous
AFTER INSERT OR UPDATE OR DELETE ON litho_layer
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_litho_column_contiguous();
"""


def upgrade() -> None:
    """Close existing gaps, then install the deferred contiguity guard."""
    op.execute(_SWEEP_SQL)
    op.execute(_ASSERT_FN_SQL)
    op.execute(_ASSERT_TRIGGER_SQL)


def downgrade() -> None:
    """Drop the contiguity guard (the swept data stays closed)."""
    op.execute("DROP TRIGGER IF EXISTS trg_litho_column_contiguous ON litho_layer;")
    op.execute("DROP FUNCTION IF EXISTS assert_litho_column_contiguous();")
