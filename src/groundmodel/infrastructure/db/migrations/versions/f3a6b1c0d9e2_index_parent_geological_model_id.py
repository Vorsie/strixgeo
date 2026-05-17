"""index on geological_model.parent_geological_model_id

Revision ID: f3a6b1c0d9e2
Revises: e2f5a9c3d8b1
Create Date: 2026-05-17 00:00:00.000000

Senior-review S2: PostgreSQL does NOT auto-index foreign-key columns
(unlike MySQL). ``has_child_models`` runs
``SELECT id FROM geological_model WHERE parent_geological_model_id = $1``
on every model delete (the 409 pre-check); without an index that is a
sequential scan. A separate revision because e2f5a9c3d8b1 has already
been applied to the dev + integration DBs — amending an applied
migration would not re-run.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "f3a6b1c0d9e2"
down_revision = "e2f5a9c3d8b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the FK index used by the delete-409 child-model pre-check."""
    op.create_index(
        "ix_geological_model_parent_id",
        "geological_model",
        ["parent_geological_model_id"],
    )


def downgrade() -> None:
    """Drop the parent-FK index."""
    op.drop_index("ix_geological_model_parent_id", table_name="geological_model")
