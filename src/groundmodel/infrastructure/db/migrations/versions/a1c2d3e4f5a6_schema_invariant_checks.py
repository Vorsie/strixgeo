"""schema integrity hardening — domain invariant CHECK constraints

Revision ID: a1c2d3e4f5a6
Revises: ecc4014879af
Create Date: 2026-06-01 00:00:00.000000

Adds CHECK constraints that enforce invariants documented in CLAUDE.md
"Domain Model" and "Data Integrity Rules" but previously enforced only
at the Pydantic / application layer.  Pre-ship amnesty (CLAUDE.md
"Backwards Compatibility") allows clean schema changes without shims;
any rows that violate the new constraints are corrected inline before
the constraint lands.

Constraints added
-----------------
geological_model.kind
    ck_geological_model_kind_valid — must be one of the three
    documented values ('geological', 'lithostratigraphic',
    'geotechnical'); src: model_kind.py MODEL_KINDS.

formation_contact.source
    ck_formation_contact_source_valid — must be one of the five
    documented provenance tokens; src: contact_enums.py ContactSource.
    Note: 'pinch_out_extrapolation' rows were absorbed into body extents
    by migration ecc4014879af; the token stays in the enum for the
    rare case a legacy DB still carries one (the absorb is best-effort).

body.body_ordinal
    ck_body_ordinal_non_negative — ordinal is a 0-based index assigned
    by the resolver; a negative value indicates a write-path bug.

body.extent_left_kind / extent_right_kind
    ck_body_extent_left_kind_valid / ck_body_extent_right_kind_valid —
    when non-NULL must be one of the four tokens in extent_kind.py.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1c2d3e4f5a6"
down_revision = "ecc4014879af"
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Contact-source tokens (mirrors contact_enums.py ContactSource).
# ---------------------------------------------------------------------------
_CONTACT_SOURCE_VALUES = (
    "borehole_observation",
    "manual_pick",
    "interpolated",
    "geological_model_seed",
    "pinch_out_extrapolation",
)

# ---------------------------------------------------------------------------
# Model-kind tokens (mirrors model_kind.py MODEL_KINDS).
# ---------------------------------------------------------------------------
_MODEL_KIND_VALUES = ("geological", "lithostratigraphic", "geotechnical")

# ---------------------------------------------------------------------------
# Extent-kind tokens (mirrors extent_kind.py EXTENT_KIND_VALUES).
# ---------------------------------------------------------------------------
_EXTENT_KIND_VALUES = ("to_target", "pinch_out_halfway", "extrapolated", "open")


def upgrade() -> None:
    """Add domain-invariant CHECK constraints.

    Data-correction passes run first on the dev DB so the constraints
    land cleanly.  The integration DB is created from scratch each run
    (alembic upgrade head on a clean schema) so it never has bad data.
    """
    bind = op.get_bind()

    # ------------------------------------------------------------------
    # geological_model.kind — fix any stale / unknown values to 'geological'
    # before the CHECK lands.  Existing rows were created either with the
    # server_default ('geological') or via the application layer (Pydantic-
    # validated); the correction is just a safety net.
    # ------------------------------------------------------------------
    _model_kind_in = ", ".join(f"'{v}'" for v in _MODEL_KIND_VALUES)
    result = bind.execute(
        sa.text(
            f"UPDATE geological_model SET kind = 'geological' WHERE kind NOT IN ({_model_kind_in})"
        )
    )
    if result.rowcount:
        print(
            f"\n  [migration] corrected {result.rowcount} geological_model row(s)"
            f" with invalid kind → reset to 'geological'"
        )

    op.create_check_constraint(
        "ck_geological_model_kind_valid",
        "geological_model",
        f"kind IN ({_model_kind_in})",
    )

    # ------------------------------------------------------------------
    # formation_contact.source — fix any unknown tokens to 'manual_pick'.
    # ------------------------------------------------------------------
    _source_in = ", ".join(f"'{v}'" for v in _CONTACT_SOURCE_VALUES)
    result = bind.execute(
        sa.text(
            f"UPDATE formation_contact SET source = 'manual_pick'"
            f" WHERE source NOT IN ({_source_in})"
        )
    )
    if result.rowcount:
        print(
            f"\n  [migration] corrected {result.rowcount} formation_contact row(s)"
            f" with unknown source → reset to 'manual_pick'"
        )

    op.create_check_constraint(
        "ck_formation_contact_source_valid",
        "formation_contact",
        f"source IN ({_source_in})",
    )

    # ------------------------------------------------------------------
    # body.body_ordinal — negative ordinals are a write-path bug; clamp
    # to 0 so the NOT NULL ALTER is clean.
    # ------------------------------------------------------------------
    result = bind.execute(sa.text("UPDATE body SET body_ordinal = 0 WHERE body_ordinal < 0"))
    if result.rowcount:
        print(
            f"\n  [migration] corrected {result.rowcount} body row(s)"
            f" with negative body_ordinal → reset to 0"
        )

    op.create_check_constraint(
        "ck_body_ordinal_non_negative",
        "body",
        "body_ordinal >= 0",
    )

    # ------------------------------------------------------------------
    # body.extent_left_kind / extent_right_kind — NULL is valid (no claim);
    # when set must be a known token.
    # ------------------------------------------------------------------
    _extent_in = ", ".join(f"'{v}'" for v in _EXTENT_KIND_VALUES)

    result = bind.execute(
        sa.text(
            f"UPDATE body SET extent_left_kind = NULL"
            f" WHERE extent_left_kind IS NOT NULL"
            f"   AND extent_left_kind NOT IN ({_extent_in})"
        )
    )
    if result.rowcount:
        print(
            f"\n  [migration] cleared {result.rowcount} body row(s) with invalid extent_left_kind"
        )

    op.create_check_constraint(
        "ck_body_extent_left_kind_valid",
        "body",
        f"extent_left_kind IS NULL OR extent_left_kind IN ({_extent_in})",
    )

    result = bind.execute(
        sa.text(
            f"UPDATE body SET extent_right_kind = NULL"
            f" WHERE extent_right_kind IS NOT NULL"
            f"   AND extent_right_kind NOT IN ({_extent_in})"
        )
    )
    if result.rowcount:
        print(
            f"\n  [migration] cleared {result.rowcount} body row(s) with invalid extent_right_kind"
        )

    op.create_check_constraint(
        "ck_body_extent_right_kind_valid",
        "body",
        f"extent_right_kind IS NULL OR extent_right_kind IN ({_extent_in})",
    )


def downgrade() -> None:
    """Drop all constraints added by this migration."""
    op.drop_constraint("ck_body_extent_right_kind_valid", "body", type_="check")
    op.drop_constraint("ck_body_extent_left_kind_valid", "body", type_="check")
    op.drop_constraint("ck_body_ordinal_non_negative", "body", type_="check")
    op.drop_constraint("ck_formation_contact_source_valid", "formation_contact", type_="check")
    op.drop_constraint("ck_geological_model_kind_valid", "geological_model", type_="check")
