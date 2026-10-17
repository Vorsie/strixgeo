"""drop avg_qc_mpa from cpt

Revision ID: cf77c4baaddf
Revises: 2e0be0b1ef96
Create Date: 2026-05-06 23:37:27.596776

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "cf77c4baaddf"
down_revision = "2e0be0b1ef96"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remove avg_qc_mpa — not needed as a stored summary."""
    op.drop_column("cpt", "avg_qc_mpa")


def downgrade() -> None:
    """Re-add avg_qc_mpa as a nullable column (values will be NULL after restore)."""
    op.add_column(
        "cpt",
        sa.Column(
            "avg_qc_mpa", sa.DOUBLE_PRECISION(precision=53), autoincrement=False, nullable=True
        ),
    )
