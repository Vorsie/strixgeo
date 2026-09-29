"""Suggest lithostratigraphic layer contacts for an investigation.

Read-only use case: loads CPT series or borehole observation layers from the
existing repositories, runs the domain segmenter, and returns the suggestion
list. Nothing is written to the database — the user accepts suggestions via
the normal contact-create flow (slice 4).

The use case validates that the target geological model has ``kind='lithostratigraphic'``
and raises ``InvalidModelKindError`` otherwise (the API router maps this to 422).

Phase 4 carve-out: this use case is the integration point for the Robertson
2015/2009 CPT segmenter. See docs/debt.md and CLAUDE.md for the deliberate
divergence from the frozen cpt_interpretation.py (1990 Ic preview).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.application.borehole_observation_layers_options import (
    borehole_observation_layers_options,
)
from groundmodel.domain.services.gwt_resolution import resolve_gwt
from groundmodel.domain.services.litho_segmentation import (
    LithoLayerSuggestion,
    segment_borehole,
    segment_cpt,
)
from groundmodel.domain.services.track_preference import preferred_track
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class InvalidModelKindError(Exception):
    """The model's ``kind`` does not support litho-contact suggestions.

    Only ``kind='lithostratigraphic'`` models may receive suggested contacts.
    Geological and geotechnical models do not accept CPT/borehole-derived
    litho segmentation because their formation vocabularies are different.
    """

    def __init__(self, model_id: UUID, actual_kind: str) -> None:
        super().__init__(
            f"Model {model_id} has kind='{actual_kind}'; "
            "litho suggestions require kind='lithostratigraphic'"
        )
        self.model_id = model_id
        self.actual_kind = actual_kind


class InvestigationNotFoundError(Exception):
    """The requested CPT or borehole does not exist or has no usable data."""

    def __init__(self, investigation_id: UUID, investigation_type: str) -> None:
        super().__init__(f"{investigation_type} {investigation_id} not found or has no data")
        self.investigation_id = investigation_id
        self.investigation_type = investigation_type


# DOV/borehole observation types whose layers carry lithology soil codes —
# we prefer coded_lithology (the encoded geotechnical coding) over the free-
# text lithological_description, and fall back to geotechnical_coding.
_LITHO_OBSERVATION_PRIORITY: tuple[str, ...] = (
    "coded_lithology",
    "geotechnical_coding",
    "lithological_description",
)


class SuggestLithoContacts(GroundModelLogger):
    """Read-only use case: segment an investigation and return layer suggestions.

    Supports two investigation types:
    * CPT — uses the Robertson 2015/2009 SBT segmenter (``segment_cpt``).
    * Borehole — uses the DOV hoofdnaam → lithology map (``segment_borehole``).

    The use case is READ-ONLY. Nothing is written to the database.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute_for_cpt(
        self,
        *,
        model_id: UUID,
        cpt_id: UUID,
        minimum_layer_thickness_m: float = 0.15,
        gunsat_kNm3: float = 16.0,
        gwater_kNm3: float = 9.81,
        dr_compression_factor: float = 0.675,
        merge_same_lithology: bool = True,
        use_normalised_qc: bool = True,
    ) -> list[LithoLayerSuggestion]:
        """Suggest litho contacts for a CPT investigation.

        Parameters
        ----------
        model_id : UUID
            Geological model to which the suggestions are targeted.  Must be
            ``kind='lithostratigraphic'`` (422 otherwise via the router).
        cpt_id : UUID
            CPT whose depth series to segment.
        minimum_layer_thickness_m : float
            Minimum output layer thickness (default 0.15 m — matches
            typical CPT sampling resolution; finer = noise, coarser
            misses thin clay drapes per dogfeed 2026-05-23).
        gunsat_kNm3 : float
            Unit weight of soil above the water table (default 16 kN/m³).
        gwater_kNm3 : float
            Unit weight of water (default 9.81 kN/m³).
        dr_compression_factor : float
            Sand relative-density compression factor (default 0.675 average).
        merge_same_lithology : bool
            When ``True`` (default), collapse adjacent same-lithology segments
            into a single layer after Robertson segmentation.  Pass ``False``
            to expose the un-merged splits (diagnostics / pre-geotech-stage).
        use_normalised_qc : bool
            When ``True`` (default), classify with the stress-normalised
            Robertson 2015 pipeline.  When ``False``, use the non-normalised
            Robertson 2010 I_SBT index (no stress profile / groundwater); Dr /
            NAD packing are left blank in that mode.

        Returns
        -------
        list[LithoLayerSuggestion]
            Suggested layers, top-to-bottom.

        Raises
        ------
        InvalidModelKindError
            When the model is not ``kind='lithostratigraphic'``.
        InvestigationNotFoundError
            When the CPT or its series does not exist.
        """
        self.info(
            f"SuggestLithoContacts.execute_for_cpt: model={model_id}, "
            f"cpt={cpt_id}, min_thickness={minimum_layer_thickness_m}m, "
            f"qc={'normalised' if use_normalised_qc else 'non-normalised (I_SBT)'}"
        )
        project_id = await self._assert_litho_model(model_id)

        # Project-scoped load (B2): a CPT from another project must NOT
        # be segmentable against this model.
        cpt = (
            await self._session.execute(
                select(CptOrm)
                .where(CptOrm.id == cpt_id, CptOrm.app_project_id == project_id)
                .options(selectinload(CptOrm.series))
            )
        ).scalar_one_or_none()
        if cpt is None or cpt.series is None:
            raise InvestigationNotFoundError(cpt_id, "CPT")

        series = cpt.series
        if not series.depths_m or not series.qc_mpa:
            raise InvestigationNotFoundError(cpt_id, "CPT")

        # Ground surface and water table — prefer CPT header fields when present.
        # ``elevation_m`` is the TAW elevation of the ground surface; ``None``
        # defaults to 0 (the segmenter result is still valid relative to depth).
        niveau_m: float = cpt.elevation_m if cpt.elevation_m is not None else 0.0
        # ``water_depth_m`` is depth below ground surface — normally positive,
        # but NEGATIVE offshore, where the water stands above the collar; the
        # subtraction below then correctly puts yw ABOVE niveau and
        # ``stress_profile`` takes its case-1 branch. The fallback for a CPT with none
        # recorded (every DOV import) lives in ``resolve_gwt`` — the SAME
        # resolver the Ic chart and the SBT-profile endpoint use, so the curve
        # the engineer reads and the ghosts he is offered share one water table.
        gwt = resolve_gwt(cpt.water_depth_m, cpt.water_depth_source)
        yw_m: float = niveau_m - gwt.gwt_m

        self.debug(
            f"[cpt={cpt.name}] niveau={niveau_m:.2f}m TAW, "
            f"yw={yw_m:.2f}m TAW (gwt={gwt.gwt_m:.2f}m below surface, "
            f"{gwt.source}), "
            f"n_rows={len(series.depths_m)}"
        )

        suggestions = segment_cpt(
            depths_m=series.depths_m,
            qc_mpa=series.qc_mpa,
            fs_mpa=series.fs_mpa if series.fs_mpa is not None else [None] * len(series.depths_m),
            niveau_m=niveau_m,
            yw_m=yw_m,
            minimum_layer_thickness_m=minimum_layer_thickness_m,
            gunsat_kNm3=gunsat_kNm3,
            gwater_kNm3=gwater_kNm3,
            dr_compression_factor=dr_compression_factor,
            merge_same_lithology=merge_same_lithology,
            use_normalised_qc=use_normalised_qc,
        )

        # Id (not name) at SUCCESS: the CPT name is its test_id, which encodes
        # the project / site code, and ``backend.log`` is unredacted on disk.
        # The name is already at DEBUG above (owner: "no user data leaks").
        self.success(f"SuggestLithoContacts: cpt={cpt.id} → {len(suggestions)} suggested layers")
        return suggestions

    async def execute_for_borehole(
        self,
        *,
        model_id: UUID,
        borehole_id: UUID,
        minimum_layer_thickness_m: float = 0.15,
        merge_same_lithology: bool = True,
    ) -> list[LithoLayerSuggestion]:
        """Suggest litho contacts for a borehole investigation.

        Picks the highest-priority lithology observation stream available on the
        borehole (``coded_lithology`` > ``geotechnical_coding`` >
        ``lithological_description``) and maps each layer's primary soil code to
        a base lithology.

        Parameters
        ----------
        model_id : UUID
            Geological model (must be ``kind='lithostratigraphic'``).
        borehole_id : UUID
            Borehole to segment.
        minimum_layer_thickness_m : float
            Minimum output layer thickness (default 0.15 m — matches
            typical CPT sampling resolution; finer = noise, coarser
            misses thin clay drapes per dogfeed 2026-05-23).
        merge_same_lithology : bool
            When ``True`` (default), collapse adjacent same-lithology segments
            from the borehole observation layer mapping into a single layer.
            Set to ``False`` to see the un-merged observation-layer boundaries
            (useful for diagnosing individual description layers).

        Returns
        -------
        list[LithoLayerSuggestion]
            Suggested layers, top-to-bottom.

        Raises
        ------
        InvalidModelKindError
            When the model is not ``kind='lithostratigraphic'``.
        InvestigationNotFoundError
            When the borehole or any usable observation stream does not exist.
        """
        self.info(
            f"SuggestLithoContacts.execute_for_borehole: model={model_id}, "
            f"borehole={borehole_id}, min_thickness={minimum_layer_thickness_m}m, "
            f"merge_same_lithology={merge_same_lithology}"
        )
        project_id = await self._assert_litho_model(model_id)

        # Project-scoped load (B2): a borehole from another project must
        # NOT be segmentable against this model. Eager-load
        # observations + layers to avoid MissingGreenlet.
        borehole = (
            await self._session.execute(
                select(BoreholeOrm)
                .where(
                    BoreholeOrm.id == borehole_id,
                    BoreholeOrm.app_project_id == project_id,
                )
                .options(*borehole_observation_layers_options(include_admixtures=True))
            )
        ).scalar_one_or_none()
        if borehole is None:
            raise InvestigationNotFoundError(borehole_id, "Borehole")

        # Select the best available lithology observation stream: the first
        # kind in priority order that has a layered track; within a kind the
        # shared track-preference rule picks (manual, then newest edited, then
        # today's date order) so a hand-typed track feeds the suggester.
        best_obs: ObservationOrm | None = None
        for obs_type in _LITHO_OBSERVATION_PRIORITY:
            best_obs = preferred_track(
                borehole.observations, obs_type, require=lambda o: bool(o.layers)
            )
            if best_obs is not None:
                break

        if best_obs is None:
            # Id (not name) even on this "what was NOT found" WARNING: a
            # borehole name carries the site code, and ``backend.log`` is
            # unredacted on disk. The id still answers "which borehole".
            self.warning(
                f"Borehole {borehole_id} has no lithology observation layers "
                f"(tried: {_LITHO_OBSERVATION_PRIORITY})"
            )
            raise InvestigationNotFoundError(borehole_id, "Borehole (no litho layers)")

        self.debug(
            f"[borehole={borehole.name}] using observation_type={best_obs.observation_type}, "
            f"n_layers={len(best_obs.layers)}"
        )

        tops = [lyr.top_m for lyr in best_obs.layers]
        bases = [lyr.base_m for lyr in best_obs.layers]
        codes = [lyr.main_soil_codes for lyr in best_obs.layers]
        # Build Admixture domain objects from ORM rows (eager-loaded above).
        admixtures_per_layer: list[list[Admixture]] = [
            [
                Admixture(
                    soil_code=adm.soil_code,
                    amount=adm.amount or "",
                    locally=adm.locally,
                )
                for adm in lyr.admixtures
            ]
            for lyr in best_obs.layers
        ]

        suggestions = segment_borehole(
            layer_tops_m=tops,
            layer_bases_m=bases,
            main_soil_codes=codes,
            minimum_layer_thickness_m=minimum_layer_thickness_m,
            admixtures_per_layer=admixtures_per_layer,
            merge_same_lithology=merge_same_lithology,
        )

        # Id (not name) at SUCCESS: the borehole name carries the site code,
        # and ``backend.log`` is unredacted on disk. The name is already at
        # DEBUG above (owner: "no user data leaks").
        self.success(
            f"SuggestLithoContacts: borehole={borehole.id} → {len(suggestions)} suggested layers"
        )
        return suggestions

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _assert_litho_model(self, model_id: UUID) -> UUID:
        """Validate the model is lithostratigraphic; return its project id.

        The returned ``app_project_id`` is the scope the investigation
        loads MUST be filtered by — without it a caller could segment a
        CPT/borehole from a different project against this model
        (cross-project read, senior-review B2 / debt #4 class).

        Parameters
        ----------
        model_id : UUID
            Geological model to check.

        Returns
        -------
        UUID
            The model's ``app_project_id`` (investigation-scope guard).

        Raises
        ------
        InvalidModelKindError
            When the model does not exist or has a non-lithostratigraphic kind.
        """
        row = await self._session.execute(
            select(GeologicalModelOrm.kind, GeologicalModelOrm.app_project_id).where(
                GeologicalModelOrm.id == model_id
            )
        )
        result = row.one_or_none()
        if result is None or result.kind != "lithostratigraphic":
            raise InvalidModelKindError(
                model_id, result.kind if result is not None else "<not found>"
            )
        self.debug(f"Model {model_id} kind='{result.kind}' — OK")
        app_project_id: UUID = result.app_project_id
        return app_project_id
