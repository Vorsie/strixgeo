"""Suggest NAD packing sub-units for a geotechnical model's skeleton segments.

Geotechnical stage — Slice 1, Task C2a (SUGGEST half).

``SuggestGeotechSubdivision`` is a **read-only** use case.  Given an existing
geotech model (built by Task C1's ``BuildGeotechModelFromLitho``) and a
cross-section, it:

1. Loads the geotech skeleton ``FormationContact`` rows for in-corridor
   investigations.
2. Reconstructs the geo-bounded segments: each skeleton contact is a segment
   top; the segment's base is the next contact's top (on the same investigation)
   or the investigation's total depth.
3. For **CPT** investigations: loads the CPT's raw qc series, slices it to the
   segment's depth window, and calls
   :func:`groundmodel.domain.services.geotech_subdivision.suggest_geotech_subdivision`
   to produce NAD packing sub-units.
4. For **borehole** investigations (no qc): produces a single carry-through
   ghost spanning the whole segment with ``nad_class=None`` (cannot
   packing-classify without qc — spec §8).

Returns an **ephemeral** :class:`GeotechSuggestionResult` list — nothing is
written to the database.  Task C2b (Accept) will consume this result to
persist the final ``(nad_class, source_litho_formation_id,
source_geo_formation_id)`` formations and retarget the skeleton contacts.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.geotech_subdivision import (
    GeotechSplit,
    suggest_geotech_subdivision,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES, BaseLithology
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default min sub-unit thickness when the view-state knob is absent.
# Geotech sub-units are typically thicker than litho layers; 0.30 m is a
# reasonable floor that avoids micro-splits from single CPT spike rows.
_DEFAULT_MIN_THICKNESS_M: float = 0.30

# Fallback investigation total depth when neither CptOrm nor BoreholeOrm
# carries a ``total_depth_m`` — acts as the last segment's base.
_FALLBACK_TOTAL_DEPTH_M: float = 30.0


# ---------------------------------------------------------------------------
# Result DTOs (frozen, ephemeral — no DB identity)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GeotechGhostSubUnit:
    """One suggested NAD packing sub-unit within a geo-bounded skeleton segment.

    The triple ``(nad_class, source_litho_formation_id, source_geo_formation_id)``
    is the find-or-create key Task C2b Accept will use to locate or create the
    real ``geological_formation`` row and retarget the skeleton contact.

    Parameters
    ----------
    depth_top_m : float
        Top depth of the sub-unit (metres, positive down), clamped to the
        parent segment top.
    depth_base_m : float
        Base depth of the sub-unit (metres, positive down), clamped to the
        parent segment base.
    nad_class : int | None
        Classified NAD packing class 1–31, or ``None`` when the investigation
        has no qc series (borehole carry-through).
    source_litho_formation_id : UUID
        The lithostratigraphic formation this geotech sub-unit subdivides.
    source_geo_formation_id : UUID | None
        The geological formation the sub-unit sits within (``None`` for the
        open shallow band above the topmost geological surface).
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None


@dataclass(frozen=True)
class GeotechSegmentSuggestion:
    """Suggested sub-units for one geo-bounded skeleton segment.

    Parameters
    ----------
    segment_top_m : float
        The skeleton contact's ``depth_top_m`` — top of this segment.
    segment_base_m : float
        Base depth inferred from the next contact or investigation total depth.
    source_litho_formation_id : UUID
        The litho formation the skeleton contact's formation inherits from.
    source_geo_formation_id : UUID | None
        The geo formation the segment sits within.
    ghost_sub_units : list[GeotechGhostSubUnit]
        Suggested NAD sub-units — one or more per segment.  Never empty: CPT
        segments always produce at least one split; borehole segments produce
        exactly one carry-through with ``nad_class=None``.
    """

    segment_top_m: float
    segment_base_m: float
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
    ghost_sub_units: list[GeotechGhostSubUnit]


@dataclass(frozen=True)
class GeotechInvestigationSuggestion:
    """All segment suggestions for one in-corridor investigation.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this suggestion is for.
    is_cpt : bool
        ``True`` for CPT anchors (qc available), ``False`` for boreholes.
    segments : list[GeotechSegmentSuggestion]
        Ordered top-to-bottom segment suggestions.
    """

    investigation_id: UUID
    is_cpt: bool
    segments: list[GeotechSegmentSuggestion]


# ---------------------------------------------------------------------------
# Use case
# ---------------------------------------------------------------------------


class SuggestGeotechSubdivision(GroundModelLogger):
    """Read-only use case: suggest NAD sub-units for a geotech model's skeleton.

    Nothing is written to the database.  The caller (API router or Task C2b)
    is responsible for persisting the accepted suggestions.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        section_id: UUID,
    ) -> list[GeotechInvestigationSuggestion]:
        """Suggest NAD packing sub-units for a geotech model's in-corridor segments.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        geotech_model_id : UUID
            The ``kind='geotechnical'`` model whose skeleton contacts to process.
        section_id : UUID
            The cross-section whose in-corridor investigations are subdivided.

        Returns
        -------
        list[GeotechInvestigationSuggestion]
            One entry per in-corridor investigation with at least one skeleton
            contact.  Empty when no in-corridor investigations have skeleton
            contacts.

        Raises
        ------
        ValueError
            When the geotech model is not found or not scoped to the project.
        """
        self.info(
            f"SuggestGeotechSubdivision: geotech_model={geotech_model_id} section={section_id}"
        )

        geotech_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            geotech_model_id,
            project_id,
            label="Geotech model",
        )

        # Phase 1 — find in-corridor investigations.
        in_corridor = await project_investigations_onto_section(
            self._session, project_id=project_id, section_id=section_id
        )
        if not in_corridor:
            self.warning("SuggestGeotechSubdivision: no in-corridor investigations — returning []")
            return []

        # in_corridor keys are already Python UUID objects (the return type of
        # project_investigations_onto_section is dict[UUID, float]).
        corridor_uuids: set[UUID] = set(in_corridor.keys())

        # Phase 2 — load the geotech skeleton contacts for in-corridor investigations.
        contact_rows = (
            (
                await self._session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == geotech_model_id,
                        FormationContactOrm.borehole_id.in_(corridor_uuids)
                        | FormationContactOrm.cpt_id.in_(corridor_uuids),
                    )
                )
            )
            .scalars()
            .all()
        )
        self.info(
            f"SuggestGeotechSubdivision: {len(contact_rows)} skeleton contact(s) "
            f"across {len(in_corridor)} in-corridor investigation(s)"
        )
        if not contact_rows:
            self.warning(
                "SuggestGeotechSubdivision: no skeleton contacts found — "
                "run BuildGeotechModelFromLitho first"
            )
            return []

        # Phase 3 — load skeleton formations (need source_litho/geo FKs + soil code).
        formation_ids = {c.formation_id for c in contact_rows}
        skeleton_formations: dict[UUID, GeologicalFormationOrm] = {
            f.id: f
            for f in (
                (
                    await self._session.execute(
                        select(GeologicalFormationOrm).where(
                            GeologicalFormationOrm.id.in_(formation_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
        }

        # Phase 4 — classify each investigation as borehole or CPT.
        anchor_kind = await self._resolve_anchor_kinds(corridor_uuids)

        # Phase 5 — load CPT series for in-corridor CPTs.
        cpt_ids = {UUID(inv_id) for inv_id, kind in anchor_kind.items() if kind == "cpt"}
        cpt_series: dict[UUID, CptSeriesOrm] = {}
        if cpt_ids:
            series_rows = (
                (
                    await self._session.execute(
                        select(CptSeriesOrm).where(CptSeriesOrm.cpt_id.in_(cpt_ids))
                    )
                )
                .scalars()
                .all()
            )
            cpt_series = {s.cpt_id: s for s in series_rows}
            self.debug(
                f"SuggestGeotechSubdivision: loaded qc series for "
                f"{len(cpt_series)}/{len(cpt_ids)} CPT(s)"
            )

        # Phase 6 — load investigation total depths for segment-base inference.
        total_depths = await self._load_total_depths(corridor_uuids)

        # Phase 7 — read the min_thickness knob from project view-state.
        min_thickness_m = await self._read_min_thickness_m(geotech_model.app_project_id)
        self.debug(f"SuggestGeotechSubdivision: min_thickness_m={min_thickness_m}")

        # Phase 8 — group contacts by investigation + sort top-to-bottom.
        contacts_by_inv: dict[str, list[FormationContactOrm]] = {}
        for c in contact_rows:
            inv_id = str(c.cpt_id) if c.cpt_id is not None else str(c.borehole_id)
            contacts_by_inv.setdefault(inv_id, []).append(c)
        for contacts in contacts_by_inv.values():
            contacts.sort(key=lambda c: c.depth_top_m)

        # Phase 9 — per-investigation suggestion.
        results: list[GeotechInvestigationSuggestion] = []
        for i, (inv_id, contacts) in enumerate(contacts_by_inv.items()):
            self.debug(
                f"[{i + 1}/{len(contacts_by_inv)}] "
                f"SuggestGeotechSubdivision: investigation={inv_id} "
                f"{len(contacts)} segment(s)"
            )
            inv_uuid = UUID(inv_id)
            kind = anchor_kind.get(inv_id, "borehole")
            is_cpt = kind == "cpt"
            total_depth = total_depths.get(inv_uuid, _FALLBACK_TOTAL_DEPTH_M)
            series = cpt_series.get(inv_uuid) if is_cpt else None

            segments = self._suggest_investigation(
                contacts=contacts,
                skeleton_formations=skeleton_formations,
                series=series,
                total_depth_m=total_depth,
                min_thickness_m=min_thickness_m,
            )

            results.append(
                GeotechInvestigationSuggestion(
                    investigation_id=inv_uuid,
                    is_cpt=is_cpt,
                    segments=segments,
                )
            )

        self.success(
            f"SuggestGeotechSubdivision: {len(results)} investigation(s) processed — "
            f"geotech_model={geotech_model_id} section={section_id}"
        )
        return results

    # ------------------------------------------------------------------
    # Private — per-investigation suggestion
    # ------------------------------------------------------------------

    def _suggest_investigation(
        self,
        *,
        contacts: list[FormationContactOrm],
        skeleton_formations: dict[UUID, GeologicalFormationOrm],
        series: CptSeriesOrm | None,
        total_depth_m: float,
        min_thickness_m: float,
    ) -> list[GeotechSegmentSuggestion]:
        """Produce segment suggestions for one investigation.

        Iterates skeleton contacts top-to-bottom; each contact defines a
        segment whose base is the next contact's top (or ``total_depth_m``).
        CPT contacts are classified via the domain suggester; borehole contacts
        produce one carry-through ghost with ``nad_class=None``.

        Parameters
        ----------
        contacts : list[FormationContactOrm]
            Skeleton contacts for the investigation, pre-sorted by depth_top_m.
        skeleton_formations : dict[UUID, GeologicalFormationOrm]
            Loaded skeleton formation rows, keyed by id.
        series : CptSeriesOrm | None
            The CPT's raw qc series, or ``None`` for borehole anchors.
        total_depth_m : float
            Investigation total depth — used as the base of the final segment.
        min_thickness_m : float
            Minimum NAD sub-unit thickness for the domain suggester.

        Returns
        -------
        list[GeotechSegmentSuggestion]
            One entry per skeleton segment, ordered top-to-bottom.
        """
        suggestions: list[GeotechSegmentSuggestion] = []

        for idx, contact in enumerate(contacts):
            seg_top = contact.depth_top_m
            seg_base = contacts[idx + 1].depth_top_m if idx + 1 < len(contacts) else total_depth_m

            skeleton = skeleton_formations.get(contact.formation_id)
            if skeleton is None:
                self.warning(
                    f"_suggest_investigation: skeleton formation {contact.formation_id} "
                    f"not found — skipping segment at {seg_top}–{seg_base} m"
                )
                continue

            source_litho_fid = skeleton.source_litho_formation_id
            source_geo_fid = skeleton.source_geo_formation_id
            if source_litho_fid is None:
                # Should not happen for geotech skeleton formations — skip defensively.
                self.warning(
                    f"_suggest_investigation: skeleton {skeleton.id} has no "
                    f"source_litho_formation_id — skipping segment {seg_top}–{seg_base} m"
                )
                continue

            ghost_sub_units = self._classify_segment(
                skeleton=skeleton,
                series=series,
                seg_top=seg_top,
                seg_base=seg_base,
                min_thickness_m=min_thickness_m,
                source_litho_fid=source_litho_fid,
                source_geo_fid=source_geo_fid,
            )

            suggestions.append(
                GeotechSegmentSuggestion(
                    segment_top_m=seg_top,
                    segment_base_m=seg_base,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                    ghost_sub_units=ghost_sub_units,
                )
            )

        return suggestions

    def _classify_segment(
        self,
        *,
        skeleton: GeologicalFormationOrm,
        series: CptSeriesOrm | None,
        seg_top: float,
        seg_base: float,
        min_thickness_m: float,
        source_litho_fid: UUID,
        source_geo_fid: UUID | None,
    ) -> list[GeotechGhostSubUnit]:
        """Classify one geo-bounded segment into NAD ghost sub-units.

        CPT segments: run the domain suggester on the qc slice.
        Borehole segments (``series=None``): one carry-through ghost with
        ``nad_class=None``.

        Parameters
        ----------
        skeleton : GeologicalFormationOrm
            The skeleton formation carrying inherited soil code + admixtures.
        series : CptSeriesOrm | None
            CPT raw series, or ``None`` for borehole anchors.
        seg_top : float
            Segment top depth (metres, positive down).
        seg_base : float
            Segment base depth (metres, positive down).
        min_thickness_m : float
            Minimum NAD sub-unit thickness.
        source_litho_fid : UUID
            Provenance FK for the result DTOs.
        source_geo_fid : UUID | None
            Provenance FK for the result DTOs.

        Returns
        -------
        list[GeotechGhostSubUnit]
            One or more ghost sub-units, ordered top-to-bottom.  Never empty.
        """
        if series is None:
            # Borehole — no qc → one carry-through with nad_class=None.
            return [
                GeotechGhostSubUnit(
                    depth_top_m=seg_top,
                    depth_base_m=seg_base,
                    nad_class=None,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                )
            ]

        # CPT — call the domain suggester.
        soil_code: str | None = skeleton.litho_main_soil_code
        if soil_code is None or soil_code not in BASE_LITHOLOGIES:
            # Unknown / missing soil code: produce one carry-through ghost with
            # nad_class=None rather than classifying on an invalid soil type.
            self.warning(
                f"_classify_segment: skeleton {skeleton.id} has unrecognised "
                f"litho_main_soil_code={soil_code!r} — carry-through with nad_class=None"
            )
            return [
                GeotechGhostSubUnit(
                    depth_top_m=seg_top,
                    depth_base_m=seg_base,
                    nad_class=None,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                )
            ]

        soil: BaseLithology = soil_code  # type: ignore[assignment]
        admixtures: tuple[Admixture, ...] = self._parse_admixtures(skeleton)

        splits: list[GeotechSplit] = suggest_geotech_subdivision(
            soil=soil,
            admixtures=admixtures,
            depth_m=series.depths_m,
            qc_mpa=series.qc_mpa,
            segment_top_m=seg_top,
            segment_base_m=seg_base,
            min_thickness_m=min_thickness_m,
        )

        return [
            GeotechGhostSubUnit(
                depth_top_m=split.depth_top_m,
                depth_base_m=split.depth_base_m,
                nad_class=split.nad_class,
                source_litho_formation_id=source_litho_fid,
                source_geo_formation_id=source_geo_fid,
            )
            for split in splits
        ]

    @staticmethod
    def _parse_admixtures(skeleton: GeologicalFormationOrm) -> tuple[Admixture, ...]:
        """Parse the skeleton formation's JSONB admixture list into domain objects.

        The ``litho_admixtures`` column stores
        ``[{"soil_code": str, "amount": str, "locally": bool}, ...]`` as JSONB.
        An absent or empty list returns an empty tuple.

        Parameters
        ----------
        skeleton : GeologicalFormationOrm
            The skeleton geotech formation row.

        Returns
        -------
        tuple[Admixture, ...]
            Domain admixture objects; empty tuple when none are stored.
        """
        raw = skeleton.litho_admixtures
        if not raw:
            return ()
        return tuple(
            Admixture(
                soil_code=entry.get("soil_code", ""),
                amount=entry.get("amount", ""),
                locally=bool(entry.get("locally", False)),
            )
            for entry in raw
            if isinstance(entry, dict)
        )

    # ------------------------------------------------------------------
    # Private — DB helpers (no writes)
    # ------------------------------------------------------------------

    async def _resolve_anchor_kinds(self, investigation_ids: set[UUID]) -> dict[str, str]:
        """Classify each investigation id as ``"borehole"`` or ``"cpt"``.

        Reuses the same two-table SELECT pattern as
        ``BuildGeotechModelFromLitho._resolve_anchor_kinds``.

        Parameters
        ----------
        investigation_ids : set[UUID]
            The in-corridor investigation UUIDs to classify.

        Returns
        -------
        dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        """
        if not investigation_ids:
            return {}
        kinds: dict[str, str] = {}
        bh_ids = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id.in_(investigation_ids))
            )
        ).scalars()
        for bid in bh_ids:
            kinds[str(bid)] = "borehole"
        cpt_ids = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id.in_(investigation_ids)))
        ).scalars()
        for cid in cpt_ids:
            kinds[str(cid)] = "cpt"
        return kinds

    async def _load_total_depths(self, investigation_ids: set[UUID]) -> dict[UUID, float]:
        """Load the total depth for each in-corridor investigation.

        Checks both the CPT and borehole tables; the total depth is used as
        the base of each investigation's last geotech segment.

        Parameters
        ----------
        investigation_ids : set[UUID]
            The in-corridor investigation UUIDs.

        Returns
        -------
        dict[UUID, float]
            ``investigation_id -> total_depth_m``.  Investigations absent from
            both tables are omitted; the caller falls back to
            ``_FALLBACK_TOTAL_DEPTH_M``.
        """
        total_depths: dict[UUID, float] = {}

        cpt_rows = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.max_depth_m).where(CptOrm.id.in_(investigation_ids))
            )
        ).all()
        for row in cpt_rows:
            if row.max_depth_m is not None:
                total_depths[row.id] = row.max_depth_m

        bh_rows = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.total_depth_m).where(
                    BoreholeOrm.id.in_(investigation_ids)
                )
            )
        ).all()
        for row in bh_rows:
            if row.total_depth_m is not None:
                total_depths[row.id] = row.total_depth_m

        return total_depths

    async def _read_min_thickness_m(self, project_id: UUID) -> float:
        """Read the project's ``minimum_layer_thickness_m`` from its view-state.

        Mirrors the pattern in ``BuildGeotechModelFromLitho._read_litho_snap_tolerance_m``:
        project → view_state JSON → ``litho_segmenter`` sub-object → knob.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured minimum thickness, or ``_DEFAULT_MIN_THICKNESS_M``
            (0.30 m) when absent, non-positive, or non-numeric.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("litho_segmenter") or {}
        try:
            val = float(seg.get("minimum_layer_thickness_m", _DEFAULT_MIN_THICKNESS_M))
            return val if val > 0 else _DEFAULT_MIN_THICKNESS_M
        except (TypeError, ValueError):
            return _DEFAULT_MIN_THICKNESS_M
