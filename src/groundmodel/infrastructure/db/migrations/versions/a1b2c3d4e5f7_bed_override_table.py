"""Bed-override table — manual bed-level polygons for the ground surface.

Revision ID: a1b2c3d4e5f7
Revises: f1a2b3c4d5e6
Create Date: 2026-09-06 09:00:00.000000

A bed override is a polygon drawn on the map with one constant bed elevation.
The owner's site was dredged for a canal; the DEM over the water carries the
water surface, not the dredged bed, so the ground surface (and everything
clipped to it) sits at the wrong level under the water.  Inside a bed-override
polygon the ground surface takes ``level_m`` instead of the DEM.

Bed overrides are **project-scoped** (like ``cross_section``) — they apply to
the whole project's ground surface, independent of any single geological model.
Bathymetry survey-file import stays Phase 5; only the drawn polygon exists now.

Shape:

* ``label`` — human-readable name for the override list.
* ``level_m`` — the constant bed elevation in the project's vertical datum
  (m TAW / NAP).  0.0 is a real value.
* ``epsg`` — the CRS of the polygon's coordinates (the project's horizontal
  CRS).
* ``vertices`` — JSONB list of ``[x, y]`` pairs (the open polygon ring).

Additive table — no ``format_version`` bump (the bundle collection is added
additively; old ``.gmproj`` files restore without a ``bed_overrides`` list).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the bed_override table."""
    op.create_table(
        "bed_override",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # Project scope. Plain UUID + no FK, matching cross_section /
        # cpt / borehole (scope enforced in the app layer).
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        # The constant bed elevation across the polygon. NOT NULL — a bed
        # override with no level is meaningless.
        sa.Column("level_m", sa.Double(), nullable=False),
        # EPSG of the polygon coordinates — the project's horizontal CRS.
        sa.Column("epsg", sa.Integer(), nullable=False),
        # The polygon ring as JSONB list of [x, y] pairs. Server default "[]"
        # so a row inserted before its vertices land reads as an empty
        # (degenerate) polygon rather than NULL.
        sa.Column(
            "vertices",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_bed_override_app_project_id",
        "bed_override",
        ["app_project_id"],
    )


def downgrade() -> None:
    """Drop the bed_override table."""
    op.drop_index("idx_bed_override_app_project_id", table_name="bed_override")
    op.drop_table("bed_override")
