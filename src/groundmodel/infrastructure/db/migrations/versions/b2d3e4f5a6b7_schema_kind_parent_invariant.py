"""schema integrity hardening — kind / parent_geological_model_id NULL invariant

Revision ID: b2d3e4f5a6b7
Revises: a1c2d3e4f5a6
Create Date: 2026-06-01 00:01:00.000000

CLAUDE.md "Modelling hierarchy" is explicit:

    parent_geological_model_id IS NOT NULL is mandatory for
    lithostratigraphic and geotechnical models; the column is
    DB-nullable ONLY because geological models share it and have
    no parent.

The application layer (CreateGeologicalModel) enforces this via
REQUIRED_PARENT_KIND, but there is no DB-level guard.  A bug in a
write path (direct SQL, a future migration, a test fixture) could
insert a litho model with parent=NULL and the application would
silently treat it as a standalone geological model.

This migration adds a single CHECK constraint that encodes the
documented invariant.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b2d3e4f5a6b7"
down_revision = "a1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add kind/parent NULL-discriminated CHECK constraint.

    The expression mirrors REQUIRED_PARENT_KIND in model_kind.py:
    * kind='geological'              → parent MUST be NULL
    * kind='lithostratigraphic'      → parent MUST be non-NULL
    * kind='geotechnical'            → parent MUST be non-NULL

    Data correction: fix any litho/geotech rows that somehow ended up
    with a NULL parent.  Pre-ship amnesty applies; there should be zero
    such rows on any legitimate DB, but the guard is here for safety.
    """
    bind = op.get_bind()

    # Fix orphan litho/geotech rows — set parent to any geological model
    # in the same project when possible.  If no geological model exists,
    # demote the row to kind='geological' (least-harm choice).
    orphan_result = bind.execute(
        sa.text("""
        SELECT gm.id, gm.app_project_id, gm.kind
        FROM geological_model gm
        WHERE gm.kind IN ('lithostratigraphic', 'geotechnical')
          AND gm.parent_geological_model_id IS NULL
        """)
    ).fetchall()

    if orphan_result:
        print(
            f"\n  [migration] found {len(orphan_result)} litho/geotech model(s)"
            f" with NULL parent — attempting repair"
        )
        for row in orphan_result:
            # Try to find a matching geological parent in the same project.
            parent = bind.execute(
                sa.text("""
                SELECT id FROM geological_model
                WHERE app_project_id = :app_project_id
                  AND kind = 'geological'
                LIMIT 1
                """),
                {"app_project_id": row.app_project_id},
            ).fetchone()

            if parent:
                bind.execute(
                    sa.text(
                        "UPDATE geological_model"
                        " SET parent_geological_model_id = :parent_id"
                        " WHERE id = :model_id"
                    ),
                    {"parent_id": parent.id, "model_id": row.id},
                )
                print(f"    repaired model {row.id} (kind={row.kind}) → parent={parent.id}")
            else:
                bind.execute(
                    sa.text("UPDATE geological_model SET kind = 'geological' WHERE id = :model_id"),
                    {"model_id": row.id},
                )
                print(f"    demoted model {row.id} (kind={row.kind} → geological, no parent found)")

    # Also fix geological models that accidentally have a parent set.
    geo_with_parent = bind.execute(
        sa.text("""
        UPDATE geological_model
        SET parent_geological_model_id = NULL
        WHERE kind = 'geological' AND parent_geological_model_id IS NOT NULL
        """)
    )
    if geo_with_parent.rowcount:
        print(
            f"\n  [migration] cleared parent_geological_model_id on"
            f" {geo_with_parent.rowcount} geological model(s)"
        )

    op.create_check_constraint(
        "ck_geological_model_kind_parent_null",
        "geological_model",
        "(kind = 'geological' AND parent_geological_model_id IS NULL)"
        " OR (kind IN ('lithostratigraphic', 'geotechnical')"
        "     AND parent_geological_model_id IS NOT NULL)",
    )


def downgrade() -> None:
    """Drop the kind/parent invariant constraint."""
    op.drop_constraint("ck_geological_model_kind_parent_null", "geological_model", type_="check")
