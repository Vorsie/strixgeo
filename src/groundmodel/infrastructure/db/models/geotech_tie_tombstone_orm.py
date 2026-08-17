"""ORM model for GeotechTieTombstone — a packing tie the engineer deleted."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class GeotechTieTombstoneOrm(Base):
    """One packing correlation the engineer deleted, remembered by WHERE it was.

    Owner rulings, 2026-08-17: *"A tie i delete stays deleted but does not
    delete on the litho model"*, keyed *"just do position xyz left and xyz
    right and the section it was on"*.

    Why position and not the rows the tie joined: the packing bands are
    rebuilt by pipeline steps 1 and 4 — new rows, new ids — so a tombstone
    naming band ids stops matching at the first re-derivation and the deleted
    tie returns, which is the loop he met twice.  The PLACE survives the
    rebuild: x/y are the investigation's map position (a test does not move)
    and z is the contact's ELEVATION, so the key also survives a collar
    correction.

    Written by :class:`~groundmodel.application.correlate_litho_contacts.UncorrelateLithoContacts`
    for geotechnical models only — a tombstone records the ENGINEER's
    judgement.  The machine's own housekeeping (the crossing sweep, jump-tie
    supersession) deletes directly and leaves no tombstone, so a swept tie the
    derivation still believes may legitimately return.  Consulted by
    ``derive_geotech_edges_from_litho`` before every emit; matching lives in
    the pure :mod:`~groundmodel.domain.services.geotech_tie_tombstone`.

    Deliberately no unique constraint: two tombstones covering the same place
    are harmless (the match is a scan, not a lookup), and depths are floats a
    re-derivation nudges — equality was never the identity.
    """

    __tablename__ = "geotech_tie_tombstone"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # ON DELETE CASCADE: deleting the geotech model (a re-subdivide from
    # scratch, a stage wipe) takes the engineer's deletions with it — a fresh
    # model is a fresh set of machine claims for him to judge.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Correlations are section-scoped — "and the section it was on". A
    # deletion on one section says nothing about another.
    section_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cross_section.id", ondelete="CASCADE"),
        nullable=False,
    )

    # End A: map position (project CRS) + contact elevation. Which physical
    # end is "a" is arbitrary; the matcher is order-independent.
    a_x: Mapped[float] = mapped_column(Float, nullable=False)
    a_y: Mapped[float] = mapped_column(Float, nullable=False)
    a_z: Mapped[float] = mapped_column(Float, nullable=False)

    # End B.
    b_x: Mapped[float] = mapped_column(Float, nullable=False)
    b_y: Mapped[float] = mapped_column(Float, nullable=False)
    b_z: Mapped[float] = mapped_column(Float, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
