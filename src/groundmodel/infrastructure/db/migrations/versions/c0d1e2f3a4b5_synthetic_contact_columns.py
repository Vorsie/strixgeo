"""formation_contact — add synthetic anchor columns for pinch-out extrapolation.

Revision ID: c0d1e2f3a4b5
Revises: b2c3d4e5f6a7
Create Date: 2026-05-18 12:00:00.000000

Adds a third anchor flavour to ``formation_contact`` — the "synthetic"
anchor used by the pinch-out extrapolation tool. A synthetic contact has
no borehole or CPT to anchor it; instead it carries (synthetic_x,
synthetic_y, synthetic_elevation_m) explicitly so the TIN compute can
place the tip-point in 3D space without needing an investigation row.

The existing XOR CHECK (borehole_id XOR cpt_id == 1) is replaced with a
three-term version: exactly one of the following must be true:
  (a) borehole_id IS NOT NULL
  (b) cpt_id IS NOT NULL
  (c) ALL THREE synthetic columns are non-null

Phrased as ``sum == 1`` with each term being 0 or 1, so a future fourth
anchor flavour is again one extra term — the ORM docstring anticipated
exactly this ("a virtual section anchor for purely modelled points").

Partial unique indexes for the borehole and CPT paths are unchanged —
their WHERE clause already excludes rows where borehole_id / cpt_id IS
NULL, so synthetic rows (both NULL) are outside both indexes, which is
the desired behaviour (the idempotency guard for synthetic contacts lives
at the application layer, mirroring the pre-index-era borehole path).
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c0d1e2f3a4b5"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None

_TABLE = "formation_contact"
_OLD_CHECK = "formation_contact_anchor_xor"
_NEW_CHECK = "formation_contact_anchor_xor"


def upgrade() -> None:
    """Add synthetic_x/y/elevation_m and replace the anchor XOR CHECK."""
    op.add_column(_TABLE, sa.Column("synthetic_x", sa.Double(), nullable=True))
    op.add_column(_TABLE, sa.Column("synthetic_y", sa.Double(), nullable=True))
    op.add_column(_TABLE, sa.Column("synthetic_elevation_m", sa.Double(), nullable=True))

    # Drop the old 2-term CHECK and replace with the 3-term version.
    # Postgres cannot ALTER a CHECK constraint in place — must drop + re-add.
    op.drop_constraint(_OLD_CHECK, _TABLE, type_="check")
    op.create_check_constraint(
        _NEW_CHECK,
        _TABLE,
        # borehole present: 1
        # cpt present: 1
        # synthetic triple all-non-null: 1 (max one, enforced by business logic)
        "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END)"
        " + (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END)"
        " + (CASE WHEN synthetic_x IS NOT NULL"
        "       AND synthetic_y IS NOT NULL"
        "       AND synthetic_elevation_m IS NOT NULL THEN 1 ELSE 0 END)"
        " = 1",
    )


def downgrade() -> None:
    """Drop synthetic columns and restore the original 2-term CHECK."""
    # Must drop the 3-term constraint before adding back the 2-term one.
    # Any existing synthetic contacts would violate the 2-term constraint
    # if left in place — the downgrade path assumes they have been cleaned
    # up by the caller (backwards-compat is SUSPENDED pre-ship; see CLAUDE.md).
    op.drop_constraint(_NEW_CHECK, _TABLE, type_="check")
    op.create_check_constraint(
        _OLD_CHECK,
        _TABLE,
        "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END)"
        " + (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END) = 1",
    )
    op.drop_column(_TABLE, "synthetic_elevation_m")
    op.drop_column(_TABLE, "synthetic_y")
    op.drop_column(_TABLE, "synthetic_x")
