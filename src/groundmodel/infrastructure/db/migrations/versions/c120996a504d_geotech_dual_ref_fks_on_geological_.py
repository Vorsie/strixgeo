"""geotech dual-ref fks on geological_formation

Revision ID: c120996a504d
Revises: 7a904176d0c9
Create Date: 2026-06-23 12:16:45.325425

Adds two self-referential FK columns to ``geological_formation`` that make the
(geological formation, lithology, NAD class) identity a first-class stored
tuple for geotechnical-stage units (spec §3 explicit dual ref):

* ``source_litho_formation_id`` — the lithostratigraphic formation this geotech
  unit subdivides.  NULL on geological- and litho-model rows.
* ``source_geo_formation_id`` — the geological formation the unit sits within
  (Paleogene vs Quaternary clay carry different parameters → stored explicitly,
  not only transitive).  NULL on geological- and litho-model rows.

Both columns are nullable, ON DELETE SET NULL — removing a parent formation
demotes the geotech unit to unlinked rather than cascading and wiping it.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c120996a504d"
down_revision = "7a904176d0c9"
branch_labels = None
depends_on = None

_TABLE = "geological_formation"


def upgrade() -> None:
    """Add source_litho_formation_id and source_geo_formation_id to geological_formation."""
    # The litho formation this geotech unit subdivides.
    op.add_column(
        _TABLE,
        sa.Column("source_litho_formation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_geological_formation_source_litho",
        _TABLE,
        _TABLE,
        ["source_litho_formation_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # The geological formation the unit sits within.
    op.add_column(
        _TABLE,
        sa.Column("source_geo_formation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_geological_formation_source_geo",
        _TABLE,
        _TABLE,
        ["source_geo_formation_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Remove source_litho_formation_id and source_geo_formation_id from geological_formation."""
    op.drop_constraint("fk_geological_formation_source_geo", _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "source_geo_formation_id")
    op.drop_constraint("fk_geological_formation_source_litho", _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "source_litho_formation_id")
