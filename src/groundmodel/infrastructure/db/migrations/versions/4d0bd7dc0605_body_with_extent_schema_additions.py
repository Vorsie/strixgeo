"""body with extent schema additions

Revision ID: 4d0bd7dc0605
Revises: r2l3m4n5o6p7
Create Date: 2026-05-31 22:21:21.573246

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "4d0bd7dc0605"
down_revision = "r2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the new extent columns + source_investigation_id to litho_lens.

    Subsequent revisions in this slice (1.4) populate the columns, (1.5)
    rename the tables + drop content_key, and (1a.1) absorb synthetic
    pinch-out contacts.  This revision is additive-only; all new columns
    are nullable so existing code paths keep working.
    """
    op.add_column(
        "litho_lens",
        sa.Column(
            "source_investigation_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,  # populated in revision 1.4
        ),
    )
    op.add_column("litho_lens", sa.Column("extent_left_kind", sa.String(32), nullable=True))
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_left_target_contact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_left_neighbour_inv_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column("litho_lens", sa.Column("extent_right_kind", sa.String(32), nullable=True))
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_right_target_contact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_right_neighbour_inv_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    # Add body_id to litho_lens_shape (preparing for the content_key drop
    # in revision 1.5).  body_id is nullable here; revision 1.4 populates
    # it by joining (model_id, content_key) to litho_lens rows.
    op.add_column(
        "litho_lens_shape",
        sa.Column(
            "body_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("litho_lens.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Forward-only — pre-ship amnesty applies. Downgrade kept minimal."""
    op.drop_column("litho_lens_shape", "body_id")
    op.drop_column("litho_lens", "extent_right_neighbour_inv_id")
    op.drop_column("litho_lens", "extent_right_target_contact_id")
    op.drop_column("litho_lens", "extent_right_kind")
    op.drop_column("litho_lens", "extent_left_neighbour_inv_id")
    op.drop_column("litho_lens", "extent_left_target_contact_id")
    op.drop_column("litho_lens", "extent_left_kind")
    op.drop_column("litho_lens", "source_investigation_id")
