"""Add litho_layer table — unified litho boundary model (Slice A1).

Revision ID: m7g8h9i0j1k2
Revises: b2f1c9a47d30
Create Date: 2026-05-30 09:30:00.000000

New table for the unified litho boundary model (see
``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).
A LithoLayer is one lithology interval at one investigation anchor,
with a status (pending / accepted / rejected) and depth bounds. It
replaces the dual representation (``LithoLayerSuggestion`` in-memory +
``FormationContact`` per-boundary) for lithostratigraphic models.

Slice A1 scope (this migration):
* Create the table + the CHECK constraints + the per-anchor and
  per-status indexes.
* Backfill is NOT included here — Slice A4 (after the frontend cut-over
  has run cleanly) is when ``formation_contact`` rows for litho models
  migrate into ``litho_layer`` and get dropped from the contact table.
  Slice A1 leaves the new table empty so the dual model can coexist
  during the transition without behaviour change for any existing flow.

Design choices
--------------
* ``model_id`` FK → ``geological_model.id`` ON DELETE CASCADE; same
  rationale as ``formation_contact.model_id``.
* ``formation_id`` FK → ``geological_formation.id`` ON DELETE CASCADE.
* ``borehole_id`` / ``cpt_id`` XOR — CHECK enforces exactly one is set
  (litho layers are always tied to a physical investigation column;
  synthetic anchors live in the geological model only).
* CHECK ``depth_top_m < depth_base_m`` so the interval is well-formed
  at the DB layer.
* CHECK on ``status`` / ``source`` / ``confidence`` whitelists so write
  paths can't ship typos past the DB.
* Indexes on (model_id, borehole_id, depth_top_m), (model_id, cpt_id,
  depth_top_m), (model_id, status), formation_id, and
  parent_geo_contact_id — covers the dominant read patterns
  (per-anchor sorted list, status filter, per-formation list,
  litho↔geo coupling lookup).
* ``parent_geo_contact_id`` FK → ``formation_contact.id`` ON DELETE
  SET NULL — same shape as on FormationContact for the #162 coupling.
* ``server_default=now()`` on both timestamp columns for the same
  defensive reasons as the recent k5e6f7a8b9c0 fix (avoid NULL on
  SQLAlchemy server_default INSERT paths).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "m7g8h9i0j1k2"
down_revision = "b2f1c9a47d30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create litho_layer with constraints + indexes."""
    op.create_table(
        "litho_layer",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "formation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "borehole_id",
            UUID(as_uuid=True),
            sa.ForeignKey("borehole.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "cpt_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cpt.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("depth_top_m", sa.Double(), nullable=False),
        sa.Column("depth_base_m", sa.Double(), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column(
            "observation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("observation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "observation_layer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("observation_layer.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "parent_geo_contact_id",
            UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "confidence",
            sa.String(10),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Two-anchor XOR — exactly one of (borehole, cpt) is set.
        sa.CheckConstraint(
            "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END)"
            " = 1",
            name="litho_layer_anchor_xor",
        ),
        # Depth ordering.
        sa.CheckConstraint(
            "depth_top_m < depth_base_m",
            name="litho_layer_depth_ordered",
        ),
        # Status whitelist.
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="litho_layer_status_valid",
        ),
        # Source whitelist.
        sa.CheckConstraint(
            "source IN ('segmenter', 'manual', 'observation_layer', 'observation_interpretation')",
            name="litho_layer_source_valid",
        ),
        # Confidence whitelist.
        sa.CheckConstraint(
            "confidence IN ('low', 'medium', 'high')",
            name="litho_layer_confidence_valid",
        ),
    )
    # Per-anchor sorted-by-depth lookups — the dominant frontend query.
    op.create_index(
        "idx_litho_layer_model_borehole_depth",
        "litho_layer",
        ["model_id", "borehole_id", "depth_top_m"],
    )
    op.create_index(
        "idx_litho_layer_model_cpt_depth",
        "litho_layer",
        ["model_id", "cpt_id", "depth_top_m"],
    )
    # Status filter for the renderer's pending/accepted/rejected splits.
    op.create_index(
        "idx_litho_layer_model_status",
        "litho_layer",
        ["model_id", "status"],
    )
    # Per-formation list for the inspector + absence-recompute pipeline.
    op.create_index(
        "idx_litho_layer_formation",
        "litho_layer",
        ["formation_id"],
    )
    # Litho↔geo coupling lookup.
    op.create_index(
        "idx_litho_layer_parent_geo",
        "litho_layer",
        ["parent_geo_contact_id"],
    )


def downgrade() -> None:
    """Drop litho_layer and its indexes."""
    op.drop_index("idx_litho_layer_parent_geo", table_name="litho_layer")
    op.drop_index("idx_litho_layer_formation", table_name="litho_layer")
    op.drop_index("idx_litho_layer_model_status", table_name="litho_layer")
    op.drop_index("idx_litho_layer_model_cpt_depth", table_name="litho_layer")
    op.drop_index("idx_litho_layer_model_borehole_depth", table_name="litho_layer")
    op.drop_table("litho_layer")
