"""Back-link litho layers sitting exactly on an unlinked geological contact.

Data repair (owner ruling 2026-08-11, audit F34). The accept-time coupling snaps
the geological contact's depth onto the litho boundary — bit-for-bit — and sets
``parent_geo_contact_id``. Deleting and re-accepting the litho contact used to
restore the row WITHOUT the link (the found-existing branch skipped re-coupling
along with the snap), leaving one physical boundary recorded at two levels with
no coupling: a later contact move then carried the litho row and left the
geological contact behind. The dev model grew two such rows.

The code paths are fixed in the same batch (re-accept re-links; the movers heal
by coincidence); this repairs the rows that already exist. Only unambiguous
pairs are linked: exactly ONE geological contact on the parent geological model,
same investigation, within the movers' own 1.1 mm coincidence tolerance — at
that distance an accidental coincidence does not exist, only the snap's copy.

Revision ID: b3c4d5e6f7a8
Revises: 9f8e7d6c5b4a
Create Date: 2026-08-11
"""

from __future__ import annotations

from alembic import op

revision = "b3c4d5e6f7a8"
down_revision = "9f8e7d6c5b4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Link every accepted litho layer to its coinciding, unlinked geo contact."""
    result = op.get_bind().exec_driver_sql(
        """
        WITH candidates AS (
            SELECT ll.id AS layer_id,
                   fc.id AS contact_id,
                   COUNT(*) OVER (PARTITION BY ll.id) AS n
            FROM litho_layer ll
            JOIN geological_model lm
              ON lm.id = ll.model_id AND lm.kind = 'lithostratigraphic'
            JOIN formation_contact fc
              ON fc.model_id = lm.parent_model_id
             AND (
                   (fc.cpt_id IS NOT NULL AND fc.cpt_id = ll.cpt_id)
                OR (fc.borehole_id IS NOT NULL AND fc.borehole_id = ll.borehole_id)
             )
             AND abs(fc.depth_top_m - ll.depth_top_m) <= 0.0011
            WHERE ll.parent_geo_contact_id IS NULL
              AND ll.status = 'accepted'
        )
        UPDATE litho_layer
        SET parent_geo_contact_id = c.contact_id
        FROM candidates c
        WHERE litho_layer.id = c.layer_id
          AND c.n = 1
        """
    )
    print(f"  [migration] re-linked {result.rowcount} coinciding litho-geo pair(s)")


def downgrade() -> None:
    """No-op: severing repaired links would recreate the defect being repaired."""
