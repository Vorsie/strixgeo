"""ORM model for GeologicalFormation — project-scoped formation vocabulary."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


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

    # The colour the ENGINEER picked, when he picked one. NULL means "nobody
    # chose — use the automatic colour", which for a geotech unit is its NAD
    # packing colour and for every other kind is ``color`` above.
    #
    # Owner ruling 2026-08-26: "Colours on the right hand pane need to be
    # choosable if user wants", and a pick must win everywhere it shows.
    # Nullability IS the provenance here — the same shape ``body.display_color``
    # already uses, and the reason it is a second column rather than a flag on
    # ``color``: ``color`` is a DEFAULT the machine stamps (the materialiser
    # copies the source litho unit's colour at create), so a value sitting in
    # it proves nothing about intent. Comparing against the computed default
    # would be worse still: the engineer is allowed to pick exactly the
    # automatic colour, and that decision must survive a later class change.
    color_override: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # THE project's age axis — ONE convention, used everywhere:
    # LOWER display_order = OLDER, HIGHER = YOUNGER. Build's
    # ``_reorder_by_age`` derives it from per-investigation contact
    # depths (oldest -> lowest slot) and pins the anthropogenic unit
    # youngest (highest slot); the InterpretationPane / GeologyFormationList
    # draw youngest on top; the section bands + 3-D stack paint ascending
    # (older first, ``contactsLayerGeometry.ts``); and the crossing
    # validator (``GeologyValidator.validate_no_crossings``) reads it as
    # the older/younger axis. Any consumer that needs "which is older"
    # MUST use this sign — never a surface's mean elevation, which
    # disagrees wherever two formations' footprints span different
    # ground (a dredged site inverts it). Ties are tolerated and broken
    # by name in the UI.
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

    # Geotech-stage dual-reference columns (spec §3 explicit identity tuple) ----
    # The litho formation this geotech unit subdivides.  ON DELETE SET NULL —
    # removing the litho parent demotes the unit to unlinked rather than
    # cascading.  NULL on geological- and litho-model rows.
    source_litho_formation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The geological formation the unit sits within.  Paleogene vs Quaternary
    # clay carry different parameters, so the geo-ancestry is first-class
    # stored rather than derived transitively through the litho parent.
    # ON DELETE SET NULL — same policy as the other self-FKs.  NULL on
    # geological- and litho-model rows.
    source_geo_formation_id: Mapped[UUID | None] = mapped_column(
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
    litho_admixtures: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    # The engineer's NAD-family answer for a litho unit whose admixture the NAD
    # table can express as either a pure or a with-admixture class (owner ruling
    # 2026-09-04). 'pure' → classify into the clean NAD column; 'with_admixture'
    # → the secondary (silt-/klei- or zandhoudend) column; NULL → not answered,
    # so the classifier decides from the admixtures (today's behaviour). Only
    # meaningful on a litho unit; NULL everywhere else.
    nad_admixture_choice: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        lazy=RELATIONSHIP_LAZY,
    )

    # Layer rows for the unified litho boundary model (see
    # docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md).
    # Same load policy as ``contacts``: no eager load by default;
    # callers selectinload when they need them.
    litho_layers: Mapped[list[LithoLayerOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LithoLayerOrm",
        back_populates="formation",
        cascade="all, delete-orphan",
        lazy=RELATIONSHIP_LAZY,
    )
