"""initial borehole schema — borehole, drill_segment, field_log_interval

Revision ID: f5c1b8e74a90
Revises: d70b1a8e9c34
Create Date: 2026-05-08 16:00:00.000000

Creates the foundation tables for borehole imports (Phase 3a Layer 2).
Observation, sample, and lab-test tables land in subsequent migrations.

* ``borehole`` mirrors the CPT pattern: source identifiers (project_id +
  test_id) for dedup, raw source coordinates with their own EPSG codes,
  PostGIS geometry in the source CRS, denormalised counts for cheap
  list views.
* ``drill_segment`` and ``field_log_interval`` link back to ``borehole.id``
  with CASCADE delete so removing a borehole cleans up its children.
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f5c1b8e74a90"
down_revision = "d70b1a8e9c34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the borehole, drill_segment and field_log_interval tables."""
    op.create_table(
        "borehole",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("test_id", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("location_x", sa.Double(), nullable=False),
        sa.Column("location_y", sa.Double(), nullable=False),
        sa.Column("elevation_m", sa.Double(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("z_epsg", sa.Integer(), nullable=True),
        sa.Column(
            "location",
            geoalchemy2.types.Geometry(
                geometry_type="POINT", spatial_index=False, from_text="ST_GeomFromEWKT"
            ),
            nullable=True,
        ),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("drill_method", sa.String(length=200), nullable=True),
        sa.Column("borehole_type", sa.String(length=200), nullable=True),
        sa.Column("purpose", sa.String(length=200), nullable=True),
        sa.Column("municipality", sa.String(length=200), nullable=True),
        sa.Column("executor", sa.String(length=200), nullable=True),
        sa.Column("total_depth_m", sa.Double(), nullable=True),
        sa.Column("water_table_depth_m", sa.Double(), nullable=True),
        sa.Column("n_drill_segments", sa.Integer(), nullable=True),
        sa.Column("n_field_log_intervals", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_borehole_app_project_id", "borehole", ["app_project_id"], unique=False)
    op.create_index(
        "idx_borehole_location", "borehole", ["location"], unique=False, postgresql_using="gist"
    )

    op.create_table(
        "drill_segment",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("borehole_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("top_m", sa.Double(), nullable=False),
        sa.Column("base_m", sa.Double(), nullable=False),
        sa.Column("method", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(["borehole_id"], ["borehole.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_drill_segment_borehole_id", "drill_segment", ["borehole_id"], unique=False)

    op.create_table(
        "field_log_interval",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("borehole_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("top_m", sa.Double(), nullable=False),
        sa.Column("base_m", sa.Double(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("value", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(["borehole_id"], ["borehole.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_field_log_interval_borehole_id",
        "field_log_interval",
        ["borehole_id"],
        unique=False,
    )
    op.create_index("idx_field_log_interval_kind", "field_log_interval", ["kind"], unique=False)


def downgrade() -> None:
    """Drop the borehole foundation tables and their indexes."""
    op.drop_index("idx_field_log_interval_kind", table_name="field_log_interval")
    op.drop_index("idx_field_log_interval_borehole_id", table_name="field_log_interval")
    op.drop_table("field_log_interval")

    op.drop_index("idx_drill_segment_borehole_id", table_name="drill_segment")
    op.drop_table("drill_segment")

    op.drop_index("idx_borehole_location", table_name="borehole")
    op.drop_index("idx_borehole_app_project_id", table_name="borehole")
    op.drop_table("borehole")
