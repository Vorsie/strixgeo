"""scalar_lab_test: promote remaining string cols to TEXT

Revision ID: f7a8b29d4e15
Revises: d3f6b820a1c4
Create Date: 2026-05-09 19:00:00.000000

The catch-all ``scalar_lab_test`` is meant to accept whatever DOV
publishes. Capping ``parameter_group`` (80) / ``parameter`` (160) /
``method`` (120) was a defensible default at the start, but the
truncation pattern bit us 3× in 2 days on other columns
(``observation_layer.description``, ``sample.description``,
``scalar_lab_test.unit``+``value_text``). Promoting these three to
``TEXT`` aligns with the now-explicit policy: any column holding
free-form text from external sources defaults to TEXT, and only a
fixed-spec value (a code, an enum) keeps a VARCHAR cap.

Observed values currently fit the old caps, but the cost is a single
``ALTER COLUMN`` per column on an empty table — cheap insurance.

``detection_condition`` stays capped at VARCHAR(8) because it's a
small known enum (``"NM"`` / ``"<"`` / NULL).
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f7a8b29d4e15"
down_revision = "d3f6b820a1c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Widen ``parameter_group``, ``parameter`` and ``method`` of ``scalar_lab_test`` to TEXT."""
    op.alter_column(
        "scalar_lab_test",
        "parameter_group",
        existing_type=sa.String(length=80),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "scalar_lab_test",
        "parameter",
        existing_type=sa.String(length=160),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "scalar_lab_test",
        "method",
        existing_type=sa.String(length=120),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Narrow the three ``scalar_lab_test`` columns back to their VARCHAR caps."""
    op.alter_column(
        "scalar_lab_test",
        "method",
        existing_type=sa.Text(),
        type_=sa.String(length=120),
        existing_nullable=True,
    )
    op.alter_column(
        "scalar_lab_test",
        "parameter",
        existing_type=sa.Text(),
        type_=sa.String(length=160),
        existing_nullable=False,
    )
    op.alter_column(
        "scalar_lab_test",
        "parameter_group",
        existing_type=sa.Text(),
        type_=sa.String(length=80),
        existing_nullable=False,
    )
