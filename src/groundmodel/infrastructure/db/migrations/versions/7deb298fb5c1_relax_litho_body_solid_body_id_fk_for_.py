"""Drop the body_id FK on litho_body_solid: geology-split halves use synthesized uuid5 ids.

Revision ID: 7deb298fb5c1
Revises: a1f3c9e84b27
Create Date: 2026-06-12 11:09:02.341643

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "7deb298fb5c1"
down_revision = "a1f3c9e84b27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # RecomputeLithoSolids may store geology-split body halves under
    # synthesized uuid5(parent_body_id, band) ids that are NOT rows in the
    # `body` table (build-only 3D cache; the body/geological model is
    # untouched).  The FK to body.id is therefore incompatible with those
    # split-body entries and must be dropped.
    op.drop_constraint(
        op.f("litho_body_solid_body_id_fkey"), "litho_body_solid", type_="foreignkey"
    )


def downgrade() -> None:
    # Restore the FK (reverts to pre-geology-bounding behaviour where every
    # cached solid corresponded to a real body row).
    op.create_foreign_key(
        op.f("litho_body_solid_body_id_fkey"),
        "litho_body_solid",
        "body",
        ["body_id"],
        ["id"],
        ondelete="CASCADE",
    )
