"""Rename geological_model.parent_geological_model_id → parent_model_id (NAME-09).

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-13 09:30:00.000000

The column holds the parent MODEL id one level up the three-level
hierarchy: a lithostratigraphic model's parent is a geological model,
but a geotechnical model's parent is a *lithostratigraphic* model — so
"geological" in the name was false for a third of its uses (audit
NAME-09). ``parent_model_id`` states what it is without lying about
the parent's kind.

Plain RENAME COLUMN — data, the FK (→ ``geological_model.id``, ON
DELETE RESTRICT), the ``ix_geological_model_parent_id`` index, and the
``ck_geological_model_kind_parent_null`` CHECK all survive (PostgreSQL
rewrites constraint/index expressions on rename; neither name embeds
the column name). Backwards-compat is SUSPENDED pre-ship, so the wire
field + bundle key change ride for free; old bundles keep restoring
via the read-side alias in ``bundle_serialization``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "x8y9z0a1b2c3"
down_revision = "w7x8y9z0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Rename the parent-model FK column to kind-neutral vocabulary."""
    op.alter_column(
        "geological_model", "parent_geological_model_id", new_column_name="parent_model_id"
    )


def downgrade() -> None:
    """Restore the retired kind-specific column name."""
    op.alter_column(
        "geological_model", "parent_model_id", new_column_name="parent_geological_model_id"
    )
