"""litho_correlation_edge — Phase-2 litho correlation table.

Revision ID: e3f4a5b6c7d8
Revises: d0e1f2a3b4c5
Create Date: 2026-05-19 00:00:00.000000

Adds ``litho_correlation_edge``, which records that two
``geological_formation`` rows (both in the same lithostratigraphic
model) belong to the same stratigraphic instance of a given
lithology.  The edge joins formation rows, NOT contact rows — an
edge is a model-level decision that outlives any individual pick.

Schema decisions (architect-locked):

* Edge joins two ``geological_formation`` rows (not contacts).
* ``formation_a_id < formation_b_id`` — canonical ordering enforced
  by a CHECK constraint AND by the use case (UncorrelateLithoUnits /
  CorrelateLithoUnits both normalise to (min, max) before
  INSERT / DELETE).  This halves the uniqueness surface and makes
  the UNIQUE constraint straightforward.
* No self-loop: ``formation_a_id != formation_b_id`` via CHECK.
* ON DELETE CASCADE from ``geological_model`` — deleting a model
  also removes all its correlation edges.  The same cascade fires
  from each formation: deleting formation A removes every edge that
  touches A; the resolver is re-run by the use-case on the next
  mutation.
* ``source VARCHAR(30)`` — currently only 'manual' (user-drawn
  gesture in the section editor).  Future automated sources (CPT
  SBT correlation, G3Dv3 seeding) add new tokens without a
  migration.
* Three indexes: (model_id, formation_a_id), (model_id,
  formation_b_id) for the resolver's component walk; the UNIQUE
  index on (model_id, formation_a_id, formation_b_id) also
  accelerates the idempotent upsert's existence check.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e3f4a5b6c7d8"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None

_TABLE = "litho_correlation_edge"


def upgrade() -> None:
    """Create litho_correlation_edge table with constraints and indexes."""
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # FK to geological_model.  ON DELETE CASCADE — a model deletion
        # removes all its correlation edges atomically without requiring
        # the application to enumerate and delete them first.
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # The two formation endpoints.  Both carry ON DELETE CASCADE —
        # deleting either formation dissolves the edge.  The canonical
        # ordering (a < b) means it is always safe to cascade from
        # either side without worrying about asymmetric dangling rows.
        sa.Column(
            "formation_a_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "formation_b_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Provenance token.  'manual' = user-drawn in the section editor.
        # Future tokens: 'g3dv3_seed', 'cpt_sbt_auto', ...
        sa.Column(
            "source",
            sa.String(length=30),
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
        # Canonical ordering: formation_a_id is always the lesser UUID.
        # The use case enforces this before insert; the CHECK is defence
        # in depth (catches any non-use-case insertion path).
        sa.CheckConstraint(
            "formation_a_id < formation_b_id",
            name="ck_litho_correlation_edge_canonical_order",
        ),
        # No self-loop.  A formation cannot be correlated with itself.
        sa.CheckConstraint(
            "formation_a_id != formation_b_id",
            name="ck_litho_correlation_edge_no_self_loop",
        ),
        # Each (model, formation_a, formation_b) triple is unique.
        # With canonical ordering this also prevents the symmetric
        # duplicate (a→b same as b→a).
        sa.UniqueConstraint(
            "model_id",
            "formation_a_id",
            "formation_b_id",
            name="uq_litho_correlation_edge_triple",
        ),
    )
    # Index supporting the resolver's graph walk: "all edges in this
    # model that touch formation A (as the lesser endpoint)".
    op.create_index(
        "idx_litho_correlation_edge_model_a",
        _TABLE,
        ["model_id", "formation_a_id"],
    )
    # Same walk for formation B (the greater endpoint).
    op.create_index(
        "idx_litho_correlation_edge_model_b",
        _TABLE,
        ["model_id", "formation_b_id"],
    )
    # NOTE: no explicit index on (model_id, formation_a_id,
    # formation_b_id) — the `uq_litho_correlation_edge_triple` UNIQUE
    # constraint above already creates a backing btree index on exactly
    # those columns. A second one would just double insert cost +
    # storage (review S5). The idempotent-upsert existence check uses
    # that constraint's index.


def downgrade() -> None:
    """Drop litho_correlation_edge (all indexes removed with the table)."""
    op.drop_table(_TABLE)
