"""Geotechnical-unit table — formation subdivision (structure only).

Revision ID: f4b2c91e5a78
Revises: 8a3f2c91d456
Create Date: 2026-05-12 16:00:00.000000

Adds the geotechnical model layer below the geological one. A single
geological formation often contains multiple geotechnical units with
different parameter sets (e.g. weathered crust of Boom Klei vs the
undisturbed clay below).

This migration carries the *structure* — name, code, colour, display
order, notes — to land the v1.0 MVP gate's "subdivide formations into
geotechnical units" deliverable without committing to a parameter
shape this early. Per-unit parameter values (γ, c', φ', E, ...) are
Phase 5 work and will land as their own additive migration when the
shape settles.

Cascade rule: DELETE geological_formation → CASCADE delete every unit
beneath it. The desktop editor warns the user before the parent
delete fires.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f4b2c91e5a78"
down_revision = "8a3f2c91d456"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the geotechnical_unit table + its two query indexes."""
    op.create_table(
        "geotechnical_unit",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # Denormalised project scope — same pattern as formation_contact
        # so list/filter queries don't need a join through formation.
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        # CASCADE — orphan units have nothing to point at.
        sa.Column(
            "geological_formation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
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
        "idx_geotechnical_unit_app_project_id",
        "geotechnical_unit",
        ["app_project_id"],
    )
    op.create_index(
        "idx_geotechnical_unit_formation_id",
        "geotechnical_unit",
        ["geological_formation_id"],
    )


def downgrade() -> None:
    """Drop the geotechnical_unit table + its indexes."""
    op.drop_index("idx_geotechnical_unit_formation_id", table_name="geotechnical_unit")
    op.drop_index("idx_geotechnical_unit_app_project_id", table_name="geotechnical_unit")
    op.drop_table("geotechnical_unit")
