"""schema integrity hardening — read indexes for contact + correlation-edge lookups

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-06-01 00:05:00.000000

Performance indexes (no data-correction needed; perf indexes don't need
correctness tests — debt #107 own guidance).

Indexes added
-------------
formation_contact: idx_formation_contact_model_cpt
    Supports CPT-anchored contact lookups: WHERE model_id = X AND cpt_id = Y.
    The existing partial unique uq_formation_contact_model_formation_cpt_depth
    covers (model_id, formation_id, cpt_id, depth_top_m) WHERE cpt_id IS NOT NULL
    but is too wide for a plain model+cpt lookup.  A complementary two-column
    index matches the access pattern in the litho segmenter and cross-section CPT
    contact queries.

litho_contact_correlation_edge: idx_litho_contact_corr_model_contact_a
    Supports adjacency queries that filter by (model_id, contact_a_id) — the
    canonical "give me all edges where this layer is the smaller endpoint".
    The existing idx_litho_contact_corr_model_id covers model_id alone; the
    UNIQUE triple (model_id, contact_a_id, contact_b_id) can serve the a-side
    scan but the b-side is not covered by a leading-column match.

litho_contact_correlation_edge: idx_litho_contact_corr_model_contact_b
    Supports (model_id, contact_b_id) adjacency queries — "give me all edges
    where this layer is the larger endpoint".  Without this index the
    correlation graph loader does a seq-scan on the model_id-filtered result
    for every contact_b lookup.

Note: CONCURRENTLY is not available inside an Alembic transaction.  These
are plain CREATE INDEX statements (table-lock).  Pre-ship: single-user, no
concurrent writes, locking is safe.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "u5v6w7x8y9z0"
down_revision = "t4u5v6w7x8y9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add three read indexes for contact and correlation-edge lookups."""
    # formation_contact — CPT-anchored lookup index.
    op.create_index(
        "idx_formation_contact_model_cpt",
        "formation_contact",
        ["model_id", "cpt_id"],
    )

    # litho_contact_correlation_edge — contact_a adjacency index.
    op.create_index(
        "idx_litho_contact_corr_model_contact_a",
        "litho_contact_correlation_edge",
        ["model_id", "contact_a_id"],
    )

    # litho_contact_correlation_edge — contact_b adjacency index.
    op.create_index(
        "idx_litho_contact_corr_model_contact_b",
        "litho_contact_correlation_edge",
        ["model_id", "contact_b_id"],
    )


def downgrade() -> None:
    """Drop the three read indexes."""
    op.drop_index(
        "idx_litho_contact_corr_model_contact_b", table_name="litho_contact_correlation_edge"
    )
    op.drop_index(
        "idx_litho_contact_corr_model_contact_a", table_name="litho_contact_correlation_edge"
    )
    op.drop_index("idx_formation_contact_model_cpt", table_name="formation_contact")
