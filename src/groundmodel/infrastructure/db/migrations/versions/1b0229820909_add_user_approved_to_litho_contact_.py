"""add user_approved to litho_contact_correlation_edge

Revision ID: 1b0229820909
Revises: l6f7a8b9c0d1
Create Date: 2026-05-26 15:03:27.591485

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1b0229820909"
down_revision = "l6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add user_approved bool column; existing rows (all manual) default TRUE."""
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column(
            "user_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    """Drop the column (reverses the add)."""
    op.drop_column("litho_contact_correlation_edge", "user_approved")
