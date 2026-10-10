"""Borehole import provenance + sample label -- a borehole read off a PDF report.

Revision ID: p6d7e8f9a0b1
Revises: b7c1d2e3f4a5
Create Date: 2026-10-10 09:00:00.000000

The borehole-log PDF digitiser (Data -> Import -> Boring -> "Uit een
pdf-rapport") stores boreholes read off the boorstaten / boorprofielen of a
contractor's report. Data Integrity rule 1 says a derived value carries its
provenance, and no ``borehole`` column fits: the import records the report
file name + SHA-256, the pages, the layout profile, the digitiser version, the
per-sheet columns and axis fits, and the user's confirmation of an assumed
coordinate system or water-level unit (owner rulings 2026-10-08, 3 and 4).
The twin of ``cpt.import_provenance`` (migration b7c1d2e3f4a5).

``sample.sample_label``: the printed sample number before the dash ("S10" of
"S10-0550471459/", owner ruling 6): the key the lab reports reference. The
verbatim id stays in ``sample_number``.

Additive and nullable: every existing row (DOV imports, hand-typed tracks)
keeps NULL, and a ``.strix`` written before these columns restores with NULL
(the bundle builds rows column by column and drops keys it does not know, so
an older build reading a newer ``.strix`` ignores them). No ``format_version``
bump.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "p6d7e8f9a0b1"
down_revision = "b7c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add ``borehole.import_provenance`` (JSONB) and ``sample.sample_label``, both nullable."""
    op.add_column(
        "borehole",
        sa.Column("import_provenance", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "sample",
        sa.Column("sample_label", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    """Drop ``sample.sample_label`` and ``borehole.import_provenance``."""
    op.drop_column("sample", "sample_label")
    op.drop_column("borehole", "import_provenance")
