"""absorb synthetic pinch-out contacts into body extents

Revision ID: ecc4014879af
Revises: da111560a8d6
Create Date: 2026-05-31 23:13:04.775022

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "ecc4014879af"
down_revision = "da111560a8d6"
branch_labels = None
depends_on = None


def _extent_update_sql(side: str) -> str:
    """Return the side-scoped ``UPDATE body`` statement for one extent side.

    The column name is selected from two hard-coded literal statements, never
    built by interpolating ``side`` into the SQL. ``side`` is asserted against
    the allow-list so a value outside ``{"left", "right"}`` raises rather than
    reaching the database (audit #1: kill the injection-shaped f-string idiom).

    Parameters
    ----------
    side : str
        Either ``"left"`` or ``"right"``.

    Returns
    -------
    str
        A parameterised SQL string with ``:neighbour_inv_id`` and ``:body_id``
        bind placeholders.

    Raises
    ------
    AssertionError
        If ``side`` is not exactly ``"left"`` or ``"right"``.
    """
    assert side in ("left", "right"), f"side must be 'left' or 'right', got {side!r}"
    if side == "left":
        return """
                UPDATE body
                SET extent_left_kind = 'extrapolated',
                    extent_left_neighbour_inv_id = :neighbour_inv_id
                WHERE id = :body_id
                  AND extent_left_kind IS NULL
            """
    return """
                UPDATE body
                SET extent_right_kind = 'extrapolated',
                    extent_right_neighbour_inv_id = :neighbour_inv_id
                WHERE id = :body_id
                  AND extent_right_kind IS NULL
            """


def upgrade() -> None:
    """Absorb synthetic pinch-out contacts (source='pinch_out_extrapolation')
    into body extents with kind='extrapolated'.

    For each synthetic contact:
    1. Find a body row of the same formation whose source_investigation_id
       is NOT the neighbour where the synthetic contact lives (i.e. the
       upstream side that was extrapolated FROM).
    2. Determine the side (left/right) by comparing neighbour vs source
       investigation ids. For v1 we use a deterministic rough ordering
       (UUID compare); slice 2's DetectBodies sweep will refine via real
       along-position lookups.
    3. Write extent_<side>_kind='extrapolated' + extent_<side>_neighbour_inv_id
       to the body row (only if that side is currently NULL — don't
       overwrite a previous setting).
    4. Delete the synthetic contact row.

    Edge cases:
    * Synthetic contact whose host body can't be found (orphaned) ->
      drop the synthetic contact with a print warning. Pre-ship amnesty.
    * Synthetic contact whose target side already has a non-NULL
      extent_kind -> skip the absorption for THAT side but still delete
      the synthetic contact (the body's geometry already encodes the
      closure another way).
    """
    bind = op.get_bind()

    # Step 1: collect synthetic contacts.
    synthetic_rows = bind.execute(
        sa.text("""
        SELECT
            fc.id AS contact_id,
            fc.model_id,
            fc.formation_id,
            COALESCE(fc.borehole_id, fc.cpt_id) AS neighbour_inv_id,
            fc.depth_top_m
        FROM formation_contact fc
        WHERE fc.source = 'pinch_out_extrapolation'
    """)
    ).fetchall()

    absorbed = 0
    orphaned = 0
    deleted = 0

    for row in synthetic_rows:
        # Find a host body of the same formation whose source is NOT
        # the neighbour. The body MAY not exist if the lens metadata
        # was never created (pre-bilateral-rule era).
        body_row = bind.execute(
            sa.text("""
            SELECT id, source_investigation_id
            FROM body
            WHERE model_id = :model_id
              AND formation_id = :formation_id
              AND source_investigation_id != :neighbour_inv_id
            LIMIT 1
        """),
            {
                "model_id": row.model_id,
                "formation_id": row.formation_id,
                "neighbour_inv_id": row.neighbour_inv_id,
            },
        ).fetchone()

        if body_row is None:
            print(
                f"WARNING: orphaned synthetic contact {row.contact_id} "
                f"(formation={row.formation_id}, model={row.model_id}) — dropped"
            )
            orphaned += 1
        else:
            # Side determination by UUID compare (rough; slice 2 refines).
            # neighbour_inv_id < source_investigation_id -> neighbour is "left"
            side = (
                "left"
                if str(row.neighbour_inv_id) < str(body_row.source_investigation_id)
                else "right"
            )
            # Conditional update: only set extent if currently NULL.
            updated = bind.execute(
                sa.text(_extent_update_sql(side)),
                {
                    "body_id": body_row.id,
                    "neighbour_inv_id": row.neighbour_inv_id,
                },
            )
            if updated.rowcount > 0:
                absorbed += 1

        # Always delete the synthetic contact (whether absorbed or orphaned).
        bind.execute(
            sa.text("DELETE FROM formation_contact WHERE id = :contact_id"),
            {"contact_id": row.contact_id},
        )
        deleted += 1

    print(
        f"Absorbed synthetic pinch-outs: "
        f"deleted={deleted}, absorbed={absorbed}, orphaned={orphaned}"
    )


def downgrade() -> None:
    """Forward-only: clears the absorbed extents but cannot recreate the
    synthetic contacts (their original dip-projection state is lost)."""
    bind = op.get_bind()
    bind.execute(
        sa.text("""
        UPDATE body
        SET extent_left_kind = NULL, extent_left_neighbour_inv_id = NULL
        WHERE extent_left_kind = 'extrapolated'
    """)
    )
    bind.execute(
        sa.text("""
        UPDATE body
        SET extent_right_kind = NULL, extent_right_neighbour_inv_id = NULL
        WHERE extent_right_kind = 'extrapolated'
    """)
    )
