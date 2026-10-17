"""Raw lab-series tables — oedometer / triaxial readings per sample.

Revision ID: l4b5c6d7e8f9
Revises: c8d9e0f1a2b4
Create Date: 2026-09-29 12:00:00.000000

Owner rule (2026-09-28): "geolib uses already processed files, we need to get
the raw data in the db". The lab's raw exports (the oedometer control
listing, the newer oedometer module's raw dump, the triaxial per-point dumps)
land in five new tables, a nested family under ``sample``::

    lab_series_test        one imported test (FK sample, ON DELETE CASCADE)
      lab_series_specimen  one specimen (triaxial a/b/c; the oedometer's one)
        lab_series_stage   one load step / shear phase: the reading axis
                           (timestamps[] or point_numbers[]) + re-zero marks
          lab_series_channel  one named DOUBLE PRECISION[] per stage, with
                              unit, the lab's label and provenance
                              (measured | lab_derived | derived + formula)
      lab_series_lab_result  the lab's reported summary values (pass-through,
                             never an input)

Purely additive: five new tables, no existing column touched. The bundle
gains an optional nested ``lab_series_tests`` per sample; an older bundle
without it restores unchanged, so no ``format_version`` bump.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "l4b5c6d7e8f9"
down_revision = "c8d9e0f1a2b4"
branch_labels = None
depends_on = None


def _uuid(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    """A UUID column (the id / FK shape every table here uses)."""
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def upgrade() -> None:
    """Create the five lab-series tables and their indexes."""
    op.create_table(
        "lab_series_test",
        _uuid("id"),
        _uuid("sample_id"),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("test_type_token", sa.Text(), nullable=True),
        sa.Column("standard_token", sa.Text(), nullable=True),
        sa.Column("lab_job_number", sa.Text(), nullable=True),
        sa.Column("lab_sample_number", sa.Text(), nullable=True),
        sa.Column("lab_borehole_name", sa.Text(), nullable=True),
        sa.Column("lab_sequence_number", sa.Text(), nullable=True),
        sa.Column("sampling_depth_top_m", sa.Double(), nullable=True),
        sa.Column("sampling_depth_base_m", sa.Double(), nullable=True),
        sa.Column("visual_description", sa.Text(), nullable=True),
        sa.Column("test_start_date", sa.Date(), nullable=True),
        sa.Column("source_format", sa.Text(), nullable=False),
        sa.Column("source_file_name", sa.Text(), nullable=False),
        sa.Column("source_sha256", sa.Text(), nullable=False),
        sa.Column("source_native_file", sa.Text(), nullable=True),
        sa.Column("source_program_version", sa.Text(), nullable=True),
        sa.Column("source_header", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("import_issues", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("n_specimens", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["sample_id"], ["sample.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_lab_series_test_sample_id", "lab_series_test", ["sample_id"])
    op.create_index(
        "idx_lab_series_test_lab_sample_number", "lab_series_test", ["lab_sample_number"]
    )

    op.create_table(
        "lab_series_specimen",
        _uuid("id"),
        _uuid("test_id"),
        sa.Column("specimen_label", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("initial_height_mm", sa.Double(), nullable=True),
        sa.Column("initial_diameter_mm", sa.Double(), nullable=True),
        sa.Column("initial_wet_mass_g", sa.Double(), nullable=True),
        sa.Column("dry_mass_g", sa.Double(), nullable=True),
        sa.Column("initial_water_content_pct", sa.Double(), nullable=True),
        sa.Column("grain_density_t_m3", sa.Double(), nullable=True),
        sa.Column("grain_density_note", sa.Text(), nullable=True),
        sa.Column("specimen_depth_top_m", sa.Double(), nullable=True),
        sa.Column("specimen_depth_base_m", sa.Double(), nullable=True),
        sa.Column("strain_rate_mm_per_min", sa.Double(), nullable=True),
        sa.Column("consolidation_stress_kpa", sa.Double(), nullable=True),
        sa.Column("consolidation_volume_change_cm3", sa.Double(), nullable=True),
        sa.Column("failure_description", sa.Text(), nullable=True),
        sa.Column("calibration", postgresql.JSONB(), nullable=True),
        sa.Column("apparatus_id", sa.Text(), nullable=True),
        sa.Column("lever_ratio", sa.Double(), nullable=True),
        sa.Column("dial_coefficient_mm_per_unit", sa.Double(), nullable=True),
        sa.Column("mounting_date", sa.Date(), nullable=True),
        sa.Column("source_header", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("n_points", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["test_id"], ["lab_series_test.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_lab_series_specimen_test_id", "lab_series_specimen", ["test_id"])

    op.create_table(
        "lab_series_stage",
        _uuid("id"),
        _uuid("specimen_id"),
        sa.Column("stage_index", sa.Integer(), nullable=False),
        sa.Column("stage_kind", sa.Text(), nullable=False),
        sa.Column("direction_token", sa.Text(), nullable=True),
        sa.Column("hanger_load_kg", sa.Double(), nullable=True),
        sa.Column("target_stress_kpa", sa.Double(), nullable=True),
        sa.Column("height_at_start_mm", sa.Double(), nullable=True),
        sa.Column("lab_stage_settlement_mm", sa.Double(), nullable=True),
        sa.Column("lab_coefficient_label", sa.Text(), nullable=True),
        sa.Column("lab_coefficient", sa.Double(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column(
            "reading_timestamps", postgresql.ARRAY(sa.DateTime(timezone=False)), nullable=True
        ),
        sa.Column("point_numbers", postgresql.ARRAY(sa.Integer()), nullable=True),
        sa.Column("rezero_indices", postgresql.ARRAY(sa.Integer()), nullable=True),
        sa.Column("n_readings", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["specimen_id"], ["lab_series_specimen.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # The unique constraint's index also serves the specimen_id lookup.
        sa.UniqueConstraint("specimen_id", "stage_index", name="uq_lab_series_stage_index"),
    )

    op.create_table(
        "lab_series_channel",
        _uuid("id"),
        _uuid("stage_id"),
        sa.Column("channel_key", sa.Text(), nullable=False),
        sa.Column("source_label", sa.Text(), nullable=True),
        sa.Column("unit", sa.Text(), nullable=True),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column("series_values", postgresql.ARRAY(postgresql.DOUBLE_PRECISION()), nullable=False),
        sa.Column("formula", sa.Text(), nullable=True),
        sa.Column("derivation_inputs", postgresql.JSONB(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["stage_id"], ["lab_series_stage.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stage_id", "channel_key", name="uq_lab_series_channel_key"),
    )

    op.create_table(
        "lab_series_lab_result",
        _uuid("id"),
        _uuid("test_id"),
        sa.Column("specimen_label", sa.Text(), nullable=True),
        sa.Column("stage_index", sa.Integer(), nullable=True),
        sa.Column("parameter", sa.Text(), nullable=False),
        sa.Column("value_numeric", sa.Double(), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("unit", sa.Text(), nullable=True),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["test_id"], ["lab_series_test.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_lab_series_lab_result_test_id", "lab_series_lab_result", ["test_id"])


def downgrade() -> None:
    """Drop the five lab-series tables (children first)."""
    op.drop_index("idx_lab_series_lab_result_test_id", table_name="lab_series_lab_result")
    op.drop_table("lab_series_lab_result")
    op.drop_table("lab_series_channel")
    op.drop_table("lab_series_stage")
    op.drop_index("idx_lab_series_specimen_test_id", table_name="lab_series_specimen")
    op.drop_table("lab_series_specimen")
    op.drop_index("idx_lab_series_test_lab_sample_number", table_name="lab_series_test")
    op.drop_index("idx_lab_series_test_sample_id", table_name="lab_series_test")
    op.drop_table("lab_series_test")
