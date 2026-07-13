"""Rename cross_section companion columns lens → body (debt #222).

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-07-13 09:00:00.000000

The ``litho_lens`` table was renamed to ``body`` in the body-with-extent
migration (2026-05-31), but the two cross_section columns that point at
it kept the retired "lens" vocabulary:

* ``companion_lens_id``  → ``companion_body_id``  (FK → ``body.id``)
* ``is_lens_companion``  → ``is_body_companion``

Plain RENAME COLUMN — data, the FK constraint, and NULLability are all
preserved. Backwards-compat is SUSPENDED pre-ship, so the bundle key
change rides for free; the restore path still accepts the old bundle
keys via the read-side alias map in ``bundle_serialization``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "w7x8y9z0a1b2"
down_revision = "v6w7x8y9z0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Rename the two lens-companion columns to body vocabulary."""
    op.alter_column("cross_section", "companion_lens_id", new_column_name="companion_body_id")
    op.alter_column("cross_section", "is_lens_companion", new_column_name="is_body_companion")


def downgrade() -> None:
    """Restore the retired lens-companion column names."""
    op.alter_column("cross_section", "companion_body_id", new_column_name="companion_lens_id")
    op.alter_column("cross_section", "is_body_companion", new_column_name="is_lens_companion")
