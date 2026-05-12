"""Add view_state JSONB column to cross_section.

Revision ID: 8a3f2c91d456
Revises: 7d2a8f5b1c93
Create Date: 2026-05-12 11:30:00.000000

Per-section display preferences (CPT channel toggles, borehole
interpretation toggles, future scale locks) need a persistent
home so they ride in the bundle on Save and re-open identically
on a different machine. Without this column, ``SectionPanel.tsx``
falls back to defaults on every open and the user's last view is
silently discarded.

Schema-less JSONB matches the established pattern on
``project.view_state`` (added in 7d2a8f5b1c93) — toggles evolve
without per-key migrations. Nullable so existing rows read as
``None`` and the frontend's ``readCptChannels`` / equivalent
helpers apply the documented defaults.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "8a3f2c91d456"
down_revision = "7d2a8f5b1c93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the ``view_state`` JSONB column."""
    op.add_column(
        "cross_section",
        sa.Column(
            "view_state",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Drop the ``view_state`` column. Loses any persisted preferences."""
    op.drop_column("cross_section", "view_state")
