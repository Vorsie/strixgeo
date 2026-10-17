"""widen description columns to TEXT on observation_layer + sample

Revision ID: c2a4e91d6f55
Revises: b8e2c47a1f93
Create Date: 2026-05-09 16:00:00.000000

DOV ships free-text descriptions on geotechnical-coding observation
layers and (occasionally) on samples that exceed VARCHAR(500). Real-world
imports crashed with ``StringDataRightTruncationError`` mid-batch,
killing the API process. Both columns become ``TEXT`` (uncapped).

ALTER COLUMN to TEXT is a no-op data-wise — every existing string fits
unchanged. The downgrade clamps back to VARCHAR(500), which would
truncate any long descriptions inserted in the meantime, so the
downgrade should be applied only against an environment that hasn't
seen long descriptions yet.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c2a4e91d6f55"
down_revision = "b8e2c47a1f93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Widen ``observation_layer.description`` and ``sample.description`` to TEXT."""
    op.alter_column(
        "observation_layer",
        "description",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "sample",
        "description",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=False,
        existing_server_default=sa.text("''::character varying"),
    )


def downgrade() -> None:
    """Narrow both description columns back to VARCHAR(500)."""
    op.alter_column(
        "sample",
        "description",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=False,
    )
    op.alter_column(
        "observation_layer",
        "description",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )
