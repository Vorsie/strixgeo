"""Cross-section table — slices through a project for viewing / editing the model.

Revision ID: 6092b215146e
Revises: 0314d9e63258
Create Date: 2026-05-10 23:00:00.000000

A cross-section is a 2D slice the user picks through their project so
they can view investigations projected onto a vertical strip and edit
the geological model along that line. Sections are **project-scoped**
(not model-scoped) so two alternative interpretations can both render
against the same section without duplicating its definition.

Shape:

* Two endpoints (start_x / start_y / end_x / end_y) + their EPSG.
  Plain Doubles (not PostGIS) — the section is a 2-vertex line; we
  don't need spatial queries on sections at v1, and the existing
  CPT / Borehole tables already use the same x / y / epsg pattern for
  their points so the data shape is consistent across the schema.
* ``projection_buffer_m`` — investigations within this perpendicular
  distance from the line are projected onto the section. Default 50 m.
* ``vertical_exaggeration`` — display hint for the section view
  (1.0 = true scale). Stored so the same section opens with the same
  proportions across devices via the .gmproj bundle.
* ``excluded_borehole_ids`` / ``excluded_cpt_ids`` — Postgres ARRAY of
  ids that the user has chosen to hide from this section even though
  they're inside the buffer. Empty arrays = include everything.
* ``min_depth_m`` / ``max_depth_m`` — optional view-window depths.
  NULL means "auto-fit to the deepest investigation".

The model-editor task (#34) adds a separate ``formation_surface_on_section``
table for the polylines the user draws between investigations — those
are per (model, section, formation) and don't belong here.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "6092b215146e"
down_revision = "0314d9e63258"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the cross_section table."""
    op.create_table(
        "cross_section",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # Project scope. Plain UUID + no FK, matching the convention
        # used elsewhere (CptOrm.app_project_id, BoreholeOrm.app_project_id).
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # Line endpoints. EPSG defaults to the project's
        # default_horizontal_epsg at the API layer when the caller omits
        # it. NOT NULL on EPSG because a section without a CRS is
        # unusable — there's no way to project an investigation onto it.
        sa.Column("start_x", sa.Double(), nullable=False),
        sa.Column("start_y", sa.Double(), nullable=False),
        sa.Column("end_x", sa.Double(), nullable=False),
        sa.Column("end_y", sa.Double(), nullable=False),
        sa.Column("epsg", sa.Integer(), nullable=False),
        # Lateral projection buffer (perpendicular distance from the
        # line in metres). 50 m is the default we hand out at the API
        # layer; the column has no server_default so the row keeps the
        # exact value the caller chose without surprise overwrites.
        sa.Column("projection_buffer_m", sa.Double(), nullable=False),
        # Display scale — 1.0 = true scale, > 1.0 stretches the vertical
        # axis. Saved per-section so reopening the .gmproj on a different
        # machine renders with the same proportions.
        sa.Column(
            "vertical_exaggeration",
            sa.Double(),
            nullable=False,
            server_default="1.0",
        ),
        # Explicit user overrides for which investigations get drawn on
        # this section. Empty arrays (default) mean "every investigation
        # within the buffer". ARRAY because membership lookup is cheap
        # and the lists are bounded by the project's investigation count.
        sa.Column(
            "excluded_borehole_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "excluded_cpt_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
        # Optional view-window depths. NULL = auto-fit to data on render.
        sa.Column("min_depth_m", sa.Double(), nullable=True),
        sa.Column("max_depth_m", sa.Double(), nullable=True),
        # Sidebar display order. Same loose-hint pattern as
        # geological_formation.display_order — ties are tolerated and
        # broken by name in the UI.
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
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
        "idx_cross_section_app_project_id",
        "cross_section",
        ["app_project_id"],
    )


def downgrade() -> None:
    """Drop the cross_section table."""
    op.drop_index("idx_cross_section_app_project_id", table_name="cross_section")
    op.drop_table("cross_section")
