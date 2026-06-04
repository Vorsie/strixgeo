"""add index on body.app_project_id

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-06-04 13:00:00.000000

The bundle build and ``_restore_bodies`` both filter
``BodyOrm.app_project_id == project_id``; without an index those are
sequential scans on every save / restore. Every other project-scoped root
table (cpt, borehole, geological_model, cross_section) already carries an
``idx_*_app_project_id``; ``body`` was missing one.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "c2d3e4f5a6b7"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the project-scope index on body."""
    op.create_index("idx_body_app_project_id", "body", ["app_project_id"])


def downgrade() -> None:
    """Drop the project-scope index on body."""
    op.drop_index("idx_body_app_project_id", table_name="body")
