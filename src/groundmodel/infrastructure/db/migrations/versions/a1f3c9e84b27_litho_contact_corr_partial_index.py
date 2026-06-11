"""partial index on litho_contact_correlation_edge(model_id) where approved

Audit (missing index): the resolver + section render filter approved edges
for a model (``model_id AND user_approved = TRUE``). A partial index carrying
only the approved rows is smaller and more selective than the plain
``model_id`` index, which also covers the speculative auto edges.

Revision ID: a1f3c9e84b27
Revises: c55e54be6025
Create Date: 2026-06-12 00:00:00.000000

"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "a1f3c9e84b27"
down_revision = "c55e54be6025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the partial index on approved correlation edges."""
    op.create_index(
        "idx_litho_contact_corr_model_approved",
        "litho_contact_correlation_edge",
        ["model_id"],
        unique=False,
        postgresql_where="user_approved = true",
    )


def downgrade() -> None:
    """Drop the partial index."""
    op.drop_index(
        "idx_litho_contact_corr_model_approved",
        table_name="litho_contact_correlation_edge",
    )
