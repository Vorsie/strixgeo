"""Position 4 schema pivot — inference-driven absences (#101 R1).

Revision ID: h2b3c4d5e6f7
Revises: g1a2b3c4d5e6
Create Date: 2026-05-24 22:00:00.000000

Reshapes the Approach-C schema to Position 4: auto-infer lens-ness from
correlation topology + observation data.  The explicit gesture is kept as
an override/naming/companion layer.

Changes in this migration
-------------------------

litho_lens
~~~~~~~~~~
* Rename column ``parent_formation_id`` → ``formation_id``.  Semantics are
  the same (the formation the lens body belongs to); the rename drops the
  word "parent" which implied the lens WAS the body.  Under Position 4 the
  lens row is metadata ATTACHED to a body identified by
  ``(formation_id, body_ordinal)``.
* Add column ``body_ordinal INT NOT NULL DEFAULT 0``.  Populated from the
  resolver's body ordinal at NameLensBody time.
* Add UNIQUE constraint on ``(model_id, formation_id, body_ordinal)`` — a
  metadata row must be unique per body; you cannot name the same body twice.

formation_contact
~~~~~~~~~~~~~~~~~
* Drop column ``lens_id`` and its FK + partial index.  Body identity is
  computed by the resolver (correlation-graph connected components), not
  stored on each contact.

litho_lens_absence → formation_absence
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
* Rename table ``litho_lens_absence`` → ``formation_absence``.
* Drop column ``lens_id`` (absence is now scoped to a formation, not a lens).
* Drop constraints ``ck_litho_lens_absence_investigation_kind`` and
  ``uq_litho_lens_absence_lens_investigation``.
* Drop index ``idx_litho_lens_absence_lens``.
* Add column ``formation_id`` UUID NOT NULL FK → geological_formation.id
  ON DELETE CASCADE.
* Add column ``source`` VARCHAR(20) NOT NULL CHECK
  ``source IN ('inferred', 'manual', 'observed')``.
* Add UNIQUE constraint on ``(formation_id, investigation_kind, investigation_id)``.
* Add index on ``formation_id`` (dominant lookup: all absences for a formation).

Schema design decisions (Position 4 architecture, locked in docs/debt.md #101)
-------------------------------------------------------------------------------
* Absence rows are scoped to FORMATIONS, not lenses.  The body ordinal for a
  given investigation's absence is computed at query time by joining with the
  resolver's output — it does not need to be stored.
* ``source`` starts as ``'inferred' | 'manual' | 'observed'``.  Phase 5+
  extends with ``'fault' | 'unconformity' | 'erosion'``; that extension is a
  new migration adding tokens to the CHECK.  The CHECK is named so it can be
  dropped and replaced without a table rebuild.
* ``body_ordinal`` defaults to 0 so the NOT NULL constraint is satisfied for
  existing rows that pre-date the rename (there are no production rows as
  pre-ship amnesty is in effect — but the DEFAULT makes the downgrade path
  symmetric).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "h2b3c4d5e6f7"
down_revision = "g1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply all Position 4 schema changes."""

    # ------------------------------------------------------------------
    # 1. litho_lens: rename parent_formation_id → formation_id
    # ------------------------------------------------------------------
    op.alter_column(
        "litho_lens",
        "parent_formation_id",
        new_column_name="formation_id",
    )
    # Rename the FK constraint to match the new column name so introspection
    # tools and future migrations see a consistent name.
    op.drop_constraint(
        "litho_lens_parent_formation_id_fkey",
        "litho_lens",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_litho_lens_formation_id",
        "litho_lens",
        "geological_formation",
        ["formation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Also rename the index that referenced parent_formation_id.
    op.drop_index("idx_litho_lens_formation", table_name="litho_lens")
    op.create_index("idx_litho_lens_formation", "litho_lens", ["formation_id"])

    # ------------------------------------------------------------------
    # 2. litho_lens: add body_ordinal INT NOT NULL (default 0)
    #    UNIQUE on (model_id, formation_id, body_ordinal)
    # ------------------------------------------------------------------
    op.add_column(
        "litho_lens",
        sa.Column(
            "body_ordinal",
            sa.Integer,
            nullable=False,
            # DEFAULT 0 so existing rows satisfy NOT NULL without a back-fill;
            # NameLensBody sets the real ordinal at creation time.
            server_default=sa.text("0"),
        ),
    )
    op.create_unique_constraint(
        "uq_litho_lens_model_formation_ordinal",
        "litho_lens",
        ["model_id", "formation_id", "body_ordinal"],
    )

    # ------------------------------------------------------------------
    # 3. formation_contact: drop lens_id column + its constraints
    # ------------------------------------------------------------------
    op.drop_index("idx_formation_contact_lens", table_name="formation_contact")
    op.drop_constraint(
        "formation_contact_lens_id_fkey",
        "formation_contact",
        type_="foreignkey",
    )
    op.drop_column("formation_contact", "lens_id")

    # ------------------------------------------------------------------
    # 4. litho_lens_absence → formation_absence
    #    (rename table, reshape columns, add new constraints)
    # ------------------------------------------------------------------
    # 4a. Drop the old constraints and index before the rename.
    op.drop_index("idx_litho_lens_absence_lens", table_name="litho_lens_absence")
    op.drop_constraint(
        "ck_litho_lens_absence_investigation_kind",
        "litho_lens_absence",
        type_="check",
    )
    op.drop_constraint(
        "uq_litho_lens_absence_lens_investigation",
        "litho_lens_absence",
        type_="unique",
    )
    # 4b. Drop the lens_id FK before the column is dropped.
    op.drop_constraint(
        "litho_lens_absence_lens_id_fkey",
        "litho_lens_absence",
        type_="foreignkey",
    )

    # 4c. Rename the table.
    op.rename_table("litho_lens_absence", "formation_absence")

    # 4d. Drop the old lens_id column (no longer needed — absence is
    #     scoped to formation_id, not a lens).
    op.drop_column("formation_absence", "lens_id")

    # 4e. Add formation_id FK column.
    op.add_column(
        "formation_absence",
        sa.Column(
            "formation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
            # Temporary server default to allow the NOT NULL constraint to be
            # applied on a pre-ship database that may have zero rows.  Dropped
            # immediately after the column exists.
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    # Drop the temporary server default — new rows must supply a real value.
    op.alter_column("formation_absence", "formation_id", server_default=None)

    # 4f. Add source column.
    op.add_column(
        "formation_absence",
        sa.Column(
            "source",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'inferred'"),
        ),
    )
    # Drop the server default after the column is created (callers must be
    # explicit about the source at INSERT time).
    op.alter_column("formation_absence", "source", server_default=None)

    # 4g. Add CHECK on source.
    op.create_check_constraint(
        "ck_formation_absence_source",
        "formation_absence",
        "source IN ('inferred', 'manual', 'observed')",
    )

    # 4h. Extend the investigation_kind CHECK to include 'cpt' (the
    #     old constraint covered 'borehole' | 'cpt' on litho_lens_absence;
    #     we re-create it with the same values but a new name).
    op.create_check_constraint(
        "ck_formation_absence_investigation_kind",
        "formation_absence",
        "investigation_kind IN ('borehole', 'cpt')",
    )

    # 4i. UNIQUE on (formation_id, investigation_kind, investigation_id).
    op.create_unique_constraint(
        "uq_formation_absence_formation_investigation",
        "formation_absence",
        ["formation_id", "investigation_kind", "investigation_id"],
    )

    # 4j. Index on formation_id (dominant lookup).
    op.create_index(
        "idx_formation_absence_formation",
        "formation_absence",
        ["formation_id"],
    )


def downgrade() -> None:
    """Reverse all Position 4 schema changes."""

    # ------------------------------------------------------------------
    # 4. formation_absence → litho_lens_absence (reverse)
    # ------------------------------------------------------------------
    op.drop_index("idx_formation_absence_formation", table_name="formation_absence")
    op.drop_constraint(
        "uq_formation_absence_formation_investigation",
        "formation_absence",
        type_="unique",
    )
    op.drop_constraint(
        "ck_formation_absence_investigation_kind",
        "formation_absence",
        type_="check",
    )
    op.drop_constraint(
        "ck_formation_absence_source",
        "formation_absence",
        type_="check",
    )
    op.drop_column("formation_absence", "source")
    op.drop_column("formation_absence", "formation_id")

    # Re-add lens_id FK column to the (renamed-back) table.
    op.add_column(
        "formation_absence",
        sa.Column(
            "lens_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    op.alter_column("formation_absence", "lens_id", server_default=None)
    op.create_foreign_key(
        "litho_lens_absence_lens_id_fkey",
        "formation_absence",
        "litho_lens",
        ["lens_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.rename_table("formation_absence", "litho_lens_absence")

    # Re-create old constraints.
    op.create_check_constraint(
        "ck_litho_lens_absence_investigation_kind",
        "litho_lens_absence",
        "investigation_kind IN ('borehole', 'cpt')",
    )
    op.create_unique_constraint(
        "uq_litho_lens_absence_lens_investigation",
        "litho_lens_absence",
        ["lens_id", "investigation_kind", "investigation_id"],
    )
    op.create_index(
        "idx_litho_lens_absence_lens",
        "litho_lens_absence",
        ["lens_id"],
    )

    # ------------------------------------------------------------------
    # 3. formation_contact: restore lens_id column
    # ------------------------------------------------------------------
    op.add_column(
        "formation_contact",
        sa.Column(
            "lens_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "formation_contact_lens_id_fkey",
        "formation_contact",
        "litho_lens",
        ["lens_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_formation_contact_lens",
        "formation_contact",
        ["lens_id"],
        postgresql_where=sa.text("lens_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # 2. litho_lens: drop body_ordinal + unique constraint
    # ------------------------------------------------------------------
    op.drop_constraint(
        "uq_litho_lens_model_formation_ordinal",
        "litho_lens",
        type_="unique",
    )
    op.drop_column("litho_lens", "body_ordinal")

    # ------------------------------------------------------------------
    # 1. litho_lens: rename formation_id → parent_formation_id
    # ------------------------------------------------------------------
    op.drop_index("idx_litho_lens_formation", table_name="litho_lens")
    op.drop_constraint("fk_litho_lens_formation_id", "litho_lens", type_="foreignkey")
    op.alter_column(
        "litho_lens",
        "formation_id",
        new_column_name="parent_formation_id",
    )
    op.create_foreign_key(
        "litho_lens_parent_formation_id_fkey",
        "litho_lens",
        "geological_formation",
        ["parent_formation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("idx_litho_lens_formation", "litho_lens", ["parent_formation_id"])
