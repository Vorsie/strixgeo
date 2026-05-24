"""ORM model for LithoLensAbsence — investigation-level absence join (#101 Slice 2)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoLensAbsenceOrm(Base):
    """Persisted LithoLensAbsence — one absent investigation for a lens body.

    Records that a given investigation (borehole or CPT) shows positive
    evidence of ABSENCE for a particular litho lens at the depth range
    that lens occupies.

    Polymorphic reference
    ---------------------
    ``investigation_id`` is a raw UUID; there is no abstract
    investigations table to point an FK at.  ``investigation_kind``
    discriminates which concrete table (``borehole`` or ``cpt``) owns
    the id.  The use-case layer is responsible for cross-referencing
    against the correct table before creating an absence record — the DB
    does not enforce referential integrity on this column (no FK).

    Cascade semantics
    -----------------
    ``ON DELETE CASCADE`` on ``lens_id`` — deleting the lens evaporates
    all of its absence records atomically without requiring the
    application to enumerate and delete them first.

    Uniqueness
    ----------
    A lens can declare the same (kind, investigation) absent at most
    once.  The UNIQUE constraint on ``(lens_id, investigation_kind,
    investigation_id)`` blocks duplicates at the DB layer; the use case
    ignores ``UniqueViolation`` on idempotent re-submission.

    No SQLAlchemy relationship objects
    -----------------------------------
    FK columns only — no ``relationship()`` objects.  Consistent with
    ``LithoLensOrm`` and ``LithoCorrelationEdgeOrm``.  Every load goes
    through an explicit ``select()`` in the use-case layer.
    """

    __tablename__ = "litho_lens_absence"
    __table_args__ = (
        # Only 'borehole' and 'cpt' are valid kinds for the Phase-4 MVP.
        # Future kinds (DMT, pressuremeter) extend the CHECK in a new
        # migration.
        CheckConstraint(
            "investigation_kind IN ('borehole', 'cpt')",
            name="ck_litho_lens_absence_investigation_kind",
        ),
        # One absence record per (lens, kind, investigation) triple.
        # Prevents double-declaring the same investigation absent.
        UniqueConstraint(
            "lens_id",
            "investigation_kind",
            "investigation_id",
            name="uq_litho_lens_absence_lens_investigation",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to litho_lens. ON DELETE CASCADE — deleting the lens evaporates
    # all of its absence records atomically.
    lens_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_lens.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic investigation reference. No FK — the kind discriminator
    # determines the concrete table; the use-case layer validates the id
    # before insertion.
    investigation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )

    # Discriminator: 'borehole' or 'cpt'. Constrained by CHECK above.
    investigation_kind: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
