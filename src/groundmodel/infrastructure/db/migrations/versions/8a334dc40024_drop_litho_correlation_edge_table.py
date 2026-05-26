"""drop litho_correlation_edge table

Revision ID: 8a334dc40024
Revises: 1b0229820909
Create Date: 2026-05-26 17:46:18.706361

Drops the formation-level litho_correlation_edge table.

Pre-ship cleanup: backwards-compat suspended per
project_backwards_compat_suspended.md.  All consumers (bundle resolver,
admixture propagation, resolve-instances use-case) were rewritten in
#133 Phase 2+3 to derive the formation graph from contact-level edges
(litho_contact_correlation_edge); the formation-level table is no
longer referenced by any application code.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "8a334dc40024"
down_revision = "1b0229820909"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop litho_correlation_edge — all indexes and constraints removed with the table."""
    op.drop_table("litho_correlation_edge")


def downgrade() -> None:
    """Not supported — data would be lost and backwards-compat is suspended pre-ship.

    Raises
    ------
    NotImplementedError
        Always — the table was dropped as part of a pre-ship architectural
        cleanup; re-creating it empty does not restore any data.  Roll back
        by reverting the application code changes instead.
    """
    raise NotImplementedError(
        "Downgrade of 8a334dc40024 not supported: litho_correlation_edge data is lost on drop. "
        "Backwards-compat is suspended pre-ship (project_backwards_compat_suspended.md). "
        "Recover by reverting application code to the pre-Task-23 state."
    )
