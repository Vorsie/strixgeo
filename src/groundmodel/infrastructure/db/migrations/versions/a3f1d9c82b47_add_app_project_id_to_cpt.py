"""add app_project_id to cpt

Revision ID: a3f1d9c82b47
Revises: cf77c4baaddf
Create Date: 2026-05-07 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3f1d9c82b47"
down_revision = "cf77c4baaddf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add app_project_id for app-level project scoping (separate from GEF project_id)."""
    op.add_column("cpt", sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("idx_cpt_app_project_id", "cpt", ["app_project_id"])


def downgrade() -> None:
    """Remove app_project_id column and its index."""
    op.drop_index("idx_cpt_app_project_id", table_name="cpt")
    op.drop_column("cpt", "app_project_id")
