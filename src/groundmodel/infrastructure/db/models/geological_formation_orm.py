"""ORM model for GeologicalFormation — project-scoped formation vocabulary."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base


class GeologicalFormationOrm(Base):
    """Persisted GeologicalFormation — a project's substrate vocabulary entry.

    A formation is the primary modelling unit (Boom Klei, Diest Zand,
    Quaternary deposits, ...). Each project carries its own list — the
    same formation name in two different projects is two separate rows.
    A future SaaS layer might normalise this into a shared catalogue,
    but at v1 we keep the data fully self-contained per project so
    .gmproj bundles stay round-trippable.

    Companion tables:
    * ``GeologicalModelOrm`` — the interpretation container that
      references formations through FormationContact.
    * ``FormationContactOrm`` — anchored data points (formation top at
      a specific investigation).
    """

    __tablename__ = "geological_formation"
    __table_args__ = (
        Index("idx_geological_formation_app_project_id", "app_project_id"),
        # Composite index for the Accept find-or-create key lookup (litho builder).
        Index(
            "idx_geological_formation_litho_lookup",
            "app_project_id",
            "parent_formation_id",
            "litho_main_soil_code",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # App-level scope — plain UUID column with no FK, matching the
    # convention used by CptOrm / BoreholeOrm. Lifetimes are decoupled.
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Hex string ("#aabbcc"). Defaulted at the API layer so the column
    # can be NOT NULL without forcing every test fixture to set it.
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    # Top-to-bottom hint for the legend / borelog ordering. Ties are
    # tolerated and broken by name in the UI.
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Debt #35: when True, the user has manually drag-reordered this
    # formation and Build's age-inference (``_reorder_by_age``) MUST
    # leave its ``display_order`` untouched. Set by the drag-end PATCH.
    # Default False so seeded / auto-populated formations still get the
    # data-driven ordering they benefit from.
    pinned_order: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Opaque pointer to whatever public source seeded this formation
    # (G3Dv3 formation id in Flanders, BRO-NL DGM unit code, etc.).
    # Free-text so adding a new source needs no migration.
    regional_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Three-level hierarchy unit attributes (the geological_formation
    # table is shared across all model kinds). NULL for a
    # geological-model formation (Boom Klei has no single lithology).
    # ``lithology`` = GRIND/ZAND/SILT/KLEI/VEEN (+ admixture, slice 2
    # vocabulary). ``nad_class`` = Belgian NAD class 1..31 for a
    # geotechnical-model unit; the per-class parameter values
    # (γ/φ′/c′/cu/m) are the Phase-5 Scilab/xlsx port, not stored here
    # yet — the class number is the future join key.
    lithology: Mapped[str | None] = mapped_column(String(20), nullable=True)
    nad_class: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Litho-builder Phase 1 columns ----------------------------------------
    # Self-FK: a litho/geotech unit points at its parent geological formation.
    # ON DELETE SET NULL — deleting a geological formation degrades the litho
    # unit to parentless rather than cascading.  NULL on geological-model rows
    # (they are the parent, not the child).
    parent_formation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Debt #87: True when ``parent_formation_id`` was inferred from TIN
    # extrapolation rather than from a geology contact at the investigation
    # the litho unit was created on.  The LithologyInspector renders an
    # amber dot + "extrapolated" tooltip on flagged units and offers a
    # confirm/reassign/detach dialog.  False on contact-based assignments
    # and on geological-model rows (no parent to infer).
    parent_extrapolated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # BaseLithology token (ZAND/KLEI/SILT/GRIND/VEEN). NULL on geological rows.
    litho_main_soil_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ordered admixture list: [{"soil_code": str, "amount": str, "locally": bool}].
    # NULL on geological rows; [] on a litho unit with no admixtures.
    litho_admixtures: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Phase 2: ordinal for same-composition instances within a parent formation.
    # NULL throughout Phase 1 — Accept leaves it unassigned.
    # Phase 2: assigned by resolve_litho_instances from the correlation
    # edge graph. PROVENANCE (Data Integrity Rule §1): this is a DERIVED
    # value, not a measurement. It IS serialised into the .gmproj bundle
    # and restored verbatim, but it remains fully recomputable from the
    # edge graph by re-running the resolver — UNLESS instance_ordinal_locked
    # is True (then it is a user decision the resolver must preserve). A
    # caller that runs the resolver mid-restore (before edges are restored)
    # would transiently reset non-locked ordinals; restore is atomic today
    # so this cannot happen, but keep that ordering invariant if the
    # restore path is ever refactored (Phase-2 span audit should-fix).
    instance_ordinal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # True when the user has locked the ordinal; Phase 2 auto-resolver skips it.
    instance_ordinal_locked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Reverse relationship for cascade discovery + bundle serialisation.
    # No load by default; callers selectinload explicitly when they need
    # the contacts (typically the editor and the bundle exporter).
    contacts: Mapped[list[FormationContactOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "FormationContactOrm",
        back_populates="formation",
        cascade="all, delete-orphan",
    )

    # Geotechnical units beneath this formation. Same pattern as contacts —
    # no eager load by default; ORM-level cascade keeps SQLAlchemy's
    # identity map in sync when the parent formation is deleted (the DB
    # CASCADE alone leaves stale references in the session).
    units: Mapped[list[GeotechnicalUnitOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "GeotechnicalUnitOrm",
        cascade="all, delete-orphan",
    )
