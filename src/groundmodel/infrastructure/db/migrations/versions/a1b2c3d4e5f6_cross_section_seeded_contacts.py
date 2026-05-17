"""cross_section — add seeded_formation_contact_ids column.

Revision ID: a1b2c3d4e5f6
Revises: f3a6b1c0d9e2
Create Date: 2026-05-17 00:00:00.000000

Owner directive 2026-05-17: a freshly-drawn section shows investigations
only.  Formation content appears on a section ONLY where the user
explicitly placed it via that section's own "Seed from stratigraphy"
button or manual drawing on that section.

The per-section included-contact set is stored as a PostgreSQL UUID ARRAY
on the ``cross_section`` table.  Empty array (the default) means "nothing
seeded yet — show investigations only".  The section renderer + snapshot
builder filter model contacts to only those whose id ∈ this set.

Mirror of the existing ``excluded_borehole_ids`` / ``excluded_cpt_ids``
columns (NOT NULL, server_default '{}') so the plumbing is consistent.

Backwards-compat note: NOT NULL DEFAULT '{}' is safe for existing rows —
Postgres fills every existing row with an empty array at migration time.
Pre-migration sections had auto-reflected contacts via the old all-contacts
path.  Post-migration they have an empty seeded set, which means they show
nothing until re-seeded.  This is the owner-mandated intentional breaking
behaviour change (backwards-compat SUSPENDED pre-ship — see CLAUDE.md).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "f3a6b1c0d9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add seeded_formation_contact_ids to cross_section."""
    op.add_column(
        "cross_section",
        sa.Column(
            "seeded_formation_contact_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    """Remove seeded_formation_contact_ids from cross_section."""
    op.drop_column("cross_section", "seeded_formation_contact_ids")
