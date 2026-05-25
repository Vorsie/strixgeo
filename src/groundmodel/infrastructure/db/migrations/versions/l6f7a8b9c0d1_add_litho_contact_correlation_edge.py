"""Add litho_contact_correlation_edge table — #133 Phase 1.

Revision ID: l6f7a8b9c0d1
Revises: k5e6f7a8b9c0
Create Date: 2026-05-26 00:00:00.000000

New table for boundary-to-boundary (contact-level) correlation edges,
the Phase 1 implementation of debt #133 (owner directive 2026-05-25).

The table coexists with ``litho_correlation_edge`` (formation-level).
Migration from formation-level to contact-level is Phase 3 of #133.

Design choices
--------------
* ``model_id`` FK → ``geological_model.id`` ON DELETE CASCADE so model
  deletion atomically removes all contact-correlation edges.
* ``contact_a_id`` / ``contact_b_id`` FK → ``formation_contact.id``
  ON DELETE CASCADE so deleting a contact automatically dissolves its
  boundary edges (no dangling references).
* Canonical ordering enforced via CHECK ``contact_a_id < contact_b_id``
  + a UNIQUE on ``(model_id, contact_a_id, contact_b_id)``.  The
  use-case normalises to ``(min, max)`` before every INSERT.
* Self-loop CHECK ``contact_a_id != contact_b_id``.
* ``source`` CHECK ``IN ('manual', 'auto')`` — same provenance tokens
  as ``litho_correlation_edge``.
* ``server_default=now()`` on both timestamp columns preserved as a
  PERMANENT DEFAULT so INSERT-omission (SQLAlchemy server_default path)
  never produces NULL (lesson from migration k5e6f7a8b9c0).
* Index on ``model_id`` for the common "list all edges for this model"
  query.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "l6f7a8b9c0d1"
down_revision = "k5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create litho_contact_correlation_edge with constraints + index."""
    op.create_table(
        "litho_contact_correlation_edge",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contact_a_id",
            UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contact_b_id",
            UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.String(20),
            nullable=False,
            server_default="manual",
        ),
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
        # Canonical ordering — use-case normalises (min, max); CHECK is
        # defence in depth.
        sa.CheckConstraint(
            "contact_a_id < contact_b_id",
            name="ck_litho_contact_corr_canonical_order",
        ),
        # Self-loop guard.
        sa.CheckConstraint(
            "contact_a_id != contact_b_id",
            name="ck_litho_contact_corr_no_self_loop",
        ),
        # Provenance tokens.
        sa.CheckConstraint(
            "source IN ('manual', 'auto')",
            name="ck_litho_contact_corr_source",
        ),
        # One edge per (model, contact-pair) — canonical order blocks symmetric
        # duplicate.
        sa.UniqueConstraint(
            "model_id",
            "contact_a_id",
            "contact_b_id",
            name="uq_litho_contact_corr_triple",
        ),
    )
    # Index on model_id for the common list-all-edges-for-model query.
    op.create_index(
        "idx_litho_contact_corr_model_id",
        "litho_contact_correlation_edge",
        ["model_id"],
    )


def downgrade() -> None:
    """Drop litho_contact_correlation_edge and its index."""
    op.drop_index("idx_litho_contact_corr_model_id", table_name="litho_contact_correlation_edge")
    op.drop_table("litho_contact_correlation_edge")
