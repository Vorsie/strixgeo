"""Add geotech_tie_tombstone — a packing tie the engineer deleted stays deleted.

Owner rulings 2026-08-17: *"A tie i delete stays deleted but does not delete on
the litho model"*, keyed *"just do position xyz left and xyz right and the
section it was on"*.  The packing bands are rebuilt by pipeline steps 1 and 4 —
new rows, new ids — so a tombstone naming band ids would stop matching at the
first re-derivation and the deleted tie would return (the loop he met twice).
The PLACE survives the rebuild: x/y are the investigation's map position and z
the contact's elevation.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-08-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the geotech_tie_tombstone table."""
    op.create_table(
        "geotech_tie_tombstone",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "section_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("cross_section.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("a_x", sa.Float(), nullable=False),
        sa.Column("a_y", sa.Float(), nullable=False),
        sa.Column("a_z", sa.Float(), nullable=False),
        sa.Column("b_x", sa.Float(), nullable=False),
        sa.Column("b_y", sa.Float(), nullable=False),
        sa.Column("b_z", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop the geotech_tie_tombstone table."""
    op.drop_table("geotech_tie_tombstone")
