"""add dov_permkey to children of Borehole and Sample for refresh-on-duplicate

Revision ID: a91c4e7b6f23
Revises: f7a8b29d4e15
Create Date: 2026-05-09 22:00:00.000000

Adds a nullable ``dov_permkey VARCHAR(50)`` column to every Borehole-
or Sample-child table that holds DOV-sourced data. Plus a partial
UNIQUE index per parent (``UNIQUE (parent_id, dov_permkey) WHERE
dov_permkey IS NOT NULL``) so future re-imports can detect "row
already stored" by stable upstream identity instead of relying on
"the entire borehole was new".

Why a partial index, not a hard NOT NULL: legacy rows pre-dating this
column have NULL permkey, and we don't want to either backfill (we'd
guess) or refuse to write (we'd lose). NULL means "no upstream
identity recorded"; never participates in dedup.

Atterberg uses the LL row's permkey (PL row's identity is collapsed
into the same ORM row by the orchestrator's aggregation step).

Sample's parent is Borehole (permkey scoped per borehole). All other
families' parent is Sample (permkey scoped per sample).
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a91c4e7b6f23"
down_revision = "f7a8b29d4e15"
branch_labels = None
depends_on = None


# (table, parent FK column) — every child of either Borehole or Sample.
TABLES: list[tuple[str, str]] = [
    ("observation", "borehole_id"),
    ("sample", "borehole_id"),
    ("grain_size", "sample_id"),
    ("atterberg_limits", "sample_id"),
    ("caco3_content", "sample_id"),
    ("organic_content", "sample_id"),
    ("water_content", "sample_id"),
    ("scalar_lab_test", "sample_id"),
]


def upgrade() -> None:
    """Add ``dov_permkey`` and its partial unique index to every DOV child table."""
    for table, parent_col in TABLES:
        op.add_column(table, sa.Column("dov_permkey", sa.String(length=50), nullable=True))
        op.create_index(
            f"idx_{table}_dov_permkey",
            table,
            [parent_col, "dov_permkey"],
            unique=True,
            postgresql_where=sa.text("dov_permkey IS NOT NULL"),
        )


def downgrade() -> None:
    """Drop the partial unique indexes and the ``dov_permkey`` columns."""
    for table, _ in reversed(TABLES):
        op.drop_index(f"idx_{table}_dov_permkey", table_name=table)
        op.drop_column(table, "dov_permkey")
