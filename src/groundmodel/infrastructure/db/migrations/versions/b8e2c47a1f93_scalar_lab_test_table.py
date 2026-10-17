"""scalar_lab_test table — generic catch-all for scalar lab observations.

Revision ID: b8e2c47a1f93
Revises: d4f8a92b6c10
Create Date: 2026-05-09 12:00:00.000000

Adds the ``scalar_lab_test`` table — single home for DOV scalar lab
observations that don't fit one of the five typed families
(grain_size / atterberg_limits / caco3_content / organic_content /
water_content). Currently captures grain density, ASTM classification,
and descriptive calcareous content; future scalar parameters land here
as a config addition (DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS) without a
new migration.

Numeric vs text values: DOV's ``resultaat`` is a string in WFS rows
but represents a number most of the time. We attempt a numeric parse
and store the result in ``value_numeric``; non-numeric (the
classification codes) lands in ``value_text``. Both NULL only when
``detection_condition`` flags the row as not-measurable.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b8e2c47a1f93"
down_revision = "d4f8a92b6c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``scalar_lab_test`` table and its sample index."""
    op.create_table(
        "scalar_lab_test",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sample_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Source-vocabulary group + parameter identifiers — pass-through.
        sa.Column("parameter_group", sa.String(length=80), nullable=False),
        sa.Column("parameter", sa.String(length=160), nullable=False),
        sa.Column("value_numeric", sa.Double(), nullable=True),
        sa.Column("value_text", sa.String(length=50), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("method", sa.String(length=120), nullable=True),
        sa.Column("test_date", sa.Date(), nullable=True),
        sa.Column("detection_condition", sa.String(length=8), nullable=True),
        sa.ForeignKeyConstraint(["sample_id"], ["sample.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_scalar_lab_test_sample_id",
        "scalar_lab_test",
        ["sample_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the ``scalar_lab_test`` table and its index."""
    op.drop_index("idx_scalar_lab_test_sample_id", table_name="scalar_lab_test")
    op.drop_table("scalar_lab_test")
