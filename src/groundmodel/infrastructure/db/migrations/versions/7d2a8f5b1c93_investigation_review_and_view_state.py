"""Per-investigation decisions table + project-level view_state bag.

Revision ID: 7d2a8f5b1c93
Revises: 6092b215146e
Create Date: 2026-05-11 12:00:00.000000

Lands two pieces of the "all engineering decisions persist in the
.gmproj bundle" principle (memory:
project_decisions_in_bundle.md). Without these, opening a
.gmproj on a wiped DB couldn't rehydrate review state or project-level
view toggles — they'd live only in localStorage and break the moment a
user shared the file or moved to a new machine.

Two changes in one revision:

1. ``investigation_review`` — polymorphic per-investigation decision row.
   One table for both CPT- and borehole-anchored decisions so a future
   decision field (correlation confidence, contact-placement hint, …)
   is one column added in one place, not two columns mirrored across
   two investigation tables. Rows exist only where a decision has been
   made; the absence of a row means "unreviewed, not hidden". Avoids
   bloating cpt/borehole with mostly-default columns when projects
   carry thousands of investigations.

   The polymorphic anchor (``target_kind`` + ``target_id``) doesn't have
   a DB-enforced FK to the target row — same trade-off
   ``formation_contact`` makes for its borehole/CPT split. The API
   layer validates target existence on PATCH. A future second-anchor
   discriminator (e.g. virtual section points) is a column-list edit
   here, not a schema rewrite.

2. ``project.view_state`` — JSONB bag for project-level toggle state
   that isn't tied to a specific investigation: DEM overlay enabled +
   opacity, hidden-by-type sets in the map's layer-control, future
   project-level view preferences. JSONB so each new toggle is a key
   in the bag, not another migration. Schema discipline at the
   Pydantic layer; the column itself accepts any JSON object.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "7d2a8f5b1c93"
down_revision = "6092b215146e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create investigation_review + add project.view_state jsonb."""

    # ------------------------------------------------------------------
    # investigation_review — per-(project, investigation) decisions.
    # ------------------------------------------------------------------
    op.create_table(
        "investigation_review",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # Project scope. Same plain-UUID-no-FK convention used elsewhere
        # (CptOrm.app_project_id, BoreholeOrm.app_project_id). Carrying
        # it on the review row lets us list a project's decisions
        # without joining through borehole/cpt.
        sa.Column("app_project_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Polymorphic anchor. ``target_kind`` is a string discriminator
        # ('cpt' | 'borehole'); ``target_id`` is the UUID of the row in
        # the corresponding table. No FK constraint — API-layer
        # validation ensures the row exists at write time.
        sa.Column("target_kind", sa.String(length=20), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Review workflow status. Plain VARCHAR (not a Postgres enum) so
        # adding a new state is an application-side change. Domain
        # allowed values: 'unreviewed' | 'in_progress' | 'reviewed'.
        sa.Column(
            "review_status",
            sa.String(length=20),
            nullable=False,
            server_default="unreviewed",
        ),
        sa.Column("review_notes", sa.Text(), nullable=True),
        # When the row hit 'reviewed'. NULL while still in earlier
        # states; the column re-NULLs when transitioning back to
        # unreviewed/in_progress. Driven by application code, not a
        # trigger, to keep the migration boring.
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        # Project-local hide. Replaces the localStorage
        # `groundmodel.removed.{projectId}.*` set so the decision rides
        # in the .gmproj bundle. The sidebar still treats this as a
        # soft hide (no DB DELETE on the underlying investigation).
        sa.Column(
            "is_hidden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
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
        # One decision row per (kind, target). UUIDs make global
        # uniqueness across kinds astronomically unlikely, so the
        # constraint also implicitly enforces "one row per investigation"
        # without needing target_kind in the unique tuple.
        sa.UniqueConstraint("target_kind", "target_id", name="uq_investigation_review_target"),
        # Allowed target_kind values. Phrased as a CHECK rather than an
        # enum so adding a new kind (e.g. 'virtual_section_point' in a
        # later phase) is an ALTER CONSTRAINT, not an ALTER TYPE.
        sa.CheckConstraint(
            "target_kind IN ('cpt', 'borehole')",
            name="investigation_review_target_kind_chk",
        ),
        sa.CheckConstraint(
            "review_status IN ('unreviewed', 'in_progress', 'reviewed')",
            name="investigation_review_status_chk",
        ),
    )
    op.create_index(
        "idx_investigation_review_app_project_id",
        "investigation_review",
        ["app_project_id"],
    )
    # Common query: "get the review row for this borehole / cpt".
    op.create_index(
        "idx_investigation_review_target",
        "investigation_review",
        ["target_kind", "target_id"],
    )

    # ------------------------------------------------------------------
    # project.view_state — JSONB bag for project-level view toggles.
    # ------------------------------------------------------------------
    # server_default of an empty JSON object so application code can
    # read ``project.view_state["dem_overlay"]`` without null-checking
    # the column itself; missing keys default at the Pydantic layer.
    op.add_column(
        "project",
        sa.Column(
            "view_state",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    """Drop view_state and the investigation_review table."""
    op.drop_column("project", "view_state")
    op.drop_index("idx_investigation_review_target", table_name="investigation_review")
    op.drop_index("idx_investigation_review_app_project_id", table_name="investigation_review")
    op.drop_table("investigation_review")
