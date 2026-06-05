"""forbid overlapping accepted litho layers on a column

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-06-05

A hard backstop against two accepted ``litho_layer`` rows overlapping on the
same investigation. Until now the gap-free / non-overlapping property was only
*conventional*: the segmenter emits a contiguous stack and ``MoveLithoLayer
boundary`` moves a shared boundary on both neighbours at once, but the
single-layer ``UpdateLithoLayer`` depth PATCH (``source='manual'``) had no
neighbour adjustment and no overlap check, so a manual drag could drop a
boundary inside a neighbour (dogfeed 2026-06-05: a hand-drawn sand whose top
landed 3.3 m inside the silt below it). The DB enforced only
``depth_top_m < depth_base_m`` *per row* — nothing across rows.

The guard
---------
A partial GiST exclusion constraint: no two rows with ``status='accepted'`` may
share ``(model_id, investigation)`` and have overlapping depth ranges.

* ``COALESCE(cpt_id, borehole_id)`` is the investigation identity (the
  anchor-XOR check guarantees exactly one is set).
* ``numrange(round(top, 3), round(base, 3))`` with ``&&`` is the overlap test.
  Rounding to the millimetre lets genuine overlaps (decimetres+) trip while
  float noise at a shared boundary (``MoveLithoLayerBoundary`` writes the same
  float to both sides; the 1e-6 read tolerance never reaches the wire) and exact
  adjacency (``[a,b)`` then ``[b,c)`` do not overlap) stay legal.
* ``status='accepted'`` only — ``pending`` suggestions are allowed to overlap by
  design (the segmenter offers alternatives before the user accepts).
* ``DEFERRABLE INITIALLY DEFERRED`` — checked at COMMIT, so a batch edit that is
  transiently overlapping mid-transaction (shrink one layer, grow another) is
  fine as long as the committed state is clean.

Requires ``btree_gist`` for the ``=`` operator on the scalar ``uuid`` columns
(PG16 / btree_gist 1.7 supports ``uuid`` natively); the ``&&`` on ``numrange``
uses the built-in range GiST opclass.

Pre-condition: the data must already be overlap-free (ADD CONSTRAINT validates
existing rows immediately, deferrable or not). The one historical overlap was
clipped before this migration.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None

_CONSTRAINT = "litho_layer_accepted_no_overlap"


def upgrade() -> None:
    """Install btree_gist + the partial, deferrable no-overlap exclusion."""
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute(
        f"""
        ALTER TABLE litho_layer ADD CONSTRAINT {_CONSTRAINT}
        EXCLUDE USING gist (
            model_id WITH =,
            (COALESCE(cpt_id, borehole_id)) WITH =,
            numrange(round(depth_top_m::numeric, 3), round(depth_base_m::numeric, 3)) WITH &&
        ) WHERE (status = 'accepted')
        DEFERRABLE INITIALLY DEFERRED
        """
    )


def downgrade() -> None:
    """Drop the exclusion constraint (leave btree_gist installed — harmless)."""
    op.execute(f"ALTER TABLE litho_layer DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
