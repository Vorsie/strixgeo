"""Add CHECK constraint source IN ('manual','auto') on litho_correlation_edge (#127).

Revision ID: j4d5e6f7a8b9
Revises: i3c4d5e6f7a8
Create Date: 2026-05-25 11:56:34.287787

The ``source`` column was added earlier as VARCHAR(30) with a server default
of ``'manual'`` but without a database-level CHECK constraint.  The
auto-correlate feature (#127) writes ``'auto'`` rows — this migration locks
the column to exactly the two permitted values so any future code path that
accidentally writes an unknown token is caught at the DB boundary instead of
silently propagating stale data.

Existing rows are all ``'manual'`` (server_default); the constraint adds
without any data backfill.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "j4d5e6f7a8b9"
down_revision = "i3c4d5e6f7a8"
branch_labels = None
depends_on = None

_CONSTRAINT_NAME = "ck_litho_correlation_edge_source"
_TABLE = "litho_correlation_edge"


def upgrade() -> None:
    """Add CHECK constraint permitting only 'manual' and 'auto' as source values."""
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        _TABLE,
        sa.text("source IN ('manual', 'auto')"),
    )


def downgrade() -> None:
    """Drop the CHECK constraint (column reverts to unconstrained VARCHAR(30))."""
    op.drop_constraint(_CONSTRAINT_NAME, _TABLE, type_="check")
