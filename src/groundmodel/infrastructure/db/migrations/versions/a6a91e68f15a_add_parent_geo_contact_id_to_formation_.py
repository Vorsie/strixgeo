"""add parent_geo_contact_id to formation_contact

Revision ID: a6a91e68f15a
Revises: 11878f8a5732
Create Date: 2026-05-28 19:34:40.925023

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a6a91e68f15a"
down_revision = "11878f8a5732"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add parent_geo_contact_id FK column + index to formation_contact."""
    op.add_column(
        "formation_contact",
        sa.Column("parent_geo_contact_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_formation_contact_parent_geo",
        "formation_contact",
        "formation_contact",
        ["parent_geo_contact_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_formation_contact_parent_geo",
        "formation_contact",
        ["parent_geo_contact_id"],
    )


def downgrade() -> None:
    """Remove parent_geo_contact_id FK column + index from formation_contact."""
    op.drop_index("idx_formation_contact_parent_geo", table_name="formation_contact")
    op.drop_constraint("fk_formation_contact_parent_geo", "formation_contact", type_="foreignkey")
    op.drop_column("formation_contact", "parent_geo_contact_id")
