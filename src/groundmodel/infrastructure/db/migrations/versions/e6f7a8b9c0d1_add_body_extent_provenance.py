"""add body extent provenance (auto vs user-claimed)

Revision ID: e6f7a8b9c0d1
Revises: c2d3e4f5a6b7
Create Date: 2026-06-04

Per-side provenance for a body's lateral extents. Distinguishes an ``auto``
extent (set + freely recomputed by ``DetectBodies`` — both the ``to_target``
bilateral closures AND the auto-completed ``pinch_out_halfway`` / ``open``
defaults) from a ``user`` extent (an explicit ``ClaimBodyExtent`` the auto pass
must never overwrite or clear).

Why this column exists
----------------------
Provenance was previously inferred from the extent KIND
(``pinch_out_halfway`` / ``extrapolated`` / ``open`` == user-claimed; see
``shared/constants/extent_kind.is_user_claimed_extent_kind``). That made an
auto-defaulted pinch indistinguishable from a user-claimed one, so the
auto-complete pass could not own + recompute the defaults — they went stale
when the correlation topology changed (the body grew a member, the unit started
banding across, etc.). An explicit per-side flag lets ``DetectBodies`` recompute
every ``auto`` side each pass while leaving every ``user`` side untouched, so a
body can never persist with a null lateral side (owner directive 2026-06-04: the
2D body+extent set is the source of truth that feeds the 3D model — no null
clutter, no blind spots).

Backfill
--------
Mirrors the old kind-based rule exactly so existing rows keep their current
semantics (no behaviour change for pre-migration data): a side whose kind is a
user-claimed kind (``pinch_out_halfway`` / ``extrapolated`` / ``open``) →
``'user'``; ``to_target`` / ``NULL`` → ``'auto'`` (the server default).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e6f7a8b9c0d1"
down_revision = "c2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the two provenance columns + backfill from the existing kinds."""
    op.add_column(
        "body",
        sa.Column(
            "extent_left_provenance",
            sa.String(8),
            nullable=False,
            server_default="auto",
        ),
    )
    op.add_column(
        "body",
        sa.Column(
            "extent_right_provenance",
            sa.String(8),
            nullable=False,
            server_default="auto",
        ),
    )
    # Backfill: mirror the kind-based provenance rule so existing rows keep
    # their current semantics. The three user-claimed kinds → 'user'; every
    # other side (to_target / NULL) keeps the 'auto' server default.
    op.execute(
        "UPDATE body SET extent_left_provenance = 'user' "
        "WHERE extent_left_kind IN ('pinch_out_halfway', 'extrapolated', 'open')"
    )
    op.execute(
        "UPDATE body SET extent_right_provenance = 'user' "
        "WHERE extent_right_kind IN ('pinch_out_halfway', 'extrapolated', 'open')"
    )


def downgrade() -> None:
    """Drop the two provenance columns."""
    op.drop_column("body", "extent_right_provenance")
    op.drop_column("body", "extent_left_provenance")
