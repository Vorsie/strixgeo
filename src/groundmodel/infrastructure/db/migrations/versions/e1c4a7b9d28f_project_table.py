"""project table + backfill from existing app_project_id values.

Revision ID: e1c4a7b9d28f
Revises: a91c4e7b6f23
Create Date: 2026-05-10 14:50:00.000000

Promotes the app-level project from desktop-client-only state (localStorage)
into a first-class DB row. Until now, every CPT and borehole carried an
``app_project_id`` UUID whose human-readable name lived only in the
desktop client; this migration creates a ``project`` table that owns the
metadata.

Backfill: any distinct ``app_project_id`` already referenced from
``cpt`` or ``borehole`` gets a ``project`` row with the placeholder name
"Untitled Project" and status='active'. The user can rename via the new
metadata editor; data is never lost. We deliberately do NOT add a
foreign key from cpt/borehole to project in this migration — legacy rows
might reference IDs that no longer exist (deleted projects pre-migration),
and back-filling those edge cases is out of scope. The FK can be added
later once the data is known to be clean.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e1c4a7b9d28f"
down_revision = "a91c4e7b6f23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``project`` table and backfill rows for legacy app_project_ids."""
    op.create_table(
        "project",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("project_number", sa.String(length=80), nullable=True),
        sa.Column("client", sa.String(length=200), nullable=True),
        sa.Column("site_label", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("default_horizontal_epsg", sa.Integer(), nullable=True),
        sa.Column("default_vertical_epsg", sa.Integer(), nullable=True),
        # phase / status stay plain VARCHAR so adding a new lifecycle bucket
        # never requires an ALTER TYPE migration. Validation lives at the
        # Pydantic / domain layer.
        sa.Column("phase", sa.String(length=20), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="active",
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_project_archived_at",
        "project",
        ["archived_at"],
        unique=False,
    )

    # Backfill — every distinct ``app_project_id`` already referenced from cpt
    # or borehole gets a placeholder Project row. ON CONFLICT DO NOTHING so
    # the second source (boreholes) doesn't fight the first (cpts) for the
    # same UUID. The user renames via the metadata editor after migration.
    op.execute(
        """
        INSERT INTO project (id, name, status)
        SELECT DISTINCT app_project_id, 'Untitled Project', 'active'
        FROM (
            SELECT app_project_id FROM cpt WHERE app_project_id IS NOT NULL
            UNION
            SELECT app_project_id FROM borehole WHERE app_project_id IS NOT NULL
        ) AS legacy_ids
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    """Drop the ``project`` table. Backfilled rows are lost on downgrade."""
    op.drop_index("idx_project_archived_at", table_name="project")
    op.drop_table("project")
