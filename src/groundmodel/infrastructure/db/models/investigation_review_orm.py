"""ORM model for InvestigationReview — per-(project, investigation) decisions."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class InvestigationReviewOrm(Base):
    """Persisted per-(project, investigation) decision row.

    Polymorphic anchor (``target_kind`` + ``target_id``) so one table
    holds decisions for both CPT- and borehole-anchored investigations.
    A future decision field (correlation confidence, contact-placement
    hint, …) is one column added here, not two columns mirrored across
    the cpt and borehole tables.

    Rows exist only where a decision has been made. The absence of a
    row means "unreviewed, not hidden" — keeps the table small in
    projects with thousands of investigations where most haven't been
    touched yet.

    The polymorphic FK isn't DB-enforced — same trade-off
    ``FormationContactOrm`` makes for its borehole/CPT split. API-layer
    validation guarantees the target row exists at write time.

    Lives in the .gmproj bundle alongside cross-sections and the
    geological model; rehydrates on restore so a wiped DB doesn't lose
    the engineer's review history.
    """

    __tablename__ = "investigation_review"
    __table_args__ = (
        UniqueConstraint("target_kind", "target_id", name="uq_investigation_review_target"),
        CheckConstraint(
            "target_kind IN ('cpt', 'borehole')",
            name="investigation_review_target_kind_chk",
        ),
        CheckConstraint(
            "review_status IN ('unreviewed', 'in_progress', 'reviewed')",
            name="investigation_review_status_chk",
        ),
        Index("idx_investigation_review_app_project_id", "app_project_id"),
        Index("idx_investigation_review_target", "target_kind", "target_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Polymorphic anchor. ``target_kind`` discriminates between the cpt
    # and borehole tables; ``target_id`` is the row's id over there. No
    # DB-side FK — API-layer validation handles existence checks.
    target_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Workflow status. Plain VARCHAR so adding a new state is an
    # application-side change, not an ALTER TYPE. Allowed values are
    # enforced by the CHECK constraint above and by the Pydantic
    # schema at the API boundary.
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unreviewed")
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stamped when the row transitions to 'reviewed'; re-NULLed if the
    # engineer moves it back to an earlier state. Driven by app code,
    # not a trigger, to keep the migration boring.
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Project-local hide. Replaces the pre-bundle localStorage
    # `groundmodel.removed.{projectId}.*` set. Still a soft hide — no
    # DB DELETE on the underlying investigation, so a future re-import
    # doesn't refetch.
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
