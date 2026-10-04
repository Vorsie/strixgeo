"""Borehole deleted DOV permkeys - a DOV re-import never brings back a deleted track.

Revision ID: c8d9e0f1a2b4
Revises: b7c8d9e0f1a2
Create Date: 2026-10-04 12:00:00.000000

Owner dogfeed of the track editor (2026-10-01): a DOV track the user deleted
came back on a DOV bbox re-import. The re-import refreshes a borehole the
project already holds with every interpretation it does not carry (so DOV's
later publications still arrive), which made a deleted track look new. The
borehole now remembers the DOV permkeys of the tracks the user deleted, and
the interpretation import skips them.

Additive: ``deleted_dov_permkeys`` is a ``VARCHAR(64)[]`` NOT NULL with a
server default of ``'{}'`` - every existing borehole has deleted nothing the
import could know of. No bundle ``format_version`` bump: the generic bundle
column serialiser emits the array, and an older bundle without it restores to
the empty default.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c8d9e0f1a2b4"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add ``borehole.deleted_dov_permkeys`` (empty array default)."""
    op.add_column(
        "borehole",
        sa.Column(
            "deleted_dov_permkeys",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    """Drop ``borehole.deleted_dov_permkeys``."""
    op.drop_column("borehole", "deleted_dov_permkeys")
