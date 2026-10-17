"""widen scalar_lab_test.unit + value_text to TEXT

Revision ID: d3f6b820a1c4
Revises: c2a4e91d6f55
Create Date: 2026-05-09 16:30:00.000000

The catch-all ``scalar_lab_test`` is meant to accept any DOV scalar
observation — capping ``unit`` at VARCHAR(20) and ``value_text`` at
VARCHAR(50) put us in the same surprise-truncation pattern as the
earlier ``observation_layer.description`` overflow. Real-world examples
that exceed the old caps:

* ``unit = "g MB/1000g droog monster"`` (24 chars) on the methylene-blue
  clay-content test.
* ``value_text = "kalkh. kleih. fijnzand à zandh. leem"`` (36 chars)
  on the BGGG-norm soil description (5-cm cushion above the old
  VARCHAR(50) but in real data we've seen longer narrative
  classifications too).

Both columns become ``TEXT`` (uncapped). ALTER COLUMN to TEXT is a
no-op data-wise; the downgrade clamps back to the previous lengths,
which would truncate any longer values inserted in the meantime.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d3f6b820a1c4"
down_revision = "c2a4e91d6f55"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Widen ``scalar_lab_test.unit`` and ``value_text`` to TEXT."""
    op.alter_column(
        "scalar_lab_test",
        "unit",
        existing_type=sa.String(length=20),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "scalar_lab_test",
        "value_text",
        existing_type=sa.String(length=50),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Narrow ``value_text`` and ``unit`` back to their VARCHAR caps."""
    op.alter_column(
        "scalar_lab_test",
        "value_text",
        existing_type=sa.Text(),
        type_=sa.String(length=50),
        existing_nullable=True,
    )
    op.alter_column(
        "scalar_lab_test",
        "unit",
        existing_type=sa.Text(),
        type_=sa.String(length=20),
        existing_nullable=True,
    )
