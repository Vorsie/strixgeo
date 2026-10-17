"""split qt_mpa into qt_mpa (CPTU) and q_total_mpa (CPTM); drop qt_source

Revision ID: c4e8a7d3f201
Revises: b9f3c7e2a1d4
Create Date: 2026-05-08 14:00:00.000000

The previous schema conflated two physically different quantities under the
single ``qt_mpa`` column:
  * CPTU corrected cone resistance — a piezocone correction qt = qc + u2(1-a).
  * CPTM totaalweerstand — combined tip + sleeve force read by a mechanical
    Begemann cone in one go (the apparatus cannot separate them).

This migration splits them: ``q_total_mpa`` is added, CPTM rows have their
existing ``qt_mpa`` array copied over and the original column nulled, and the
short-lived ``qt_source`` provenance column is dropped (it would always have
been MEASURED or NULL — not informative).

``rf_source`` is left in place: Rf truly does flip between MEASURED (source
qty 4) and COMPUTED (derived from qc + fs).
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c4e8a7d3f201"
down_revision = "b9f3c7e2a1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add ``q_total_mpa``, move the CPTM values into it and drop ``qt_source``."""
    op.add_column(
        "cpt_series",
        sa.Column("q_total_mpa", sa.ARRAY(sa.DOUBLE_PRECISION()), nullable=True),
    )

    # Move existing CPTM data: copy qt_mpa → q_total_mpa for CPTM rows, then
    # null out the original column on those rows so the two columns become
    # mutually exclusive going forward.
    op.execute(
        """
        UPDATE cpt_series cs
        SET q_total_mpa = cs.qt_mpa
        FROM cpt
        WHERE cs.cpt_id = cpt.id
          AND cpt.cpt_type = 'CPTM'
          AND cs.qt_mpa IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE cpt_series cs
        SET qt_mpa = NULL
        FROM cpt
        WHERE cs.cpt_id = cpt.id
          AND cpt.cpt_type = 'CPTM'
        """
    )

    op.drop_column("cpt_series", "qt_source")


def downgrade() -> None:
    """Restore ``qt_source`` and fold ``q_total_mpa`` back into ``qt_mpa``.

    Copy ``q_total_mpa`` back into ``qt_mpa``, then drop ``q_total_mpa``.
    """
    op.add_column("cpt_series", sa.Column("qt_source", sa.String(length=10), nullable=True))

    # Restore the conflated single column: copy q_total_mpa back into qt_mpa
    # for any row that has it, then drop q_total_mpa. Provenance for those
    # rows cannot be reconstructed, so qt_source stays NULL.
    op.execute(
        """
        UPDATE cpt_series
        SET qt_mpa = q_total_mpa
        WHERE q_total_mpa IS NOT NULL
        """
    )
    op.drop_column("cpt_series", "q_total_mpa")
