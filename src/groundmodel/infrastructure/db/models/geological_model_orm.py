"""ORM model for GeologicalModel — one interpretation of a project's geology."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.orm_relationship_constants import RELATIONSHIP_LAZY


class GeologicalModelOrm(Base):
    """Persisted GeologicalModel — an interpretation container.

    A project can carry multiple alternative interpretations (e.g.
    "Main" vs "Alternative — Boom Klei dips north"); one is flagged
    active and is the one the cross-section view renders by default.
    Formations are shared across models at the project level (the same
    Boom Klei row is referenced from any number of models via
    FormationContact); the model owns only the *assignment* of
    formation tops at investigations.

    ``excluded_borehole_ids`` is the inverted-scope column: empty
    means every project borehole contributes to this model; explicit
    ids carve out exclusions. The default ("include everything") plays
    well with mid-project workflows where new boreholes get imported
    after the model already exists.
    """

    __tablename__ = "geological_model"
    __table_args__ = (Index("idx_geological_model_app_project_id", "app_project_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    app_project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Active flag is a UI-visibility hint, not a DB-enforced uniqueness.
    # The desktop client guards "only one active per project" but legacy
    # / transitional states are tolerated by the schema.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ARRAY of borehole ids excluded from this model's scope. Empty =
    # all project boreholes contribute. Stored as a Postgres ARRAY for
    # cheap membership lookup; a junction table would be more normal
    # but adds joins for negligible value at v1's scale.
    excluded_borehole_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PG_UUID(as_uuid=True)), nullable=False, default=list
    )

    # Three-level hierarchy discriminator (CLAUDE.md "Modelling
    # hierarchy"): 'geological' (backbone, default) |
    # 'lithostratigraphic' | 'geotechnical'. Plain VARCHAR + app-layer
    # validation (same pattern as source/confidence/method). Gates the
    # crossing validator, Build's auto-age reorder, and is_active
    # scoping — see shared/constants/model_kind.py.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="geological")

    # Self-FK: a lithostratigraphic model REFINES a geological model;
    # a geotechnical model refines a lithostratigraphic one. NULL only
    # for geological models (no parent). ON DELETE RESTRICT — the
    # parent cannot be deleted while a child references it (API → 409).
    # "Not optional for litho/geotech" is enforced at creation
    # (REQUIRED_PARENT_KIND), not by DB NOT NULL, because geological
    # models legitimately share this nullable column with no parent.
    parent_model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="RESTRICT"),
        nullable=True,
    )

    # Representative qc statistic pair (owner rulings 7+8, docs/debt.md #227).
    # ``representative_statistic`` is the per-model CHOICE the NAD classifier
    # and every band-edit preview read ('median' | 'arithmetic' | 'harmonic'
    # | 'geometric'); ``classified_with_statistic`` is what the last full
    # "Subdivide all bodies" actually classified with (stamped by the build,
    # NULL until a first build). Staleness is DERIVED, never stored:
    # classified != representative means the bands need a re-subdivide under
    # the new choice — the #266 compare-on-load pattern, so it self-clears
    # and needs no clear-endpoint. Inert for non-geotechnical kinds (the
    # shared-nullable philosophy of parent_model_id above). Changing the
    # choice NEVER silently re-derives bands (ruling 8).
    representative_statistic: Mapped[str] = mapped_column(
        String(16), nullable=False, default="median", server_default="median"
    )
    classified_with_statistic: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Per-column litho provenance (docs/debt.md #266). ``{column_id: digest}``
    # for every column carrying geotech bands: the digest of the PARENT litho
    # model's stack under that column at the moment those bands were built.
    # Staleness is DERIVED the same way the statistic pair above derives it —
    # recompute today's digest, compare — so it self-clears on the next press.
    # Per COLUMN because CPT and borehole bands come from two different presses
    # that each honour skip_existing: a model legitimately holds columns built
    # from different litho revisions, and a model-level stamp would let a
    # borehole press clear the flag on a moved CPT column.
    # NULL / missing key = unknown provenance = NOT stale; see the migration
    # e7f8a9b0c1d2 for why there is no backfill. Inert for non-geotechnical
    # kinds (the shared-nullable philosophy of parent_model_id above).
    derived_from_litho_digests: Mapped[dict[str, str] | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Reverse relationship — used by the bundle serialiser (every
    # contact in the model rides along with the .gmproj save) and by
    # the model editor when loading the full interpretation.
    contacts: Mapped[list[FormationContactOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "FormationContactOrm",
        back_populates="model",
        cascade="all, delete-orphan",
        lazy=RELATIONSHIP_LAZY,
    )
    # Layer rows for the unified litho boundary model
    # (spec docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md).
    # Populated for kind='lithostratigraphic' models; geological models
    # carry zero layers (their boundaries live in ``contacts`` above).
    litho_layers: Mapped[list[LithoLayerOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "LithoLayerOrm",
        back_populates="model",
        cascade="all, delete-orphan",
        lazy=RELATIONSHIP_LAZY,
    )
    # Reverse relationship for the cached TIN surfaces (one row per
    # formation present in this model). The bundle serialiser nests
    # them under the model so .strix save/restore carries the cache
    # — opening a file on a fresh DB doesn't pay the recompute cost
    # up front; the next contact mutation refreshes anyway.
    surfaces: Mapped[list[FormationSurfaceOrm]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "FormationSurfaceOrm", cascade="all, delete-orphan", lazy=RELATIONSHIP_LAZY
    )
