"""ORM model for FormationContact — formation top observed at an investigation."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class FormationContactOrm(Base):
    """Persisted FormationContact — "this formation tops out at depth X at this investigation".

    The primary data point of the geological model. Three anchor flavours:

    * **borehole** (``borehole_id IS NOT NULL``) — the primary v1 path.
    * **cpt** (``cpt_id IS NOT NULL``) — reserved for Phase 5 Robertson Ic.
    * **synthetic** (all three ``synthetic_*`` columns non-null) — a purely
      modelled point with no physical investigation anchor, created by the
      pinch-out extrapolation tool. The (x, y) are absolute project-CRS
      coordinates and ``synthetic_elevation_m`` is the absolute elevation (m
      above datum), already accounting for depth — the TIN compute uses these
      directly instead of ``anchor.elevation_m - depth_top_m``.

    Exactly ONE of the three flavours is present (DB CHECK enforces it).

    The "no gaps" rule (a borehole's contacts must form a contiguous
    depth coverage from surface down to test depth) is NOT a hard DB
    constraint. It runs as a domain validation on save: hard
    constraints would fight legitimate edits where, mid-flow, a new
    contact temporarily overlaps with an existing one.

    Provenance columns (``observation_id`` / ``observation_layer_id``)
    are nullable + SET-NULL-on-delete. A contact survives a reshuffle
    of its source observation while losing the back-link; the depth
    value stands on its own.
    """

    __tablename__ = "formation_contact"
    __table_args__ = (
        # Three-term anchor rule: exactly one of (borehole, cpt, synthetic)
        # present. Phrased as ``sum == 1`` so a future fourth anchor is one
        # extra term. Migration c0d1e2f3a4b5 dropped the old 2-term CHECK and
        # added this one; keep them in sync if the model changes.
        CheckConstraint(
            "(CASE WHEN borehole_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN cpt_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN synthetic_x IS NOT NULL"
            "       AND synthetic_y IS NOT NULL"
            "       AND synthetic_elevation_m IS NOT NULL THEN 1 ELSE 0 END)"
            " = 1",
            name="formation_contact_anchor_xor",
        ),
        Index("idx_formation_contact_model_borehole", "model_id", "borehole_id"),
        # CPT-anchor fast lookup — mirrors idx_formation_contact_model_borehole for CPT
        # anchors. Created by migration u5v6w7x8y9z0; declared here so SQLAlchemy's
        # autogenerate does not emit a spurious DROP on the next ``alembic revision``.
        Index("idx_formation_contact_model_cpt", "model_id", "cpt_id"),
        Index("idx_formation_contact_model_formation", "model_id", "formation_id"),
        # Partial unique indexes enforce "no exact-duplicate contacts"
        # at the DB layer — same (model, formation, anchor, depth) cannot
        # appear twice. Includes depth_top_m so multiple distinct-depth
        # contacts on the same (model, formation, anchor) ARE allowed —
        # the litho-model use case needs this (e.g. multiple Sand layers
        # at different depths on the same CPT all map to one "ZAND"
        # formation per the Phase-2 instance design). Migration
        # ``c3d7e982f146`` widened the key from (model, formation,
        # anchor) to (model, formation, anchor, depth_top_m).
        #
        # The geological-side "one Boom Klei top per borehole" invariant
        # is still enforced — application-layer in
        # ``CreateFormationContact`` (DuplicateContactError pre-check +
        # race-loser re-query). The widened DB index remains the safety
        # net for exact duplicates (re-accept idempotency relies on it).
        Index(
            "uq_formation_contact_model_formation_borehole_depth",
            "model_id",
            "formation_id",
            "borehole_id",
            "depth_top_m",
            unique=True,
            postgresql_where=text("borehole_id IS NOT NULL"),
        ),
        Index(
            "uq_formation_contact_model_formation_cpt_depth",
            "model_id",
            "formation_id",
            "cpt_id",
            "depth_top_m",
            unique=True,
            postgresql_where=text("cpt_id IS NOT NULL"),
        ),
        Index("idx_formation_contact_parent_geo", "parent_geo_contact_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # CASCADE on both parents — a deleted model / formation evaporates
    # its contacts. The data has no meaning without the parent.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )

    # XOR anchor pair. CASCADE delete so a vanished investigation
    # doesn't leave dangling contacts.
    borehole_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borehole.id", ondelete="CASCADE"),
        nullable=True,
    )
    cpt_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cpt.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Synthetic anchor — used by the pinch-out extrapolation tool. When
    # all three are non-null there is no physical investigation; (x, y) are
    # absolute project-CRS coordinates and elevation_m is the absolute
    # elevation at the tip (NOT a depth — the TIN uses it directly).
    # All three must be NULL (borehole/CPT path) or all non-null (synthetic
    # path) — the DB CHECK enforces it.
    synthetic_x: Mapped[float | None] = mapped_column(Double, nullable=True)
    synthetic_y: Mapped[float | None] = mapped_column(Double, nullable=True)
    synthetic_elevation_m: Mapped[float | None] = mapped_column(Double, nullable=True)

    # Depth of the formation top at this investigation, positive
    # downwards from surface (consistent with every other depth column
    # in the schema — see CLAUDE.md "Domain Model").
    #
    # SYNTHETIC-CONTACT EXCEPTION: for pinch-out contacts (borehole_id IS
    # NULL, cpt_id IS NULL, synthetic_x IS NOT NULL — source
    # 'pinch_out_extrapolation') this column has NO physical meaning: the
    # absolute tip elevation is carried in ``synthetic_elevation_m``. A
    # sentinel ``0.0`` is stored only to satisfy this NOT NULL constraint;
    # RecomputeFormationSurface's synthetic branch ignores depth_top_m
    # entirely for those rows.
    depth_top_m: Mapped[float] = mapped_column(Double, nullable=False)

    # Provenance: 'borehole_observation' / 'manual_pick' / 'interpolated'.
    # Plain VARCHAR — enum migrations are pain and the value set is
    # small. Validation lives at the Pydantic layer.
    source: Mapped[str] = mapped_column(String(30), nullable=False)

    # Optional links to the observation that drove this contact. SET
    # NULL on parent delete so the contact survives a reshuffle while
    # losing its back-link.
    observation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation.id", ondelete="SET NULL"),
        nullable=True,
    )
    observation_layer_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("observation_layer.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Litho↔geo coupling (#162). Set on a LITHOSTRATIGRAPHIC contact,
    # pointing at the GEOLOGICAL contact it is the same physical surface
    # as. SET NULL on delete → deleting the geo contact auto-unlinks its
    # litho children at the DB layer (the unlink lifecycle is free).
    # NULL = not coupled. Self-referential FK (both rows live in
    # formation_contact).
    parent_geo_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 'high' / 'medium' / 'low'. Same VARCHAR rationale as source.
    confidence: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    model: Mapped[GeologicalModelOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeologicalModelOrm", back_populates="contacts", lazy=RELATIONSHIP_LAZY
    )
    formation: Mapped[GeologicalFormationOrm] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeologicalFormationOrm", back_populates="contacts", lazy=RELATIONSHIP_LAZY
    )
