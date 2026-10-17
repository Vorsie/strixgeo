"""add rf_source and qt_source provenance flags to cpt_series

Revision ID: b9f3c7e2a1d4
Revises: 57421972dad9
Create Date: 2026-05-08 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b9f3c7e2a1d4"
down_revision = "57421972dad9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable ``rf_source`` and ``qt_source`` columns to ``cpt_series``."""
    # Provenance flags for rf_pct and qt_mpa: "measured" (from source) vs
    # "computed" (derived by our parser). Nullable: legacy rows have unknown
    # provenance and frontend code must handle the NULL case gracefully.
    op.add_column("cpt_series", sa.Column("rf_source", sa.String(length=10), nullable=True))
    op.add_column("cpt_series", sa.Column("qt_source", sa.String(length=10), nullable=True))


def downgrade() -> None:
    """Drop the ``qt_source`` and ``rf_source`` columns."""
    op.drop_column("cpt_series", "qt_source")
    op.drop_column("cpt_series", "rf_source")
