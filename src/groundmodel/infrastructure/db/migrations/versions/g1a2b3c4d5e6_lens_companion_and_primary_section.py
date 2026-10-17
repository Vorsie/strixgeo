"""Add primary_section_id to litho_lens; companion_lens_id + is_lens_companion to cross_section.

Revision ID: g1a2b3c4d5e6
Revises: f6a7b8c9d0e1
Create Date: 2026-05-24 19:05:00.000000

Slice 4 of debt #101 — perpendicular companion section support.

Schema additions (all nullable / defaulted, no existing rows affected):

litho_lens
----------
* ``primary_section_id`` UUID NULLABLE FK → cross_section.id ON DELETE SET NULL
  Records the section the lens was defined on. Enables
  ``CreatePerpendicularCompanion`` to find the primary geometry without
  deriving it from contact membership (which breaks when a lens has zero
  present contacts, or when present contacts later appear on multiple
  sections). FK is SET NULL so deleting the primary section does not
  cascade-delete the lens itself.

cross_section
-------------
* ``companion_lens_id`` UUID NULLABLE FK → litho_lens.id ON DELETE SET NULL
  When set, this section was auto-created as the perpendicular companion
  for the referenced lens.  The FK is ON DELETE SET NULL so deleting a
  lens reverts the section to a plain section rather than cascading the
  delete.
* ``is_lens_companion`` BOOLEAN NOT NULL DEFAULT false
  Convenience flag that stays True even after companion_lens_id is nulled
  by a lens deletion, so the UI can display a badge "was a lens companion"
  without a separate query.  Defaults false so all existing sections
  are unaffected.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "g1a2b3c4d5e6"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply schema additions."""
    # ------------------------------------------------------------------
    # litho_lens: add primary_section_id FK → cross_section.id
    # ------------------------------------------------------------------
    op.add_column(
        "litho_lens",
        sa.Column(
            "primary_section_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_litho_lens_primary_section_id",
        "litho_lens",
        "cross_section",
        ["primary_section_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # cross_section: add companion_lens_id FK → litho_lens.id
    # ------------------------------------------------------------------
    op.add_column(
        "cross_section",
        sa.Column(
            "companion_lens_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_cross_section_companion_lens_id",
        "cross_section",
        "litho_lens",
        ["companion_lens_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # cross_section: add is_lens_companion BOOLEAN NOT NULL DEFAULT false
    # ------------------------------------------------------------------
    op.add_column(
        "cross_section",
        sa.Column(
            "is_lens_companion",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    """Reverse schema additions."""
    op.drop_constraint("fk_cross_section_companion_lens_id", "cross_section", type_="foreignkey")
    op.drop_column("cross_section", "companion_lens_id")
    op.drop_column("cross_section", "is_lens_companion")
    op.drop_constraint("fk_litho_lens_primary_section_id", "litho_lens", type_="foreignkey")
    op.drop_column("litho_lens", "primary_section_id")
