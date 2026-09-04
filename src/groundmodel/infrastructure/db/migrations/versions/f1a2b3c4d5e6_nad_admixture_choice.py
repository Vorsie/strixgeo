"""geological_formation — add nad_admixture_choice (admixture NAD prompt).

Revision ID: f1a2b3c4d5e6
Revises: c6d7e8f9a0b1
Create Date: 2026-09-04 02:00:00.000000

Owner ruling 2026-09-04: at geotech subdivide the engineer is prompted, for a
litho unit whose admixture the NAD table can express either way, whether to
classify it into the PURE class family or the WITH-ADMIXTURE ((f)/(s)) family.
The answer is persisted here so a re-divide does not re-ask and the classifier
honours it.

* ``nad_admixture_choice`` — TEXT, nullable. ``'pure'`` → classify into the
  clean NAD column; ``'with_admixture'`` → the secondary (silt-/klei- or
  zandhoudend) column; NULL → not answered, so the classifier keeps its
  auto-from-admixtures behaviour. Only meaningful on a litho unit; NULL
  everywhere else.

Plain additive column — backwards compatibility is SUSPENDED pre-ship
(``docs/backwards-compat.md``), and an existing project reads back NULL
(today's behaviour) until the engineer answers the prompt.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None

_TABLE = "geological_formation"
_COLUMN = "nad_admixture_choice"


def upgrade() -> None:
    """Add the nullable ``nad_admixture_choice`` column."""
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    """Drop the ``nad_admixture_choice`` column."""
    op.drop_column(_TABLE, _COLUMN)
