"""add pinned_order flag to geological_formation

Revision ID: d1a2b3c4e5f6
Revises: c9f4e72a3811
Create Date: 2026-05-16 18:00:00.000000

Debt #35: "Build 3D model" runs ``_reorder_by_age`` as its final
step, which re-derives ``display_order`` from per-anchor contact
depths. Any formation with a contact was eligible for re-ranking, so
a deliberate manual drag-reorder in the GeologyInspector was silently
reverted on the next Build — fatal for unusual stratigraphy
(pinch-outs, unconformities, tectonic inversion) where the
data-driven inference is simply wrong.

This adds ``pinned_order``: the drag-end PATCH sets it ``True`` on
every reordered formation, and ``_reorder_by_age`` keeps pinned
formations at their exact ``display_order`` while flowing the
remaining (non-pinned) formations into the free slots in age order.

Default ``false`` so seeded / "Fill from boreholes" formations still
get the data-driven ordering they benefit from — only an explicit
manual reorder opts a formation out of the inference.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1a2b3c4e5f6"
down_revision: str | None = "c9f4e72a3811"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the pinned_order boolean column."""
    op.add_column(
        "geological_formation",
        sa.Column(
            "pinned_order",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop the pinned_order column."""
    op.drop_column("geological_formation", "pinned_order")
