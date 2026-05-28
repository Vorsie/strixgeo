"""litho lens boundary shape (#163f Slice 2)

Adds user-authored lens boundary shaping, keyed by a stable content key so the
shape survives lens re-detection (body_ordinal is volatile):

- ``litho_lens.content_key`` — stamped by DetectLithoLenses from the lens's
  three defining contact ids; the stable join key to the shape.
- ``litho_lens_shape`` — one row per (model, content_key): the render style +
  the container the boundary nodes hang off.
- ``litho_lens_boundary_node`` — ordered control nodes per boundary
  (upper/lower), section-local (along_m, elevation_m).

Revision ID: b2f1c9a47d30
Revises: a6a91e68f15a
Create Date: 2026-05-28 23:30:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b2f1c9a47d30"
down_revision = "a6a91e68f15a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add content_key to litho_lens + the shape and boundary-node tables."""
    op.add_column(
        "litho_lens",
        sa.Column("content_key", sa.Text(), nullable=True),
    )
    op.create_index(
        "idx_litho_lens_content_key",
        "litho_lens",
        ["model_id", "content_key"],
    )

    op.create_table(
        "litho_lens_shape",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_key", sa.Text(), nullable=False),
        sa.Column(
            "render_style",
            sa.Text(),
            nullable=False,
            server_default="straight",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "render_style IN ('straight','blocky','rounded')",
            name="ck_litho_lens_shape_render_style",
        ),
        sa.UniqueConstraint("model_id", "content_key", name="uq_litho_lens_shape_model_key"),
    )

    op.create_table(
        "litho_lens_boundary_node",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "shape_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("litho_lens_shape.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("boundary", sa.Text(), nullable=False),
        sa.Column("node_index", sa.Integer(), nullable=False),
        sa.Column("along_m", sa.Float(), nullable=False),
        sa.Column("elevation_m", sa.Float(), nullable=False),
        sa.CheckConstraint(
            "boundary IN ('upper','lower')",
            name="ck_litho_lens_boundary_node_boundary",
        ),
        sa.UniqueConstraint(
            "shape_id", "boundary", "node_index", name="uq_litho_lens_boundary_node_order"
        ),
    )
    op.create_index(
        "idx_litho_lens_boundary_node_shape",
        "litho_lens_boundary_node",
        ["shape_id"],
    )


def downgrade() -> None:
    """Drop the lens-shape tables + the content_key column."""
    op.drop_index("idx_litho_lens_boundary_node_shape", table_name="litho_lens_boundary_node")
    op.drop_table("litho_lens_boundary_node")
    op.drop_table("litho_lens_shape")
    op.drop_index("idx_litho_lens_content_key", table_name="litho_lens")
    op.drop_column("litho_lens", "content_key")
