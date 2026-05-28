"""backfill litho formation colors from grey placeholder

Revision ID: 11878f8a5732
Revises: 8a334dc40024
Create Date: 2026-05-28 15:08:10.012156

Backfill (#145): litho formation rows created before the colour-at-create
fix carry the neutral-grey placeholder ``#9ca3af`` instead of their
lithology colour.  Stamp the correct colour onto every such row from its
``litho_main_soil_code`` so read-side consumers (section bands, 3D viewer,
exports, .gmproj bundle) get the right colour from the stored value
without a presentation-layer override.

Only rows that BOTH carry the grey placeholder AND have a recognised
``litho_main_soil_code`` are touched — geological formations (no soil
code) keep their user-chosen colour, and a row whose soil code is not one
of the five base lithologies is left at grey (matches the create-time
fallback).
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "11878f8a5732"
down_revision = "8a334dc40024"
branch_labels = None
depends_on = None

#: Base-lithology → display colour.  Kept literal here (not imported from
#: ``shared.constants.litho_constants``) so the migration is frozen at the
#: values current when it was authored — a later edit to the constant must
#: not retroactively change what this migration did.  Must match
#: ``LITHOLOGY_COLORS`` at authoring time.
_LITHOLOGY_COLORS = {
    "GRIND": "#d97706",
    "ZAND": "#fbbf24",
    "SILT": "#84cc16",
    "KLEI": "#6b7280",
    "VEEN": "#92400e",
}

_GREY_PLACEHOLDER = "#9ca3af"


def upgrade() -> None:
    """Stamp the lithology colour onto grey-placeholder litho formation rows."""
    for soil_code, color in _LITHOLOGY_COLORS.items():
        op.execute(
            f"""
            UPDATE geological_formation
            SET color = '{color}'
            WHERE color = '{_GREY_PLACEHOLDER}'
              AND litho_main_soil_code = '{soil_code}'
            """
        )


def downgrade() -> None:
    """Revert backfilled litho colours to the grey placeholder.

    Only rows whose current colour still matches the backfilled lithology
    colour AND that carry the matching soil code are reverted — a colour the
    user has since changed by hand is left alone.
    """
    for soil_code, color in _LITHOLOGY_COLORS.items():
        op.execute(
            f"""
            UPDATE geological_formation
            SET color = '{_GREY_PLACEHOLDER}'
            WHERE color = '{color}'
              AND litho_main_soil_code = '{soil_code}'
            """
        )
