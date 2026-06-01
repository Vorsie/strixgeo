"""schema integrity hardening — geological_model is_active partial UNIQUE per (project, kind)

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-06-01 00:04:00.000000

Invariant: at most one active model per (app_project_id, kind).

Today this is enforced by ``create_model`` and ``set_active_model`` in
GeologyRepository (each clears same-kind siblings before setting is_active=True),
but there is no DB-level guard.  A direct-SQL insert, a buggy migration, or a
concurrent write (not plausible today — single-user, but worth guarding) could
leave two geological models active for the same project, making the desktop
client's ``find(m => m.is_active && m.kind === ...)`` render non-deterministically.

Partial unique (PostgreSQL syntax)
------------------------------------
    UNIQUE (app_project_id, kind) WHERE (is_active = TRUE)

This allows:
  * Multiple INACTIVE models per (project, kind)  ← normal during model switching
  * One ACTIVE model per (project, kind)           ← the enforced invariant
  * One ACTIVE geological + one ACTIVE lithostratigraphic in the same project
    ← different kinds, no conflict (CLAUDE.md "three-level hierarchy")

Data correction
---------------
If any (project, kind) has multiple is_active=TRUE rows, keep the most recently
updated one and deactivate the rest.  Pre-ship amnesty: dev DB had 0 violations
(confirmed by pre-flight survey).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "t4u5v6w7x8y9"
down_revision = "c3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Dedup active models per (project, kind), then add partial-unique index."""
    bind = op.get_bind()

    # Dedup: keep the most-recently-updated active model per (project, kind);
    # deactivate all others in each duplicate group.
    dup_result = bind.execute(
        sa.text("""
        UPDATE geological_model
        SET is_active = FALSE
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY app_project_id, kind
                           ORDER BY updated_at DESC, id DESC
                       ) AS rn
                FROM geological_model
                WHERE is_active = TRUE
            ) ranked
            WHERE rn > 1
        )
        """)
    )
    if dup_result.rowcount:
        print(
            f"\n  [migration t4u5v6w7x8y9] deactivated {dup_result.rowcount} "
            f"geological_model row(s) that were duplicate-active per (project, kind) "
            f"— kept the most-recently-updated row active per group"
        )

    # Create the partial-unique index.
    # CONCURRENTLY is not available inside a transaction (Alembic default);
    # pre-ship: single-user, no concurrent writes, table-lock is safe.
    op.create_index(
        "uq_geological_model_one_active_per_kind",
        "geological_model",
        ["app_project_id", "kind"],
        unique=True,
        postgresql_where=sa.text("is_active = TRUE"),
    )


def downgrade() -> None:
    """Drop the partial-unique is_active index."""
    op.drop_index("uq_geological_model_one_active_per_kind", table_name="geological_model")
