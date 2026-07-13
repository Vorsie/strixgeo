"""Rename litho_contact_correlation_edge endpoint columns contact→layer (ARCH-08).

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-07-13 10:00:00.000000

Since the A4 slice-4a FK migration (``q1k2l3m4n5o6``) the edge endpoints
``contact_a_id`` / ``contact_b_id`` FK ``litho_layer.id`` — they hold
LAYER ids, and a load-bearing ORM comment was the only guard against a
consumer navigating them as contacts (audit ARCH-08). Renaming to
``layer_a_id`` / ``layer_b_id`` makes the type part of the name.

``contact_a_side`` / ``contact_b_side`` → ``layer_a_side`` /
``layer_b_side`` ride along for coherence: they describe which contact
('top'/'base') of the SAME renamed layer anchors each endpoint, so the
prefix must follow the endpoint's new name.

Plain RENAME COLUMNs — data and every constraint survive; PostgreSQL
rewrites the CHECK expressions (canonical order, no-self-loop, side
enum) and the ``uq_litho_contact_corr_triple`` UNIQUE in place; the
constraint NAMES don't embed the column names, so they stay unchanged.
Backwards-compat is SUSPENDED pre-ship; old .strix bundles keep
restoring via the read-side aliases in ``bundle_serialization``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "y9z0a1b2c3d4"
down_revision = "x8y9z0a1b2c3"
branch_labels = None
depends_on = None

_TABLE = "litho_contact_correlation_edge"

_RENAMES = [
    ("contact_a_id", "layer_a_id"),
    ("contact_b_id", "layer_b_id"),
    ("contact_a_side", "layer_a_side"),
    ("contact_b_side", "layer_b_side"),
]


def upgrade() -> None:
    """Rename the four edge endpoint columns to layer vocabulary."""
    for old, new in _RENAMES:
        op.alter_column(_TABLE, old, new_column_name=new)


def downgrade() -> None:
    """Restore the retired contact-vocabulary endpoint names."""
    for old, new in _RENAMES:
        op.alter_column(_TABLE, new, new_column_name=old)
