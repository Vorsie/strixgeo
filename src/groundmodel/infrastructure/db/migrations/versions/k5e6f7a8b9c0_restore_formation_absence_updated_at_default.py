"""Restore server_default on formation_absence.updated_at.

Revision ID: k5e6f7a8b9c0
Revises: j4d5e6f7a8b9
Create Date: 2026-05-25 18:30:00.000000

Migration ``i3c4d5e6f7a8`` added ``formation_absence.updated_at`` with
``server_default=now()`` for backfill, then dropped the default in the
same migration — citing concern about stale values on UPDATEs made
outside the ORM.

That reasoning was wrong. ``server_default`` fires only on INSERT (when
no value is supplied); it does not affect UPDATE statements at all.
SQLAlchemy's Python-side ``onupdate=func.now()`` handles update
timestamps regardless of whether the DB has an INSERT default.

The ORM ``FormationAbsenceOrm.updated_at`` still declares
``server_default=func.now()``, which tells SQLAlchemy to OMIT the
column from INSERT statements and let the DB fill it. Without the DB
default, the omitted column receives NULL and the NOT NULL constraint
fires.

Symptom: every INSERT into ``formation_absence`` raises
``NotNullViolationError: null value in column "updated_at" of relation
"formation_absence" violates not-null constraint``.

11 integration tests caught this:
* ``test_formation_absence_orm`` — 10 tests covering inserts + cascades
* ``test_project_bundle::test_bundle_carries_formation_absences``

This migration restores the server_default to align the schema with the
ORM contract. It is idempotent under repeat-apply (ALTER COLUMN to the
same default value is a no-op).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "k5e6f7a8b9c0"
down_revision = "j4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Restore the now() server default on formation_absence.updated_at."""
    op.alter_column(
        "formation_absence",
        "updated_at",
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    """Drop the server default again (matches the pre-fix state)."""
    op.alter_column("formation_absence", "updated_at", server_default=None)
