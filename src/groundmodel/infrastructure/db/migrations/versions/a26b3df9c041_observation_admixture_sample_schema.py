"""observation, observation_layer, admixture, sample tables

Revision ID: a26b3df9c041
Revises: f5c1b8e74a90
Create Date: 2026-05-08 17:00:00.000000

Phase A2 of borehole imports — adds the four child tables that depend on
the ``borehole`` foundation from migration f5c1b8e74a90.

Schema:
* observation        FK → borehole, observation_type discriminator + author/date/quality
                     metadata.
* observation_layer  FK → observation, top/base + colour + main_soil_codes ARRAY +
                     description + layer_index.
* admixture          FK → observation_layer, soil_code + amount + locally — separate table so we can
                     query "find layers with glauconite" via the index.
* sample             FK → borehole, top/base + sample metadata; lab tests will FK to sample
                     in Phase A3.

All four cascade-delete from their parent so removing a borehole cleans up
everything beneath it.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a26b3df9c041"
down_revision = "f5c1b8e74a90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the observation, observation_layer, admixture and sample tables."""
    op.create_table(
        "observation",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("borehole_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("observation_type", sa.String(length=50), nullable=False),
        sa.Column("author", sa.String(length=300), nullable=True),
        sa.Column("observation_date", sa.Date(), nullable=True),
        sa.Column("reliability", sa.String(length=50), nullable=True),
        sa.Column("score_category", sa.String(length=50), nullable=True),
        sa.Column("drill_method_score", sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(["borehole_id"], ["borehole.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_observation_borehole_id", "observation", ["borehole_id"], unique=False)
    op.create_index("idx_observation_type", "observation", ["observation_type"], unique=False)

    op.create_table(
        "observation_layer",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("observation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("top_m", sa.Double(), nullable=False),
        sa.Column("base_m", sa.Double(), nullable=False),
        sa.Column("color", sa.String(length=50), nullable=True),
        sa.Column(
            "main_soil_codes",
            postgresql.ARRAY(sa.String(length=20)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("layer_index", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["observation_id"], ["observation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_observation_layer_observation_id",
        "observation_layer",
        ["observation_id"],
        unique=False,
    )

    op.create_table(
        "admixture",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("observation_layer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("soil_code", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("locally", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(
            ["observation_layer_id"], ["observation_layer.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_admixture_observation_layer_id",
        "admixture",
        ["observation_layer_id"],
        unique=False,
    )
    op.create_index("idx_admixture_soil_code", "admixture", ["soil_code"], unique=False)

    op.create_table(
        "sample",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("borehole_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("depth_top_m", sa.Double(), nullable=False),
        sa.Column("depth_base_m", sa.Double(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("sample_number", sa.String(length=50), nullable=True),
        sa.Column("sample_type", sa.String(length=50), nullable=True),
        sa.Column("composition", sa.String(length=50), nullable=True),
        sa.Column("instrument", sa.String(length=50), nullable=True),
        sa.Column("sampling_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["borehole_id"], ["borehole.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_sample_borehole_id", "sample", ["borehole_id"], unique=False)


def downgrade() -> None:
    """Drop the four tables and their indexes in reverse dependency order."""
    op.drop_index("idx_sample_borehole_id", table_name="sample")
    op.drop_table("sample")

    op.drop_index("idx_admixture_soil_code", table_name="admixture")
    op.drop_index("idx_admixture_observation_layer_id", table_name="admixture")
    op.drop_table("admixture")

    op.drop_index("idx_observation_layer_observation_id", table_name="observation_layer")
    op.drop_table("observation_layer")

    op.drop_index("idx_observation_type", table_name="observation")
    op.drop_index("idx_observation_borehole_id", table_name="observation")
    op.drop_table("observation")
