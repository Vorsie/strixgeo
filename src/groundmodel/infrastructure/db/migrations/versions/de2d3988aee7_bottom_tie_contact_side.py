"""bottom tie contact_side.

Add a per-endpoint ``contact_side`` discriminator (``'top'`` / ``'base'``) to
``litho_contact_correlation_edge`` so an edge can address a layer's BASE, not
just its top-keyed contact. A "bottom-tie" is an edge with ``side='base'`` on
BOTH endpoints — it lets the DEEPEST layer (which has no layer below, so no
top-keyed base contact) be correlated at its base so it can band.

Both columns default to ``'top'``, so every existing edge is unchanged. The
``uq_litho_contact_corr_triple`` unique constraint is widened to include the
two side columns so a top↔top edge and a base↔base bottom-tie between the same
two layers on the same section can coexist. A CHECK constraint pins the enum.

Bottom-tie spec: ``docs/superpowers/specs/2026-06-17-bottom-tie-correlation-design.md``.

Revision ID: de2d3988aee7
Revises: 7deb298fb5c1
Create Date: 2026-06-17 16:54:52.985807
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "de2d3988aee7"
down_revision = "7deb298fb5c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the side columns + check, and widen the unique constraint."""
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column(
            "contact_a_side",
            sa.String(length=4),
            nullable=False,
            server_default="top",
        ),
    )
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column(
            "contact_b_side",
            sa.String(length=4),
            nullable=False,
            server_default="top",
        ),
    )
    op.create_check_constraint(
        "ck_litho_contact_corr_edge_side_enum",
        "litho_contact_correlation_edge",
        "contact_a_side IN ('top','base') AND contact_b_side IN ('top','base')",
    )
    # Widen the uniqueness key so a top↔top edge and a base↔base bottom-tie
    # between the SAME two layers on the SAME section can coexist.
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        [
            "model_id",
            "section_id",
            "contact_a_id",
            "contact_b_id",
            "contact_a_side",
            "contact_b_side",
        ],
    )


def downgrade() -> None:
    """Reverse the upgrade in opposite order."""
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        ["model_id", "section_id", "contact_a_id", "contact_b_id"],
    )
    op.drop_constraint(
        "ck_litho_contact_corr_edge_side_enum",
        "litho_contact_correlation_edge",
        type_="check",
    )
    op.drop_column("litho_contact_correlation_edge", "contact_b_side")
    op.drop_column("litho_contact_correlation_edge", "contact_a_side")
