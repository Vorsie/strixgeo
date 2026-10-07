"""CPT import provenance -- how a CPT that did not come from a data file was made.

Revision ID: b7c1d2e3f4a5
Revises: l4b5c6d7e8f9
Create Date: 2026-09-30 09:00:00.000000

The PDF CPT digitiser (Data -> Import -> CPTs from a PDF report) stores
soundings read off the graphs of a contractor's report. Data Integrity rule 1
says a derived value carries its provenance, and no existing ``cpt`` column
fits: the digitiser records the report file name + SHA-256, the pages, the
calibration of every page, the digitiser version, how the series was sampled,
whether the depth was derived from a plotted elevation, and the clipped
points (a flag the series arrays have no column for).

Additive and nullable: every existing row (GEF / DOV imports, whose file is
their provenance) keeps NULL, and a ``.strix`` written before this column
restores with NULL (the bundle builds CPTs column by column and drops keys it
does not know, so an older build reading a newer ``.strix`` ignores it). No
``format_version`` bump.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b7c1d2e3f4a5"
down_revision = "l4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable ``cpt.import_provenance`` JSONB column."""
    op.add_column(
        "cpt",
        sa.Column("import_provenance", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    """Drop ``cpt.import_provenance``."""
    op.drop_column("cpt", "import_provenance")
