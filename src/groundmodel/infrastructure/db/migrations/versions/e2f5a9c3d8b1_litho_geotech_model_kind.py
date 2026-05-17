"""litho/geotech model kind + parent FK + formation lithology/nad_class

Revision ID: e2f5a9c3d8b1
Revises: d1a2b3c4e5f6
Create Date: 2026-05-17 00:00:00.000000

Three-level modelling hierarchy (CLAUDE.md "Modelling hierarchy",
debt-campaign follow-on / "the hard part"). Sibling GeologicalModel
rows discriminated by ``kind``; ``parent_geological_model_id`` is a
self-FK with ON DELETE RESTRICT (a geological model cannot be deleted
while a lithostratigraphic model refines it — the API surfaces this as
409). ``lithology`` + ``nad_class`` carry the litho/geotech unit
attributes on the shared geological_formation table (nullable: a
geological-model formation has neither). No data migration — existing
rows take ``kind='geological'`` via server_default and NULL parent,
which is the correct state for the pre-existing single-level models.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e2f5a9c3d8b1"
down_revision = "d1a2b3c4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add kind + parent FK to geological_model; lithology + nad_class to formation."""
    op.add_column(
        "geological_model",
        sa.Column(
            "kind",
            sa.String(length=20),
            nullable=False,
            server_default="geological",
        ),
    )
    op.add_column(
        "geological_model",
        sa.Column(
            "parent_geological_model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.add_column(
        "geological_formation",
        sa.Column("lithology", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "geological_formation",
        sa.Column("nad_class", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    """Drop the four columns added by this revision."""
    op.drop_column("geological_formation", "nad_class")
    op.drop_column("geological_formation", "lithology")
    op.drop_column("geological_model", "parent_geological_model_id")
    op.drop_column("geological_model", "kind")
