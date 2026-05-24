"""Add updated_at to formation_absence (#101 R7).

Revision ID: i3c4d5e6f7a8
Revises: h2b3c4d5e6f7
Create Date: 2026-05-24 23:00:00.000000

The ``FormationAbsenceOrm`` model was extended with an ``updated_at``
timestamptz column to track when an absence record was last touched by the
inference engine.  The migration that created ``formation_absence``
(h2b3c4d5e6f7) pre-dates that ORM change — this migration backfills the
schema gap.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "i3c4d5e6f7a8"
down_revision = "h2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add updated_at timestamptz column to formation_absence."""
    op.add_column(
        "formation_absence",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            # Backfill existing rows with created_at so the column is
            # immediately NOT NULL without needing a multi-step migration.
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    # Drop the server_default so future INSERT/UPDATE callers must supply the
    # value explicitly (or rely on an application-level onupdate trigger).
    # We keep the server_default active only long enough to backfill.
    # NOTE: SQLAlchemy's onupdate= is handled at the ORM layer, not via a DB
    # trigger, so leaving a DB default in place would cause stale values on
    # updates made outside the ORM.  Dropping it keeps behaviour predictable.
    op.alter_column("formation_absence", "updated_at", server_default=None)


def downgrade() -> None:
    """Remove updated_at from formation_absence."""
    op.drop_column("formation_absence", "updated_at")
