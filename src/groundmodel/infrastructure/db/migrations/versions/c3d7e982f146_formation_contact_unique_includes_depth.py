"""formation_contact unique constraint now includes depth_top_m

Revision ID: c3d7e982f146
Revises: e3f4a5b6c7d8
Create Date: 2026-05-20 15:30:00.000000

The previous partial unique indexes
(``uq_formation_contact_model_formation_borehole`` /
``uq_formation_contact_model_formation_cpt``, migration ``c9f4e72a3811``)
enforced "one contact per (model, formation, anchor)". That invariant
fits the GEOLOGICAL model — typically one Boom Klei top per borehole —
but breaks for the LITHOSTRATIGRAPHIC model where multiple Sand layers
at different depths on the same CPT all map to one "ZAND" formation
row (the Phase-2 instance design uses a single formation per
(parent, soil, admix-signature); ordinals distinguish instances post-
hoc via correlation edges). Accepting a second same-lithology
suggestion then hit the unique constraint and surfaced as a red "Could
not accept" toast in the dogfeed (image #20 / 2026-05-20).

Widening the unique key to ``(model_id, formation_id, anchor, depth_top_m)``
allows multiple distinct-depth contacts while still catching exact
duplicates (the idempotent re-accept path in ``_find_or_create_contact``
relies on (model, formation, anchor, depth_top_m) for its lookup; the
new index matches that exactly).

Geological-side invariant ("one Boom Klei top per borehole") stays
enforced in the application layer via ``CreateFormationContact``'s
DuplicateContactError pre-check + race-loser re-query, which already
exists and is the canonical guard for geo.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d7e982f146"
down_revision: str | None = "e3f4a5b6c7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace the (model, formation, anchor) indexes with versions that include depth_top_m.

    The DROP uses ``IF EXISTS`` because the prior migration's two indexes
    are sometimes only partially present on older / freshly-initialised
    DBs (observed on the integration DB which had the cpt index but
    not the borehole one). Tolerant of either prior state.
    """
    op.execute("DROP INDEX IF EXISTS uq_formation_contact_model_formation_cpt")
    op.execute("DROP INDEX IF EXISTS uq_formation_contact_model_formation_borehole")
    op.create_index(
        "uq_formation_contact_model_formation_borehole_depth",
        "formation_contact",
        ["model_id", "formation_id", "borehole_id", "depth_top_m"],
        unique=True,
        postgresql_where=sa.text("borehole_id IS NOT NULL"),
    )
    op.create_index(
        "uq_formation_contact_model_formation_cpt_depth",
        "formation_contact",
        ["model_id", "formation_id", "cpt_id", "depth_top_m"],
        unique=True,
        postgresql_where=sa.text("cpt_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Restore the (model, formation, anchor)-only partial unique indexes.

    Downgrade requires no duplicate-depth rows to exist for the same
    (model, formation, anchor) — otherwise the old constraint fails. In a
    pre-ship environment (backwards-compat suspended) the failure mode is
    acceptable; in production this downgrade would need a dedupe pass first.
    """
    op.drop_index(
        "uq_formation_contact_model_formation_cpt_depth",
        table_name="formation_contact",
    )
    op.drop_index(
        "uq_formation_contact_model_formation_borehole_depth",
        table_name="formation_contact",
    )
    op.create_index(
        "uq_formation_contact_model_formation_borehole",
        "formation_contact",
        ["model_id", "formation_id", "borehole_id"],
        unique=True,
        postgresql_where=sa.text("borehole_id IS NOT NULL"),
    )
    op.create_index(
        "uq_formation_contact_model_formation_cpt",
        "formation_contact",
        ["model_id", "formation_id", "cpt_id"],
        unique=True,
        postgresql_where=sa.text("cpt_id IS NOT NULL"),
    )
