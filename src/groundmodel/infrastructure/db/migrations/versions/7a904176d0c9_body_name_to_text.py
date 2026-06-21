"""body name to text.

Widen ``body.name`` from ``VARCHAR(120)`` to ``TEXT``. A body name is a
user-entered free-form label, and per the CLAUDE.md schema-design rule
free-form text columns are ``TEXT`` (``VARCHAR(N)`` is for fixed-spec codes /
enums / ids) so they never surprise-truncate. No data change — every existing
value already fits. Debt #126.

Revision ID: 7a904176d0c9
Revises: de2d3988aee7
Create Date: 2026-06-21 23:16:27.756821
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7a904176d0c9"
down_revision = "de2d3988aee7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Widen ``body.name`` to ``TEXT``."""
    op.alter_column(
        "body",
        "name",
        existing_type=sa.String(length=120),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Narrow ``body.name`` back to ``VARCHAR(120)`` (truncates values > 120)."""
    op.alter_column(
        "body",
        "name",
        existing_type=sa.Text(),
        type_=sa.String(length=120),
        existing_nullable=True,
        postgresql_using="left(name, 120)",
    )
