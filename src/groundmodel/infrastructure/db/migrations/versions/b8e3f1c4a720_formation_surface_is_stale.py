"""add is_stale flag to formation_surface

Revision ID: b8e3f1c4a720
Revises: a3b7e29f4d10
Create Date: 2026-05-14 14:00:00.000000

Adds the boolean staleness flag that drives the on-click build
pivot. Today's behaviour: every contact mutation auto-recomputed
the cached TIN. New behaviour: per-contact edits flip ``is_stale``
to True (cheap one-row UPDATE, no Delaunay); only the user-driven
``POST /surfaces/rebuild`` clears it back to False.

The flag has a default of ``false`` so existing rows (which were
all built under the old auto-recompute regime) are correctly
treated as fresh — no false-positive "stale" warnings on first
launch after the migration. Bundle restore independently
recomputes the flag from ``source_contact_checksum`` vs current
contacts so a tampered .strix can't silently claim freshness.

The flag lives at the per-(model, formation) granularity rather
than per-model so a future kriging build (Phase 5+) can rebuild
only the affected formations rather than the whole stack.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e3f1c4a720"
down_revision: str | None = "a3b7e29f4d10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the is_stale boolean column."""
    op.add_column(
        "formation_surface",
        sa.Column(
            "is_stale",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop the is_stale column."""
    op.drop_column("formation_surface", "is_stale")
