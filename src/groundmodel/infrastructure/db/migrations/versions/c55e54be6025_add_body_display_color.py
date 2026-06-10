"""add body display_color

Revision ID: c55e54be6025
Revises: f9919ac9916e
Create Date: 2026-06-10 17:06:19.479578

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c55e54be6025"
down_revision = "f9919ac9916e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add nullable display_color column to the body table."""
    op.add_column("body", sa.Column("display_color", sa.String(length=20), nullable=True))


def downgrade() -> None:
    """Drop the display_color column from the body table."""
    op.drop_column("body", "display_color")
