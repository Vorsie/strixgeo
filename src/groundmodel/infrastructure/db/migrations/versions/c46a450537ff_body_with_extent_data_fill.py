"""body with extent data fill

Revision ID: c46a450537ff
Revises: 4d0bd7dc0605
Create Date: 2026-05-31 22:23:52.981344

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c46a450537ff"
down_revision = "4d0bd7dc0605"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Populate source_investigation_id + shape body_id for existing rows.

    Parameters
    ----------
    None

    Returns
    -------
    None

    Notes
    -----
    Strategy:

    1. Join litho_lens_shape.body_id by (model_id, content_key) match
       to the parent litho_lens row.  This sets up the FK we rely on in
       revision 1.5 when content_key is dropped.

    2. Populate litho_lens.source_investigation_id from each row's
       defining contacts.  For each litho_lens row with
       content_key 'a|b|c', the source investigation is the most-common
       investigation among the three defining formation_contact rows (the
       two source contacts share an investigation; the target is on a
       different investigation — majority wins, tie broken by UUID
       lexicographic order for determinism).

    NOT populated here:

    - extent_*_kind / extent_*_target_contact_id / extent_*_neighbour_inv_id
      columns.  The startup sweep (already wired in main.py) re-runs
      DetectBodies after slice 2 lands, which populates extents from the
      bilateral-closure detection.  Until then every body row has NULL
      extents and the existing renderer (which still reads content_key
      via the unchanged ORM class until slice 1.6) works as before.

    Pre-condition: the morning's startup lens sweep cleaned unilateral
    stale rows; surviving rows are all bilateral (per the new rule).
    If the dev DB has zero litho_lens rows the SQL is a no-op.
    """
    bind = op.get_bind()

    # Step 1: join shape.body_id by content_key.
    # Matches shapes to their parent lens by (model_id, content_key).
    # Only touches rows where body_id is still NULL so re-runs are safe.
    bind.execute(
        sa.text("""
        UPDATE litho_lens_shape s
        SET body_id = l.id
        FROM litho_lens l
        WHERE s.model_id = l.model_id
          AND s.content_key = l.content_key
          AND s.body_id IS NULL
    """)
    )

    # Step 2: derive source_investigation_id from each row's defining contacts.
    # content_key is 'a|b|c' (pipe-separated UUIDs of three formation_contact
    # rows).  We pick the most-common investigation among those three contacts
    # as the source: in the bilateral lens geometry the two source contacts
    # share one investigation, the target contact is on a different one, so
    # the majority investigation is always the source side.
    # ROW_NUMBER + ORDER BY cnt DESC, inv_id guarantees a deterministic winner
    # even in the degenerate case where all three contacts are on distinct
    # investigations.
    bind.execute(
        sa.text("""
        UPDATE litho_lens l
        SET source_investigation_id = sub.inv_id
        FROM (
            SELECT
                l2.id AS lens_id,
                COALESCE(fc.borehole_id, fc.cpt_id) AS inv_id,
                COUNT(*) AS cnt,
                ROW_NUMBER() OVER (
                    PARTITION BY l2.id
                    ORDER BY COUNT(*) DESC, COALESCE(fc.borehole_id, fc.cpt_id)
                ) AS rn
            FROM litho_lens l2
            JOIN formation_contact fc
              ON fc.id::text = ANY(string_to_array(l2.content_key, '|'))
            WHERE l2.source_investigation_id IS NULL
            GROUP BY l2.id, COALESCE(fc.borehole_id, fc.cpt_id)
        ) sub
        WHERE l.id = sub.lens_id
          AND sub.rn = 1
    """)
    )


def downgrade() -> None:
    """Reverse the data fill by clearing the populated columns.

    Parameters
    ----------
    None

    Returns
    -------
    None

    Notes
    -----
    Forward-only in spirit (the column values can be re-derived from
    surviving data), but NULL-ing them brings the DB back to the
    pre-upgrade state so downgrade to 4d0bd7dc0605 leaves the schema
    consistent.
    """
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE litho_lens SET source_investigation_id = NULL"))
    bind.execute(sa.text("UPDATE litho_lens_shape SET body_id = NULL"))
