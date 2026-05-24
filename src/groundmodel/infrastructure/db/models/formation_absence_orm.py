"""ORM model for FormationAbsence — investigation-level absence record (#101 Position 4)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class FormationAbsenceOrm(Base):
    """Persisted FormationAbsence — positive evidence that an investigation lacks a formation body.

    Records that a given investigation (borehole or CPT) shows evidence of
    ABSENCE for a particular formation's body at that investigation's location
    and depth.  The ``source`` column distinguishes automatically inferred
    absences from user-confirmed or user-overridden ones.

    Relationship to lens bodies
    ---------------------------
    An absence is scoped to a FORMATION, not to a specific lens metadata row.
    Which body (body_ordinal) is absent at a given investigation is determined
    at query time by the correlation-graph resolver — it is not stored here.
    This avoids redundancy and allows absences to remain valid even when the
    user renames or removes a ``LithoLensOrm`` metadata row.

    Source enum
    -----------
    ``'inferred'`` — written by the inference engine based on observation-layer
        data showing a different lithology at the body's depth range.  May be
        retracted and re-written as the correlation graph changes.
    ``'manual'`` — the user confirmed (or created) this absence explicitly.
        The inference engine never deletes or overwrites ``'manual'`` rows.
    ``'observed'`` — the user marked this absence as directly observed in the
        field data (highest confidence; also preserved by the inference engine).
    Phase 5+ extensions (fault / unconformity / erosion) will add tokens to
    the CHECK in a new migration.

    Polymorphic investigation reference
    ------------------------------------
    ``investigation_id`` is a raw UUID; there is no abstract investigations
    table.  ``investigation_kind`` discriminates which concrete table owns
    the id.  The use-case layer validates the id against the correct table
    before inserting.

    Cascade semantics
    -----------------
    ``formation_id`` → CASCADE: deleting the formation evaporates all of its
    absence records.  An absence without a formation has no meaning.

    Uniqueness
    ----------
    UNIQUE on ``(formation_id, investigation_kind, investigation_id)`` — a
    formation can have at most one absence record per investigation.  The
    source may be updated via UPSERT without violating the constraint.

    No SQLAlchemy relationship objects
    -----------------------------------
    FK columns only — no ``relationship()`` objects.  Consistent with
    ``LithoLensOrm`` and ``LithoCorrelationEdgeOrm``.
    """

    __tablename__ = "formation_absence"
    __table_args__ = (
        # 'inferred' | 'manual' | 'observed' are the v1.0 sources.
        # Phase 5+ extensions add tokens here in a new migration.
        CheckConstraint(
            "source IN ('inferred', 'manual', 'observed')",
            name="ck_formation_absence_source",
        ),
        # Only 'borehole' and 'cpt' are valid kinds for the Phase-4 MVP.
        CheckConstraint(
            "investigation_kind IN ('borehole', 'cpt')",
            name="ck_formation_absence_investigation_kind",
        ),
        # One absence record per (formation, kind, investigation) triple.
        # Prevents double-declaring the same investigation absent for the
        # same formation.
        UniqueConstraint(
            "formation_id",
            "investigation_kind",
            "investigation_id",
            name="uq_formation_absence_formation_investigation",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to geological_formation.  CASCADE — deleting the formation evaporates
    # all of its absence records atomically.
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic investigation reference.  No FK — the kind discriminator
    # determines the concrete table; the use-case layer validates the id.
    investigation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
    )

    # Discriminator: 'borehole' or 'cpt'.  Constrained by CHECK above.
    investigation_kind: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )

    # Source: who wrote this absence record.  See class docstring.
    source: Mapped[str] = mapped_column(String(20), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
