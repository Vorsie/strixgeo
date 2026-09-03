"""body_boundary_shape schema-parity fix (TEST-08)

Reconciles the live ``body_boundary_shape`` schema with
``BodyBoundaryShapeOrm``. The body-with-extent slice
(``4d0bd7dc0605`` … ``da111560a8d6``) renamed the old
``litho_lens_shape`` table and swapped its ``(model_id, content_key)``
key for a direct ``body_id`` FK, but four representation details were
never migrated to match the ORM, so ``compare_metadata`` reported
genuine drift:

1. ``body_id`` was added ``nullable=True`` (``4d0bd7dc0605``) and never
   tightened; the ORM declares it ``nullable=False``.
2. The ORM declares ``UniqueConstraint("body_id",
   name="uq_body_boundary_shape_body_id")`` (one shape per body); no
   migration ever created it.
3. / 4. ``created_at`` / ``updated_at`` were created on the original
   ``litho_lens_shape`` table (``b2f1c9a47d30``) but dropped from the
   ORM model; the DB columns were never removed.

Backwards-compat is suspended pre-ship (owner directive 2026-05-16), so
this is a clean forward-only reconciliation. The upgrade first deletes
any NULL-``body_id`` rows and de-duplicates rows sharing a ``body_id``
(both are orphan/degenerate states — a shape is meaningless without its
body, and the ORM invariant is one shape per body) so the NOT-NULL +
UNIQUE tightening cannot fail on existing data.

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-07-13 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "z0a1b2c3d4e5"
down_revision = "y9z0a1b2c3d4"
branch_labels = None
depends_on = None

# Declares that ``upgrade()`` deletes existing user rows (DELETEs orphan /
# duplicate body_boundary_shape rows) so the migrator's pre-migration backup
# step names it among the pending data-rewriting migrations
# (production-readiness audit H2b).
DATA_REWRITE = True


def upgrade() -> None:
    """Tighten body_id, add the per-body unique constraint, drop timestamp columns."""
    # Degenerate rows: a shape with no body is an orphan the resolver sweep
    # would delete anyway. Remove them so the NOT-NULL tighten cannot fail.
    op.execute("DELETE FROM body_boundary_shape WHERE body_id IS NULL")

    # Enforce one-shape-per-body before adding the UNIQUE: keep the lexically
    # first id per body_id, drop the rest. Duplicate shapes are a pre-invariant
    # artefact — the ORM has always treated body_id as the single key.
    op.execute(
        """
        DELETE FROM body_boundary_shape a
        USING body_boundary_shape b
        WHERE a.body_id = b.body_id
          AND a.id > b.id
        """
    )

    op.alter_column("body_boundary_shape", "body_id", nullable=False)
    op.create_unique_constraint(
        "uq_body_boundary_shape_body_id",
        "body_boundary_shape",
        ["body_id"],
    )
    op.drop_column("body_boundary_shape", "created_at")
    op.drop_column("body_boundary_shape", "updated_at")


def downgrade() -> None:
    """No downgrade — backwards-compat is suspended pre-ship."""
    raise NotImplementedError("backwards-compat suspended pre-ship; no downgrade")
