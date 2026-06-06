"""drop body extent columns

Retire the per-side ``extent_*`` markers from the ``body`` table. The
partition-fill model (member-layer chains keyed on ``litho_layer.body_id``
plus ``body_boundary_shape``) is now the single source of truth for body
shape, so the 10 ``extent_left_*`` / ``extent_right_*`` columns and the
``extent_kind`` enum they validated against are dead. The dead
``ResolveLithoInstances`` debt-#195 carry-forward block (the only live reader
of these columns) was removed in the same change. Backwards-compat is
suspended pre-ship, so this is a clean break with no downgrade.

Drop order (constraints before columns):

1. The two named CHECK constraints that validated ``extent_<side>_kind``
   against the retired enum (``ck_body_extent_left_kind_valid``,
   ``ck_body_extent_right_kind_valid`` — added in ``a1c2d3e4f5a6``).
2. The two named anchor-layer FK constraints (``fk_body_left_anchor_layer``,
   ``fk_body_right_anchor_layer`` — added in ``b1c2d3e4f5a6``).
3. All 10 extent columns. The inline ``extent_<side>_target_contact_id`` FKs
   (created with their columns) drop automatically with the columns.

Revision ID: d8868bb27884
Revises: f7a8b9c0d1e2
Create Date: 2026-06-06 22:47:08.069942

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d8868bb27884"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None

# The 10 extent columns dropped from ``body``.
_EXTENT_COLUMNS = (
    "extent_left_kind",
    "extent_left_target_contact_id",
    "extent_left_neighbour_inv_id",
    "extent_left_anchor_layer_id",
    "extent_left_provenance",
    "extent_right_kind",
    "extent_right_target_contact_id",
    "extent_right_neighbour_inv_id",
    "extent_right_anchor_layer_id",
    "extent_right_provenance",
)


def upgrade() -> None:
    """Drop the body extent constraints + columns.

    Postgres DDL is transactional, so a failure mid-batch rolls the whole
    upgrade back — the table is never left half-migrated.
    """
    with op.batch_alter_table("body") as batch:
        # CHECK constraints first — they reference the *_kind columns.
        batch.drop_constraint("ck_body_extent_left_kind_valid", type_="check")
        batch.drop_constraint("ck_body_extent_right_kind_valid", type_="check")
        # Named anchor-layer FK constraints next.
        batch.drop_constraint("fk_body_left_anchor_layer", type_="foreignkey")
        batch.drop_constraint("fk_body_right_anchor_layer", type_="foreignkey")
        # Then the columns. The inline target_contact_id FKs drop with them.
        for col in _EXTENT_COLUMNS:
            batch.drop_column(col)


def downgrade() -> None:
    """No downgrade — backwards-compat is suspended pre-ship."""
    raise NotImplementedError("backwards-compat suspended pre-ship; no downgrade")
