"""add litho_layer.body_id

Revision ID: 10c39de474aa
Revises: u5v6w7x8y9z0
Create Date: 2026-06-03 10:59:14.543399

Adds a nullable ``body_id`` FK + index to ``litho_layer``.  This is the
DB-migration half of the per-instance body identity feature: each distinct
uncorrelated litho unit becomes its own "instance" backed by a ``body`` row.
The column is nullable (legacy layers have no body) and the FK uses
``ON DELETE SET NULL`` so deleting a body orphans the layer rather than
cascading it away.  The ORM model change lands in a separate later task.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "10c39de474aa"
down_revision = "u5v6w7x8y9z0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable body_id FK + its index to litho_layer."""
    op.add_column(
        "litho_layer",
        sa.Column("body_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_litho_layer_body_id",
        "litho_layer",
        "body",
        ["body_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_litho_layer_body", "litho_layer", ["body_id"])


def downgrade() -> None:
    """Drop the body_id index, FK, and column."""
    op.drop_index("idx_litho_layer_body", table_name="litho_layer")
    op.drop_constraint("fk_litho_layer_body_id", "litho_layer", type_="foreignkey")
    op.drop_column("litho_layer", "body_id")
