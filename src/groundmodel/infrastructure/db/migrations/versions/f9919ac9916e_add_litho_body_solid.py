"""add litho_body_solid table for cached watertight solid per (model, body)

Revision ID: f9919ac9916e
Revises: e3d34f7720e4
Create Date: 2026-06-10 16:56:10.909551

Creates ``litho_body_solid`` — a derived-cache table that stores one
triangulated watertight solid per (model, body) pair. Source of truth
remains the ``litho_layer`` rows (member layers of a body) plus the
``formation_contact`` rows that frame them; this table caches the
triangulated solid so the 3-D viewer + DXF/Plaxis exporters can serve
geometry without re-running the triangulation on every request.

Schema notes:

* ``method`` is a short string (vs Postgres ENUM) so a future Phase 5
  switch to an alternative triangulation method doesn't need an
  ``ALTER TYPE``.
* ``vertices`` and ``triangles`` stored as JSONB so the geometry
  payload can grow (per-vertex attributes, hole rings, …) without an
  alter-table churn.
* ``UNIQUE(model_id, body_id)`` — exactly one cached solid per pair.
  Recompute upserts via the unique key.
* ``is_flagged`` — True when the builder detected a structural anomaly
  (open boundary, non-manifold edge) and produced a best-effort
  rather than watertight solid.  Amber badge in the UI; does not block
  save or export.
* CASCADE on all three FKs so a deleted model, body, or formation
  drops its cached solid automatically.

This is a pure cache — restoring a .strix bundle on a wiped DB will
repopulate via the bundle round-trip. The ``source_pick_checksum``
enables a recompute short-circuit identical to the one used by
``RecomputeFormationSurface``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f9919ac9916e"
down_revision: str | None = "e3d34f7720e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the litho_body_solid cache table."""
    op.create_table(
        "litho_body_solid",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("formation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False, server_default="tin"),
        sa.Column("vertices", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("triangles", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "source_pick_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("source_pick_checksum", sa.LargeBinary(), nullable=False),
        sa.Column(
            "is_stale",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            "is_flagged",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
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
        sa.ForeignKeyConstraint(["model_id"], ["geological_model.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["body_id"], ["body.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["formation_id"], ["geological_formation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "model_id",
            "body_id",
            name="uq_litho_body_solid_model_body",
        ),
    )
    op.create_index(
        "idx_litho_body_solid_model",
        "litho_body_solid",
        ["model_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the litho_body_solid cache table."""
    op.drop_index("idx_litho_body_solid_model", table_name="litho_body_solid")
    op.drop_table("litho_body_solid")
