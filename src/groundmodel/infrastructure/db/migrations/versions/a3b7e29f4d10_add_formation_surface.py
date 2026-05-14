"""add formation_surface table for cached TIN per (model, formation)

Revision ID: a3b7e29f4d10
Revises: d5e9a1f8b40c
Create Date: 2026-05-14 10:00:00.000000

Creates ``formation_surface`` — a derived-cache table that stores one
interpolated geological surface per (model, formation) pair. Source
of truth remains ``formation_contact``; this table caches the
Delaunay TIN so the section editor + exporters can answer
"give me a polyline along this section line" without re-running the
triangulation on every render.

Schema notes:

* ``method`` is a short string (vs Postgres ENUM) so a future Phase 5
  switch from ``"tin"`` to ``"kriging"`` / ``"rbf"`` / ``"gempy"``
  doesn't need an ``ALTER TYPE``.
* ``vertices`` and ``triangles`` stored as JSONB so the geometry
  payload can grow (edge attributes, hole rings, ...) without an
  alter-table churn.
* ``UNIQUE(model_id, formation_id)`` — exactly one cached surface per
  pair. Recompute upserts via the unique key.
* CASCADE on both FKs so a deleted model / formation drops its cached
  surface automatically.

This is a pure cache — restoring a .strix bundle on a wiped DB will
repopulate via the bundle round-trip; if the bundle doesn't carry
the surface (older v3 saves), the next contact mutation triggers a
fresh compute.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a3b7e29f4d10"
down_revision: str | None = "d5e9a1f8b40c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the formation_surface cache table."""
    op.create_table(
        "formation_surface",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("formation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False, server_default="tin"),
        sa.Column("vertices", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("triangles", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "source_contact_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("source_contact_checksum", sa.LargeBinary(), nullable=False),
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
        sa.ForeignKeyConstraint(["formation_id"], ["geological_formation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "model_id",
            "formation_id",
            name="uq_formation_surface_model_formation",
        ),
    )
    op.create_index(
        "idx_formation_surface_model",
        "formation_surface",
        ["model_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the formation_surface cache table."""
    op.drop_index("idx_formation_surface_model", table_name="formation_surface")
    op.drop_table("formation_surface")
