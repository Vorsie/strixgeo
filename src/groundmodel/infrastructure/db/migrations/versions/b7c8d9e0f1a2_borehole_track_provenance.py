"""Borehole track provenance - source + edited_manually_at on observations and field logs.

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f7
Create Date: 2026-09-29 20:00:00.000000

The owner can now add a track to a borehole by hand and change any track,
imported ones included (2026-09-29). Data Integrity rule 1: a typed value must
never pass for a value DOV published, so every observation (one track) and
every field-log interval (the rows of one field-log track) carries:

* ``source`` - ``"dov"`` (imported) or ``"manual"`` (created by hand). An
  imported track the engineer edits STAYS ``"dov"`` (it keeps its
  ``dov_permkey`` upstream identity).
* ``edited_manually_at`` - when the track was last saved from the track
  editor; NULL for an untouched import.

Additive: ``source`` is NOT NULL with a server default of ``'dov'`` (every
existing row came from a DOV import - the only writer before this revision),
``edited_manually_at`` is nullable. No bundle ``format_version`` bump - the
generic bundle serialiser emits the two new columns and an older bundle
without them restores to the same defaults.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None

_TABLES = ("observation", "field_log_interval")


def upgrade() -> None:
    """Add ``source`` (default 'dov') and ``edited_manually_at`` to both track tables."""
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "source",
                sa.String(length=20),
                nullable=False,
                server_default=sa.text("'dov'"),
            ),
        )
        op.add_column(
            table,
            sa.Column("edited_manually_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    """Drop the two provenance columns from both track tables."""
    for table in _TABLES:
        op.drop_column(table, "edited_manually_at")
        op.drop_column(table, "source")
