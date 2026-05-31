"""body with extent rename tables

Revision ID: da111560a8d6
Revises: c46a450537ff
Create Date: 2026-05-31 22:28:05.046343

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "da111560a8d6"
down_revision = "c46a450537ff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop content_key + rename tables.

    Order matters: drop FK constraints / indices that reference the old
    names before renaming, then rename, then drop content_key (now that
    no consumer reads it).

    Degenerate-row cleanup
    ----------------------
    Any row in litho_lens whose source_investigation_id ended up NULL
    after the data fill (Task 1.4) is a pre-bilateral stale row that
    can't be reconciled (typically: empty content_key from very old
    schema versions, or content_key referencing deleted contacts).
    Pre-ship amnesty applies — we delete these rows so the
    NOT NULL alter below succeeds.  Integration DB has no such rows
    (it's a clean DB); dev DBs may have one or two artefacts from
    earlier schema iterations.
    """
    bind = op.get_bind()

    # Drop degenerate rows so NOT NULL alter doesn't choke.
    result = bind.execute(sa.text("DELETE FROM litho_lens WHERE source_investigation_id IS NULL"))
    # rowcount is informational for the migration audit trail.
    deleted_count = result.rowcount
    print(
        f"\n  [migration] deleted {deleted_count} degenerate litho_lens row(s) "
        f"with NULL source_investigation_id"
    )

    # Drop content_key (no longer used; body identity is via id + indexes).
    op.drop_column("litho_lens", "content_key")
    op.drop_column("litho_lens_shape", "content_key")

    # Rename tables in dependency order (children first).
    op.rename_table("litho_lens_boundary_node", "body_boundary_node")
    op.rename_table("litho_lens_shape", "body_boundary_shape")
    op.rename_table("litho_lens", "body")

    # source_investigation_id becomes NOT NULL now that data fill is done.
    op.alter_column("body", "source_investigation_id", nullable=False)


def downgrade() -> None:
    """Reverse the rename and NOT NULL constraint; content_key data is lost."""
    op.alter_column("body", "source_investigation_id", nullable=True)
    op.rename_table("body", "litho_lens")
    op.rename_table("body_boundary_shape", "litho_lens_shape")
    op.rename_table("body_boundary_node", "litho_lens_boundary_node")
    # content_key drop is not reversible (data is gone); restore empty column.
    op.add_column("litho_lens", sa.Column("content_key", sa.Text(), nullable=True))
    op.add_column("litho_lens_shape", sa.Column("content_key", sa.Text(), nullable=True))
