"""Add geological_formation.color_override — the colour the engineer picked.

Owner ruling 2026-08-26: *"Colours on the right hand pane need to be choosable
if user wants."*  A picked colour has to win over the automatic one (the NAD
packing colour on a geotech unit), which means the two must be distinguishable
— and ``color`` cannot carry that meaning, because the machine already stamps
it: ``GeotechBoreholeMaterialiser`` copies the source litho unit's colour when
it creates a geotech unit, so a value there proves nothing about intent.

NULL means "nobody chose".  Nullability IS the provenance, exactly as
``body.display_color`` already does it, so reset-to-automatic is a PATCH with an
explicit null rather than a second flag to keep in step.

Additive and nullable, so it restores from every existing ``.strix`` (the
bundle enumerates columns generically on both sides — a bundle written before
today simply carries no key and the column stays NULL).

Revision ID: a7b8c9d0e1f2
Revises: d5e6f7a8b9c0
Create Date: 2026-08-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable ``color_override`` column to ``geological_formation``."""
    op.add_column(
        "geological_formation",
        sa.Column("color_override", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    """Drop ``color_override``, discarding every engineer-picked colour."""
    op.drop_column("geological_formation", "color_override")
