"""cpt + borehole — add elevation rollback snapshot columns (debt #21).

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-18 00:00:00.000000

The ``original_*`` triple snapshots the upstream (DOV / GEF) surface-Z
the first time the user manually overrides it, so clearing a manual edit
restores the surveyed value instead of nulling the row (a graceful "undo
my typo" rather than losing Z entirely). NULL = no snapshot held — the
default for every existing row, which is the correct pre-#21 state (a
Clear on those still drops to no-Z, unchanged behaviour).

All three columns are nullable with no server_default: a snapshot is
genuinely absent until the first override, and NULL is the sentinel the
domain logic (``domain.services.elevation_rollback``) keys on.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

_TABLES = ("cpt", "borehole")


def upgrade() -> None:
    """Add original_elevation_m / original_z_epsg / original_elevation_source."""
    for table in _TABLES:
        op.add_column(table, sa.Column("original_elevation_m", sa.Double(), nullable=True))
        op.add_column(table, sa.Column("original_z_epsg", sa.Integer(), nullable=True))
        op.add_column(
            table,
            sa.Column("original_elevation_source", sa.String(length=8), nullable=True),
        )


def downgrade() -> None:
    """Drop the rollback snapshot columns from both tables."""
    for table in _TABLES:
        op.drop_column(table, "original_elevation_source")
        op.drop_column(table, "original_z_epsg")
        op.drop_column(table, "original_elevation_m")
