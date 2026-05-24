"""litho_lens — first-class entity for litho lens bodies (#101).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-24 18:30:00.000000

Adds ``litho_lens``: a body of one lithology embedded within a parent
formation, present at some investigations and absent at others. The
lens carries identity so two distinct lenses of the same parent
formation (e.g. two clay drapes at different elevations within the
same sand) do not collide (owner Q1 directive 2026-05-24 — two
LithoLens entities sharing the same parent formation).

Also adds nullable ``lens_id`` to ``formation_contact`` so contacts
can be tagged as belonging to a specific lens body. The FK uses
``ON DELETE SET NULL`` rather than CASCADE because the lens row is
metadata over real contact geometry — deleting the lens should not
silently delete the synthetic / anchored contacts. The companion
``DeleteLithoLens`` use case will explicitly delete synthetic-only
contacts as a separate step (#101 Slice 3).

Schema decisions (owner-locked, design in docs/debt.md #101):

* ``parent_formation_id`` is mandatory — a lens lives inside a
  formation; without a parent it has no place in the stratigraphy.
* ``app_project_id`` is denormalised onto the lens so project-scope
  queries don't need a join through model+formation. Same pattern as
  every other project-scoped entity.
* ``name`` is nullable — optional human label ("Channel sand lens").
  When null the UI renders a derived label ("Lens 1 in <formation>").
* No ``kind`` column today — every lens is litho-stage. If geology-
  stage lenses arrive (Phase 5+), the column joins as a new
  migration with default ``'litho'``.

The absence join (``litho_lens_absence``) and section-local wedge
math land in Slice 2 — keeping this migration to the entity itself
+ the contact FK so the foundation can ship + integration-test
independently of the math.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None

_LENS_TABLE = "litho_lens"
_CONTACT_TABLE = "formation_contact"


def upgrade() -> None:
    """Create litho_lens + add nullable lens_id to formation_contact."""
    op.create_table(
        _LENS_TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        # Denormalised project-scope key. Existing project-scoped
        # tables (cpt, borehole, cross_section, geological_model, ...)
        # carry ``app_project_id`` as a plain UUID without an FK —
        # legacy convention, tracked under debt #107. Greenfield
        # tables created from #101 onward DO declare the FK so the
        # cascade is enforced at the DB layer.
        sa.Column(
            "app_project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # FK to the lithostratigraphic model. CASCADE — model deletion
        # removes the lens (the lens has no meaning outside its model).
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # The formation the lens carves out of. Mandatory: a lens is
        # always a body within a parent formation. CASCADE — deleting
        # the parent formation also removes its lenses.
        sa.Column(
            "parent_formation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Optional human label. UI falls back to a derived name when null.
        sa.Column(
            "name",
            sa.String(length=120),
            nullable=True,
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
    )
    # Two indexes: lens-by-model (common: "all lenses in this model")
    # and lens-by-formation (less common but supports "how many lenses
    # carve this formation").
    op.create_index(
        "idx_litho_lens_model",
        _LENS_TABLE,
        ["model_id"],
    )
    op.create_index(
        "idx_litho_lens_formation",
        _LENS_TABLE,
        ["parent_formation_id"],
    )
    # Project-scope index for the bundle-restore + listing endpoints
    # that load every lens for a project in one query.
    op.create_index(
        "idx_litho_lens_project",
        _LENS_TABLE,
        ["app_project_id"],
    )

    # Tag column on formation_contact. Nullable — most contacts have
    # no lens. ON DELETE SET NULL — the lens row is metadata; deleting
    # it should NOT silently delete the underlying contacts. The
    # DeleteLithoLens use case (Slice 3) handles synthetic cleanup
    # explicitly.
    op.add_column(
        _CONTACT_TABLE,
        sa.Column(
            "lens_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("litho_lens.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Partial index — only contacts WITH a lens are interesting to
    # query by lens. Skips the (large) majority of rows with NULL.
    op.create_index(
        "idx_formation_contact_lens",
        _CONTACT_TABLE,
        ["lens_id"],
        postgresql_where=sa.text("lens_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop the lens_id column from formation_contact, then drop litho_lens."""
    op.drop_index("idx_formation_contact_lens", table_name=_CONTACT_TABLE)
    op.drop_column(_CONTACT_TABLE, "lens_id")
    op.drop_table(_LENS_TABLE)
