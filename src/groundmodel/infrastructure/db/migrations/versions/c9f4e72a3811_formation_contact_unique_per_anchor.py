"""partial unique indexes on formation_contact per (model, formation, anchor)

Revision ID: c9f4e72a3811
Revises: b8e3f1c4a720
Create Date: 2026-05-14 16:55:00.000000

Enforces the "one formation top per investigation" invariant at the
DB layer. Previously enforced only at the application layer
(see ``CreateFormationContact.execute``), which races under
parallel POSTs — copying contacts from multiple sources onto one
target fired N parallel ``createContact`` calls, each transaction
saw "no existing" simultaneously, and all of them inserted.
Outcome: duplicate ``manual_pick`` rows per
(model, formation, anchor) triple and ``MultipleResultsFound``
errors on the next single-contact create.

The XOR anchor pair (borehole_id NULL OR cpt_id NULL — never both)
prevents a single full unique index, so we ship two partial
unique indexes — one per anchor flavour — that fire only when the
relevant column is non-null.

Pre-migration cleanup: the duplicate rows were removed by the
in-app "Dedupe contacts" action before this migration ran. If any
project's DB still carries duplicates, the migration will fail
with a unique-violation; the recovery is to run dedupe in the UI
(or DELETE the duplicates manually) and re-run ``alembic upgrade``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f4e72a3811"
down_revision: str | None = "b8e3f1c4a720"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the two partial unique indexes."""
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


def downgrade() -> None:
    """Drop the two partial unique indexes."""
    op.drop_index(
        "uq_formation_contact_model_formation_cpt",
        table_name="formation_contact",
    )
    op.drop_index(
        "uq_formation_contact_model_formation_borehole",
        table_name="formation_contact",
    )
