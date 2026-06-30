"""sample geotech assignment

Adds three nullable columns to the ``sample`` table so that
:class:`~groundmodel.application.divide_boreholes.DivideBoreholes` can stamp
each lab sample with the geotech body it belongs to, its NAD packing class,
and the provenance tier of the band that was matched.

Revision ID: fce0b6dcb273
Revises: c120996a504d
Create Date: 2026-06-30 11:30:45.876986
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# revision identifiers, used by Alembic.
revision = "fce0b6dcb273"
down_revision = "c120996a504d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add geotech assignment columns + body-id index to sample."""
    op.add_column(
        "sample",
        sa.Column(
            "geotech_body_id",
            PG_UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "sample",
        sa.Column("geotech_nad_class", sa.Integer(), nullable=True),
    )
    op.add_column(
        "sample",
        sa.Column("geotech_assignment_source", sa.String(50), nullable=True),
    )
    op.create_index(
        "idx_sample_geotech_body_id",
        "sample",
        ["geotech_body_id"],
    )


def downgrade() -> None:
    """Drop geotech assignment columns + index from sample."""
    op.drop_index("idx_sample_geotech_body_id", table_name="sample")
    op.drop_column("sample", "geotech_assignment_source")
    op.drop_column("sample", "geotech_nad_class")
    op.drop_column("sample", "geotech_body_id")
