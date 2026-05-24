"""litho_lens_absence — investigation-level absence join for lens entities (#101 Slice 2).

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-24 19:00:00.000000

Adds ``litho_lens_absence``: records that a given investigation
(borehole or CPT) shows positive evidence of ABSENCE for a particular
litho lens body at the depth range that lens occupies.

Schema decisions (design in docs/debt.md #101 Slice 2):

* No FK on ``investigation_id`` — the discriminator column
  ``investigation_kind`` distinguishes between the borehole and cpt
  tables, and PostgreSQL does not support polymorphic FK without an
  abstract investigations table (which we don't have — the ORM layer
  handles cross-referencing).
* ``investigation_kind`` is a VARCHAR(10) with a named CHECK constraint
  so new investigation types can join as a migration adding a new
  allowed token.
* ``ON DELETE CASCADE`` on ``lens_id`` — deleting the lens evaporates
  all of its absence records atomically; the use case does not need to
  enumerate them first.
* UNIQUE (lens_id, investigation_kind, investigation_id) — a lens can
  declare the same investigation absent at most once.  Idempotent
  re-submission is handled at the use-case layer by attempting the
  INSERT and ignoring the duplicate.
* Index on ``lens_id`` for the dominant query: "all absences for
  this lens" (loaded whenever the lens inspector or the section
  renderer needs to know which columns are absent).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None

_TABLE = "litho_lens_absence"


def upgrade() -> None:
    """Create litho_lens_absence with constraints and indexes."""
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # FK to litho_lens. ON DELETE CASCADE — deleting the lens
        # evaporates all of its absence records automatically.
        sa.Column(
            "lens_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("litho_lens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Polymorphic investigation reference. No FK — investigation_kind
        # determines which concrete table to query for validation.
        sa.Column(
            "investigation_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        # Discriminator: which investigation table owns investigation_id.
        # Constrained to 'borehole' or 'cpt' today; future investigation
        # types (DMT, pressuremeter, ...) extend the CHECK in a new
        # migration rather than here.
        sa.Column(
            "investigation_kind",
            sa.String(length=10),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Only 'borehole' and 'cpt' are valid investigation kinds for
        # the Phase-4 MVP. The constraint is named so it can be dropped
        # and replaced when a new kind is introduced.
        sa.CheckConstraint(
            "investigation_kind IN ('borehole', 'cpt')",
            name="ck_litho_lens_absence_investigation_kind",
        ),
        # A lens can declare the same (kind, investigation) absent at
        # most once — idempotent re-submission is the use-case's
        # responsibility, not the DB's.
        sa.UniqueConstraint(
            "lens_id",
            "investigation_kind",
            "investigation_id",
            name="uq_litho_lens_absence_lens_investigation",
        ),
    )
    # Primary lookup: all absence rows for a given lens. Used whenever
    # the section renderer or inspector loads a lens's absence set.
    op.create_index(
        "idx_litho_lens_absence_lens",
        _TABLE,
        ["lens_id"],
    )


def downgrade() -> None:
    """Drop litho_lens_absence (indexes removed before table drop)."""
    op.drop_index("idx_litho_lens_absence_lens", table_name=_TABLE)
    op.drop_table(_TABLE)
