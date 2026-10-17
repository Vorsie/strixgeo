"""drop qt_mpa from cpt_series — CPTU qt is computed on read

Revision ID: d70b1a8e9c34
Revises: c4e8a7d3f201
Create Date: 2026-05-08 15:00:00.000000

CPTU corrected cone resistance (qt = qc + u2 (1 - a)) is fundamentally a
calculation, not an instrument reading. Even when a source file provides it
(GEF qty 15, DOV's <Qt> for piezocones), the cone software performs the same
arithmetic we can perform from the persisted qc, u2, and cone_area_ratio.

Per CLAUDE.md "Data Integrity Rules" §1, derivable values are computed on
read instead of stored, so the database can never disagree with its own
inputs after a row edit. This migration drops the column accordingly.

Existing CPTU rows lose their stored qt — but the inputs (qc, u2, a) are
preserved on the parent CPT and series rows, so qt is losslessly
reproducible from those. The /cpt/{id}/plot endpoint now derives qt for
each request via calculate_qt_series.

q_total_mpa (CPTM totaalweerstand) is left untouched — it's a real
mechanical-cone measurement, not a derivation.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d70b1a8e9c34"
down_revision = "c4e8a7d3f201"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop ``cpt_series.qt_mpa`` (CPTU qt is computed on read)."""
    op.drop_column("cpt_series", "qt_mpa")


def downgrade() -> None:
    """Restore ``cpt_series.qt_mpa`` as an all-NULL column."""
    # Restore the column, but leave it NULL on every row — we cannot
    # distinguish a row whose source originally provided qt from one whose
    # source did not. Callers that need qt should compute it from the
    # surviving qc, u2, and cone_area_ratio.
    op.add_column(
        "cpt_series",
        sa.Column("qt_mpa", sa.ARRAY(sa.DOUBLE_PRECISION()), nullable=True),
    )
