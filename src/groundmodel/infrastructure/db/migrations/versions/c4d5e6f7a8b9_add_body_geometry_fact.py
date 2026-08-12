"""Add body_geometry_fact — persisted geometric body-connectivity facts.

Owner ruling 2026-08-12: every set of same-lithology units whose fill regions
connect must share one litho_layer.body_id ("how else are we going to extract
qc or sample data by body"). The geometric merge existed twice as unpersisted
alias maps (frontend per-section, backend cross-section at build time); this
table is the persistence: observed adjacent layer pairs the resolver unions
alongside user-approved correlation edges.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the body_geometry_fact table."""
    op.create_table(
        "body_geometry_fact",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "layer_a_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("litho_layer.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "layer_b_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("litho_layer.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("layer_a_id < layer_b_id", name="ck_body_geometry_fact_canonical_order"),
        sa.UniqueConstraint(
            "model_id", "layer_a_id", "layer_b_id", name="uq_body_geometry_fact_pair"
        ),
    )
    op.create_index("ix_body_geometry_fact_model_id", "body_geometry_fact", ["model_id"])


def downgrade() -> None:
    """Drop the body_geometry_fact table."""
    op.drop_index("ix_body_geometry_fact_model_id", table_name="body_geometry_fact")
    op.drop_table("body_geometry_fact")
