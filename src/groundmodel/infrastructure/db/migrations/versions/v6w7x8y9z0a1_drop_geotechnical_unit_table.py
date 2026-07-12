"""Drop the geotechnical_unit table — superseded by the model-kind design.

Revision ID: v6w7x8y9z0a1
Revises: fce0b6dcb273
Create Date: 2026-07-12 12:00:00.000000

The geotechnical subdivision shipped through the three-level model-kind
design instead: geotech units are ``geological_formation`` rows
(``nad_class`` + ``source_litho_formation_id``) under a
``kind='geotechnical'`` model, materialised via ``litho_layer`` rows by
``SubdivideAllBodies`` / ``DivideBoreholes``. The ``geotechnical_unit``
table (created by ``f4b2c91e5a78`` for the retired CRUD flow, audit
BE-API-01) never gained a production writer — owner decision #237.4
drops it together with its ORM model and the ``geotechnical_units``
bundle key (backwards-compat is SUSPENDED pre-ship, so the bundle key
is removed cleanly without a format_version bump).

Downgrade recreates the exact ``f4b2c91e5a78`` table shape (data is
not restored — the table held no production rows).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "v6w7x8y9z0a1"
down_revision = "fce0b6dcb273"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the geotechnical_unit table + its two query indexes."""
    op.drop_index("idx_geotechnical_unit_formation_id", table_name="geotechnical_unit")
    op.drop_index("idx_geotechnical_unit_app_project_id", table_name="geotechnical_unit")
    op.drop_table("geotechnical_unit")


def downgrade() -> None:
    """Recreate the geotechnical_unit table (shape of ``f4b2c91e5a78``; no data)."""
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
