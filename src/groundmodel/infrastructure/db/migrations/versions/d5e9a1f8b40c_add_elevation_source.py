"""add elevation_source to cpt and borehole

Revision ID: d5e9a1f8b40c
Revises: f4b2c91e5a78
Create Date: 2026-05-13 17:30:00.000000

Adds an ``elevation_source`` column to both ``cpt`` and ``borehole`` so
the refresh-on-duplicate import path can overwrite an imported Z
(e.g. DOV corrected a published value) without clobbering a manual
edit the user made afterwards — debt #8.

Stored as ``VARCHAR(8)`` matching the ``StrEnum`` values
``"dov"`` / ``"gef"`` / ``"manual"`` / ``"none"``. We avoid a
Postgres ``ENUM`` type because (a) StrEnum's string round-trip is
trivial via VARCHAR + the application layer, (b) adding new enum
values later doesn't need a separate ``ALTER TYPE`` migration.

Backfill rule for existing rows:

* When ``elevation_m IS NULL`` → ``"none"``.
* When ``elevation_m IS NOT NULL`` AND ``project_id = 'DOV'`` →
  ``"dov"`` (DOV imports stamp ``project_id = 'DOV'``).
* Everything else with a non-null Z → ``"gef"`` (GEF imports are the
  only other source today).

After the backfill, the column is NOT NULL — every row carries a
provenance.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d5e9a1f8b40c"
down_revision = "f4b2c91e5a78"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add ``elevation_source`` to cpt and borehole, backfill it, then make it NOT NULL."""
    # Add the column nullable first so we can backfill existing rows
    # before flipping to NOT NULL. New rows from this point on stamp
    # an explicit value via the ORM defaults.
    for table in ("cpt", "borehole"):
        op.add_column(table, sa.Column("elevation_source", sa.String(length=8), nullable=True))

    # Backfill: DOV-tagged rows with a non-null Z came from DOV; any
    # remaining row with a non-null Z came from a GEF file (the only
    # other source today); rows with no Z get "none".
    op.execute(
        """
        UPDATE cpt
        SET elevation_source = CASE
            WHEN elevation_m IS NULL THEN 'none'
            WHEN project_id = 'DOV' THEN 'dov'
            ELSE 'gef'
        END
        """
    )
    op.execute(
        """
        UPDATE borehole
        SET elevation_source = CASE
            WHEN elevation_m IS NULL THEN 'none'
            WHEN project_id = 'DOV' THEN 'dov'
            ELSE 'gef'
        END
        """
    )

    # Flip to NOT NULL after the backfill. The application layer is
    # responsible for keeping it consistent from here on out.
    for table in ("cpt", "borehole"):
        op.alter_column(table, "elevation_source", nullable=False)


def downgrade() -> None:
    """Drop ``elevation_source`` from cpt and borehole."""
    for table in ("cpt", "borehole"):
        op.drop_column(table, "elevation_source")
