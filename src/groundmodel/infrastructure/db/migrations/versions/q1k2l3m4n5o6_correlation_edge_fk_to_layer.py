"""Migrate litho_contact_correlation_edge FK from formation_contact → litho_layer (A4 slice 4a).

Until now ``litho_contact_correlation_edge.contact_a_id / contact_b_id``
referenced ``formation_contact(id)`` with ON DELETE CASCADE. UUIDs are
identical between the two tables (the A2.5 backfill preserved them,
and the trigger pair keeps every accepted layer one-to-one with its
FC mirror), so the FK target can move to ``litho_layer(id)`` without
any data movement.

Why this matters for the eventual FC retirement (slice 4c)
----------------------------------------------------------
Once we DELETE formation_contact rows for litho models, the existing
FK-with-CASCADE on the contact tables would wipe every correlation
edge alongside the deleted contacts — exactly the data we're trying
to preserve. Pointing the FK at litho_layer first decouples the
correlation graph from the contact mirror; FC drops become free.

Cascade semantics after this migration
--------------------------------------
* ``DELETE litho_layer`` → CASCADE deletes edges referencing it
  (direct path, the new wiring).
* ``DELETE formation_contact`` → FC→LL trigger sees the deletion,
  recomputes the (model, anchor) and DELETEs any accepted LL row
  whose id is no longer in the FC set → the LL DELETE CASCADEs to
  edges. Same end result through one extra hop.

Both paths produce identical end state for the user. The trigger
chain is unchanged.

UUIDs are not re-validated by the migration — the backfill +
trigger invariants are the source of truth. If a stale edge
references an id that exists in formation_contact but not in
litho_layer (shouldn't happen given the trigger but defensive), the
ALTER would fail with an FK violation, which is preferable to
silently CASCADE-dropping the bad row.
"""

from __future__ import annotations

from alembic import op

revision = "q1k2l3m4n5o6"
down_revision = "p0j1k2l3m4n5"
branch_labels = None
depends_on = None


_FK_A_OLD = "litho_contact_correlation_edge_contact_a_id_fkey"
_FK_B_OLD = "litho_contact_correlation_edge_contact_b_id_fkey"
_FK_A_NEW = "litho_contact_correlation_edge_contact_a_id_layer_fkey"
_FK_B_NEW = "litho_contact_correlation_edge_contact_b_id_layer_fkey"


def upgrade() -> None:
    """Drop the FC-targeted FKs, add new layer-targeted FKs."""
    op.drop_constraint(_FK_A_OLD, "litho_contact_correlation_edge", type_="foreignkey")
    op.drop_constraint(_FK_B_OLD, "litho_contact_correlation_edge", type_="foreignkey")
    op.create_foreign_key(
        _FK_A_NEW,
        "litho_contact_correlation_edge",
        "litho_layer",
        ["contact_a_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        _FK_B_NEW,
        "litho_contact_correlation_edge",
        "litho_layer",
        ["contact_b_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Revert to the FC-targeted FKs."""
    op.drop_constraint(_FK_A_NEW, "litho_contact_correlation_edge", type_="foreignkey")
    op.drop_constraint(_FK_B_NEW, "litho_contact_correlation_edge", type_="foreignkey")
    op.create_foreign_key(
        _FK_A_OLD,
        "litho_contact_correlation_edge",
        "formation_contact",
        ["contact_a_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        _FK_B_OLD,
        "litho_contact_correlation_edge",
        "formation_contact",
        ["contact_b_id"],
        ["id"],
        ondelete="CASCADE",
    )
