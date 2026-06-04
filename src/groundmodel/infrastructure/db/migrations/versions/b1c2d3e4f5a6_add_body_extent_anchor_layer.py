"""add body extent anchor_layer_id (left + right)

Revision ID: b1c2d3e4f5a6
Revises: 10c39de474aa
Create Date: 2026-06-04 12:00:00.000000

Adds two nullable ``extent_<side>_anchor_layer_id`` FK columns to ``body``.
Each is the litho_layer the user (or detector) anchored that side's cap to —
the SPATIAL source of truth for where the cap renders (column + depth
interval), replacing the lossy "re-derive the column from body geometry at
render time" path that produced the wrong-column / not-rendering / half-width
class of bugs (dogfeed 2026-06-04).

Both columns are nullable (legacy bodies + detector ``to_target`` caps have
no anchor → the renderer keeps its leftmost/rightmost-member fallback) and
use ``ON DELETE SET NULL`` so deleting a layer never deletes a body row.  The
resolver carry-forward re-attaches an anchored cap to whichever body now owns
the anchor layer after an instance renumber, which is what makes a
user-claimed open survive (debt #195).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b1c2d3e4f5a6"
down_revision = "10c39de474aa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable left + right anchor FK columns to body."""
    for side in ("left", "right"):
        col = f"extent_{side}_anchor_layer_id"
        op.add_column(
            "body",
            sa.Column(col, postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_body_{side}_anchor_layer",
            "body",
            "litho_layer",
            [col],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Drop the anchor FKs + columns."""
    for side in ("left", "right"):
        op.drop_constraint(f"fk_body_{side}_anchor_layer", "body", type_="foreignkey")
        op.drop_column("body", f"extent_{side}_anchor_layer_id")
