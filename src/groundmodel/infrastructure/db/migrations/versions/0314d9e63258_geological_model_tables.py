"""Geological model tables — formations, models, formation contacts.

Revision ID: 0314d9e63258
Revises: e1c4a7b9d28f
Create Date: 2026-05-10 22:30:00.000000

Introduces the geological-model data layer behind the v1.0 commercial
MVP (Phase 4). Three tables:

* ``geological_formation`` — per-project formation vocabulary
  (Boom Klei, Diest Zand, Quaternary, ...). Each has a name, optional
  code, color, display order, and an optional opaque ``regional_ref``
  pointing back to whatever public/regional model seeded it
  (G3Dv3 in Flanders, BRO-NL DGM, etc.).
* ``geological_model`` — an interpretation container. A project can
  carry multiple alternative interpretations; one is flagged active.
  ``excluded_borehole_ids`` is the inverted-scope column: empty means
  every project borehole contributes; an explicit list scopes the
  model to a subset.
* ``formation_contact`` — the primary data point: "this formation
  tops out at this depth at this investigation". Anchored to either a
  borehole or a CPT (XOR enforced via CHECK constraint). CPT-anchored
  contacts stay reserved for Phase 5 (Robertson Ic → CPT-derived
  stratigraphy); v1 writes only borehole-anchored contacts.

Design choices documented inline. Cascade rules:

* DELETE formation → CASCADE delete every contact referencing it.
* DELETE model → CASCADE delete every contact inside it.
* DELETE borehole / CPT → CASCADE delete the anchor's contacts (we
  don't want orphan rows pointing at non-existent investigations).
* DELETE observation / observation_layer → SET NULL on the contact's
  provenance pointers; the contact still stands on its own depth
  value even if the source observation was reshuffled.

The "no gaps" invariant (a borehole's formation contacts must form a
contiguous depth coverage with no unassigned ranges) is NOT a hard DB
constraint — it's a domain validation that runs on save. Hard
constraints would fight legitimate edits (mid-edit overlap when
inserting a new contact between two existing ones).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0314d9e63258"
down_revision = "e1c4a7b9d28f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create geological_formation, geological_model, formation_contact tables."""

    # ------------------------------------------------------------------
    # geological_formation — per-project vocabulary of substrate units
    # ------------------------------------------------------------------
    op.create_table(
        "geological_formation",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # App-level project scope. Plain UUID (no FK), matching the
        # existing convention for app_project_id columns elsewhere.
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        # Short code for borelog rendering and exports (e.g. "Bm" for
        # Boom Klei). Optional — many projects have only a handful of
        # formations and the full name is enough.
        sa.Column("code", sa.String(length=50), nullable=True),
        # Hex color used by borelog + cross-section render. Defaults to
        # a neutral grey at the API layer if the caller omits it.
        sa.Column("color", sa.String(length=20), nullable=False),
        # Top-to-bottom display order. Two formations with the same
        # display_order in the same project is allowed (the UI just
        # tie-breaks by name); the column is a hint not a constraint.
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        # Opaque pointer to whatever public/regional source seeded this
        # formation (G3Dv3 formation id, BRO-NL DGM unit code, etc.).
        # Free-text so we don't have to migrate when a new source lands.
        sa.Column("regional_ref", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_geological_formation_app_project_id",
        "geological_formation",
        ["app_project_id"],
    )

    # ------------------------------------------------------------------
    # geological_model — interpretation container
    # ------------------------------------------------------------------
    op.create_table(
        "geological_model",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # One model per project flagged active = the default-displayed
        # interpretation. The desktop client's app-level guard keeps
        # only one active per project; the DB doesn't enforce uniqueness
        # so legacy data + transitional states are tolerated.
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        # Inverted scope: an empty list (default) means every borehole
        # in the project contributes. Explicit ids exclude. Stored as a
        # Postgres ARRAY for cheap lookup; future SaaS might normalise
        # this into a junction table but not at v1.
        sa.Column(
            "excluded_borehole_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_geological_model_app_project_id",
        "geological_model",
        ["app_project_id"],
    )

    # ------------------------------------------------------------------
    # formation_contact — anchored data point
    # ------------------------------------------------------------------
    op.create_table(
        "formation_contact",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # CASCADE on both ends — a deleted model / formation evaporates
        # the contacts that referenced them; their data was meaningless
        # without the parent.
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_model.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "formation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("geological_formation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Anchor: exactly one of (borehole_id, cpt_id) is set. The CPT
        # column is column-reserved for Phase 5; v1 only writes via
        # borehole. CASCADE so deleted investigations don't leave
        # dangling contacts.
        sa.Column(
            "borehole_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("borehole.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "cpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cpt.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # The actual depth value the model cares about. Positive
        # downwards, measured from the investigation's surface.
        sa.Column("depth_top_m", sa.Double(), nullable=False),
        # Provenance — 'borehole_observation' when the contact was
        # derived from an Observation/ObservationLayer, 'manual_pick'
        # when the user typed it in, 'interpolated' for Phase 5 auto-
        # picks. Plain VARCHAR — enum-evolution migrations are pain.
        sa.Column("source", sa.String(length=30), nullable=False),
        # Optional links back to the observation row that drove this
        # contact. SET NULL on parent delete so the contact survives a
        # reshuffle of the underlying observation while losing its
        # provenance link (the user can re-link or accept the loss).
        sa.Column(
            "observation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("observation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "observation_layer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("observation_layer.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "confidence",
            sa.String(length=10),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        # XOR anchor — exactly one of borehole_id / cpt_id is set.
        # Phrased as ``num_nonnull = 1`` so a future second anchor
        # column (e.g. virtual_section_point_id) is a small edit.
        sa.CheckConstraint(
            "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END) "
            "+ (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="formation_contact_anchor_xor",
        ),
    )
    op.create_index(
        "idx_formation_contact_model_borehole",
        "formation_contact",
        ["model_id", "borehole_id"],
    )
    op.create_index(
        "idx_formation_contact_model_formation",
        "formation_contact",
        ["model_id", "formation_id"],
    )


def downgrade() -> None:
    """Drop the three geological-model tables (reverse order of upgrade)."""
    op.drop_index("idx_formation_contact_model_formation", table_name="formation_contact")
    op.drop_index("idx_formation_contact_model_borehole", table_name="formation_contact")
    op.drop_table("formation_contact")
    op.drop_index("idx_geological_model_app_project_id", table_name="geological_model")
    op.drop_table("geological_model")
    op.drop_index("idx_geological_formation_app_project_id", table_name="geological_formation")
    op.drop_table("geological_formation")
