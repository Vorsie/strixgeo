"""geological_formation — add litho builder columns (Phase 1).

Revision ID: d0e1f2a3b4c5
Revises: c0d1e2f3a4b5
Create Date: 2026-05-19 00:00:00.000000

Adds the columns required by the Litho Builder Phase 1:

* ``parent_formation_id`` — self-FK on ``geological_formation``.  NULL for
  geological-model formations (they have no parent); non-null for litho /
  geotech units that refine a parent geological formation.  ON DELETE SET NULL
  so deleting a geological formation degrades the litho unit to parentless
  rather than cascading and wiping the user's litho work.
* ``litho_main_soil_code`` — BaseLithology token (ZAND/KLEI/SILT/GRIND/VEEN).
  NULL on geological-model rows (concept N/A).
* ``litho_admixtures`` — JSONB ordered list mirroring Admixture value object:
  ``[{"soil_code": "KL", "amount": "Z", "locally": false}, ...]``.
  NULL on geological-model rows; empty list ``[]`` on a litho unit with no
  admixtures.
* ``instance_ordinal`` — Phase 2 ordinal for same-composition instances at
  the same parent formation level.  NULL throughout Phase 1 (Accept leaves it
  unassigned; Phase 2 resolve_litho_instances fills it in).
* ``instance_ordinal_locked`` — when True the user has manually assigned an
  ordinal; Phase 2's auto-resolver skips it.  Default False.

Index on ``(app_project_id, parent_formation_id, litho_main_soil_code)`` to
accelerate the Accept find-or-create key lookup.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "d0e1f2a3b4c5"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None

_TABLE = "geological_formation"
_IDX = "idx_geological_formation_litho_lookup"


def upgrade() -> None:
    """Add litho-builder columns + index to geological_formation."""
    # Self-FK: a litho/geotech unit points at its parent geological formation.
    # ON DELETE SET NULL — prefer orphaned unit over cascading wipe.
    op.add_column(
        _TABLE,
        sa.Column(
            "parent_formation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(_TABLE + ".id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # BaseLithology token: ZAND / KLEI / SILT / GRIND / VEEN.
    op.add_column(
        _TABLE,
        sa.Column("litho_main_soil_code", sa.Text(), nullable=True),
    )
    # Ordered admixture list — JSONB for schema-flexible per-row storage.
    # Each element: {"soil_code": str, "amount": str, "locally": bool}.
    op.add_column(
        _TABLE,
        sa.Column(
            "litho_admixtures",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    # Phase 1: Accept leaves instance_ordinal NULL (Phase 2 assigns it).
    op.add_column(
        _TABLE,
        sa.Column("instance_ordinal", sa.Integer(), nullable=True),
    )
    # Default False: no user-locked ordinal until Phase 2 UI ships.
    op.add_column(
        _TABLE,
        sa.Column(
            "instance_ordinal_locked",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    # Composite index for the Accept find-or-create key lookup.
    op.create_index(
        _IDX,
        _TABLE,
        ["app_project_id", "parent_formation_id", "litho_main_soil_code"],
    )


def downgrade() -> None:
    """Drop litho-builder columns + index from geological_formation."""
    op.drop_index(_IDX, table_name=_TABLE)
    op.drop_column(_TABLE, "instance_ordinal_locked")
    op.drop_column(_TABLE, "instance_ordinal")
    op.drop_column(_TABLE, "litho_admixtures")
    op.drop_column(_TABLE, "litho_main_soil_code")
    op.drop_column(_TABLE, "parent_formation_id")
