"""grain_size, atterberg_limits, caco3_content, organic_content, water_content tables

Revision ID: d4f8a92b6c10
Revises: a26b3df9c041
Create Date: 2026-05-08 18:00:00.000000

Phase A3 of borehole imports — adds the five lab-test tables. Each FKs to
``sample.id`` with ``ondelete="CASCADE"`` so removing a sample (or its parent
borehole) cleans up all of its lab tests transitively.

* grain_size           diameters_mm + pct_larger ARRAYs (sieve / hydrometer / laser)
* atterberg_limits     liquid_limit_pct + plastic_limit_pct + non_plastic flag
                       (PI is computed on read from LL - PL, NEVER stored)
* caco3_content        single content_pct measurement
* organic_content      carbon_pct + matter_pct independent (no Van Bemmelen auto-conversion)
* water_content        single content_pct (organic soils / peats can exceed 100%)

All tables index on sample_id for FK lookup.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "d4f8a92b6c10"
down_revision = "a26b3df9c041"
branch_labels = None
depends_on = None


def _create_simple_test_table(name: str, value_columns: list[sa.Column]) -> None:
    """Create a {name} table: id + sample_id FK + value_columns + method + test_date.

    All five lab tables share the id / sample_id / method / test_date scaffold;
    only the value columns differ. Wrapping the boilerplate keeps the upgrade
    function readable without sprinkling 30 lines of duplicate Column() calls.
    """
    op.create_table(
        name,
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sample_id", postgresql.UUID(as_uuid=True), nullable=False),
        *value_columns,
        sa.Column("method", sa.String(length=100), nullable=True),
        sa.Column("test_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["sample_id"], ["sample.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(f"idx_{name}_sample_id", name, ["sample_id"], unique=False)


def upgrade() -> None:
    """Create the five lab-test tables, each with a sample index."""
    # grain_size — two parallel ARRAYs + pre-treatment booleans.
    op.create_table(
        "grain_size",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sample_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("diameters_mm", postgresql.ARRAY(sa.DOUBLE_PRECISION()), nullable=False),
        sa.Column("pct_larger", postgresql.ARRAY(sa.DOUBLE_PRECISION()), nullable=False),
        sa.Column("method", sa.String(length=100), nullable=True),
        sa.Column("test_date", sa.Date(), nullable=True),
        sa.Column("lime_removed", sa.Boolean(), nullable=True),
        sa.Column("organics_removed", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(["sample_id"], ["sample.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_grain_size_sample_id", "grain_size", ["sample_id"], unique=False)

    # atterberg_limits — LL + PL + non_plastic tri-state. PI is computed on read.
    _create_simple_test_table(
        "atterberg_limits",
        [
            sa.Column("liquid_limit_pct", sa.Double(), nullable=True),
            sa.Column("plastic_limit_pct", sa.Double(), nullable=True),
            sa.Column("non_plastic", sa.Boolean(), nullable=True),
        ],
    )

    # caco3_content — single content %.
    _create_simple_test_table(
        "caco3_content",
        [sa.Column("content_pct", sa.Double(), nullable=True)],
    )

    # organic_content — OC and OM independently (no Van Bemmelen auto-conversion).
    _create_simple_test_table(
        "organic_content",
        [
            sa.Column("carbon_pct", sa.Double(), nullable=True),
            sa.Column("matter_pct", sa.Double(), nullable=True),
        ],
    )

    # water_content — single content %, may exceed 100 for organic soils.
    _create_simple_test_table(
        "water_content",
        [sa.Column("content_pct", sa.Double(), nullable=True)],
    )


def downgrade() -> None:
    """Drop the five lab-test tables and their sample indexes."""
    for name in (
        "water_content",
        "organic_content",
        "caco3_content",
        "atterberg_limits",
        "grain_size",
    ):
        op.drop_index(f"idx_{name}_sample_id", table_name=name)
        op.drop_table(name)
