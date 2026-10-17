"""section-scope litho contact correlations

Revision ID: e3d34f7720e4
Revises: e1c2d3a4b5f6
Create Date: 2026-06-08 15:15:49.934380

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e3d34f7720e4"
down_revision = "e1c2d3a4b5f6"
branch_labels = None
depends_on = None

# Declares that ``upgrade()`` deletes existing user rows (DELETEs every litho
# contact correlation edge) so the migrator's pre-migration backup step names
# it among the pending data-rewriting migrations (production-readiness audit H2b).
DATA_REWRITE = True


def upgrade() -> None:
    """Section-scope correlation edges: clean slate + section_id NOT NULL.

    Owner directive 2026-06-08: existing edges have no section linkage to
    backfill, and re-correlating per section is one click (Auto-correlate →
    Accept). Delete all edges first so the NOT-NULL add is safe on an empty
    table; the user rebuilds ribbons + bodies by re-correlating each section.
    """
    op.execute("DELETE FROM litho_contact_correlation_edge")
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_foreign_key(
        "fk_litho_contact_corr_section",
        "litho_contact_correlation_edge",
        "cross_section",
        ["section_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_litho_contact_corr_section_id",
        "litho_contact_correlation_edge",
        ["section_id"],
    )
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        ["model_id", "section_id", "contact_a_id", "contact_b_id"],
    )


def downgrade() -> None:
    """Revert to the model-level unique (data loss on section_id is accepted —
    pre-ship, backwards-compat suspended).

    Clean-slate the table first: post-upgrade two rows may share
    ``(model_id, contact_a_id, contact_b_id)`` while differing only by
    ``section_id`` (valid under the 4-col unique). Re-creating the 3-col unique
    on such data would raise a uniqueness violation, so drop all rows before
    narrowing the constraint.
    """
    op.execute("DELETE FROM litho_contact_correlation_edge")
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.drop_index(
        "idx_litho_contact_corr_section_id",
        table_name="litho_contact_correlation_edge",
    )
    op.drop_constraint(
        "fk_litho_contact_corr_section",
        "litho_contact_correlation_edge",
        type_="foreignkey",
    )
    op.drop_column("litho_contact_correlation_edge", "section_id")
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        ["model_id", "contact_a_id", "contact_b_id"],
    )
