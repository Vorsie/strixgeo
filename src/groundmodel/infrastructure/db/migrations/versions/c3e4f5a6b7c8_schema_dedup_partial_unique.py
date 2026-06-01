"""schema integrity hardening — partial-unique indexes for CPT and borehole dedup

Revision ID: c3e4f5a6b7c8
Revises: b2d3e4f5a6b7
Create Date: 2026-06-01 00:02:00.000000

The dedup query in CptRepository.find_by_project_test /
BoreholeRepository.find_by_project_test filters on
(app_project_id, project_id, test_id).  Without a covering index
Postgres does a sequential scan of the whole table for each dedup
check — harmless at 50 CPTs, noticeable at 500+.

Two partial-unique indexes (WHERE app_project_id IS NOT NULL):
- uq_cpt_app_project_source_test
- uq_borehole_app_project_source_test

The partial condition (app_project_id IS NOT NULL) mirrors the
scoping logic in the repository: the same (project_id, test_id)
pair CAN appear in two different app_projects — the dedup is
intentionally project-scoped.  The partial-unique prevents a true
duplicate within one app_project while leaving NULL-scoped rows
(legacy rows without a project assignment) unrestricted.

These are UNIQUE indexes, not just covering indexes — they also
enforce at the DB layer that you cannot have two CPTs with the same
(app_project_id, project_id, test_id).  The application layer
already enforces this via find_by_project_test + 409, but a DB-level
unique is defence-in-depth against race-condition double-inserts.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3e4f5a6b7c8"
down_revision = "b2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add partial-unique dedup indexes for cpt and borehole.

    CONCURRENTLY is not available inside a transaction; Alembic wraps
    each migration step in a transaction by default so we cannot use
    it here.  Pre-ship: no concurrent writes, no users, safe to lock.
    """
    bind = op.get_bind()

    # Remove any duplicate (app_project_id, project_id, test_id) rows
    # before the unique index is added — keep the row with the SMALLEST
    # id (earliest import), matching the existing dedup behaviour.
    dup_cpt = bind.execute(
        sa.text("""
        DELETE FROM cpt
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY app_project_id, project_id, test_id
                           ORDER BY id
                       ) AS rn
                FROM cpt
                WHERE app_project_id IS NOT NULL
            ) ranked
            WHERE rn > 1
        )
        """)
    )
    if dup_cpt.rowcount:
        print(
            f"\n  [migration] removed {dup_cpt.rowcount} duplicate cpt row(s)"
            f" before partial-unique index"
        )

    op.create_index(
        "uq_cpt_app_project_source_test",
        "cpt",
        ["app_project_id", "project_id", "test_id"],
        unique=True,
        postgresql_where=sa.text("app_project_id IS NOT NULL"),
    )

    dup_bh = bind.execute(
        sa.text("""
        DELETE FROM borehole
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY app_project_id, project_id, test_id
                           ORDER BY id
                       ) AS rn
                FROM borehole
                WHERE app_project_id IS NOT NULL
            ) ranked
            WHERE rn > 1
        )
        """)
    )
    if dup_bh.rowcount:
        print(
            f"\n  [migration] removed {dup_bh.rowcount} duplicate borehole row(s)"
            f" before partial-unique index"
        )

    op.create_index(
        "uq_borehole_app_project_source_test",
        "borehole",
        ["app_project_id", "project_id", "test_id"],
        unique=True,
        postgresql_where=sa.text("app_project_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop the partial-unique dedup indexes."""
    op.drop_index("uq_borehole_app_project_source_test", table_name="borehole")
    op.drop_index("uq_cpt_app_project_source_test", table_name="cpt")
