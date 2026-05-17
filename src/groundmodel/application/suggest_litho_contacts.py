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

from groundmodel.domain.services.litho_segmentation import (
    LithoLayerSuggestion,
    segment_borehole,
    segment_cpt,
)
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
        minimum_layer_thickness_m: float = 0.5,
        gunsat_kNm3: float = 16.0,
        gwater_kNm3: float = 9.81,
        dr_compression_factor: float = 0.675,
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
            Minimum output layer thickness (default 0.5 m).
        gunsat_kNm3 : float
            Unit weight of soil above the water table (default 16 kN/m³).
        gwater_kNm3 : float
            Unit weight of water (default 9.81 kN/m³).
        dr_compression_factor : float
            Sand relative-density compression factor (default 0.675 average).

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
            f"cpt={cpt_id}, min_thickness={minimum_layer_thickness_m}m"
        )
        await self._assert_litho_model(model_id)

        cpt: CptOrm | None = await self._session.get(
            CptOrm,
            cpt_id,
            options=[selectinload(CptOrm.series)],
        )
        if cpt is None or cpt.series is None:
            raise InvestigationNotFoundError(cpt_id, "CPT")

        series = cpt.series
        if not series.depths_m or not series.qc_mpa:
            raise InvestigationNotFoundError(cpt_id, "CPT")

        # Ground surface and water table — prefer CPT header fields when present.
        # ``elevation_m`` is the TAW elevation of the ground surface; ``None``
        # defaults to 0 (the segmenter result is still valid relative to depth).
        niveau_m: float = cpt.elevation_m if cpt.elevation_m is not None else 0.0
        # ``water_depth_m`` is depth below ground surface (positive); convert to
        # TAW by subtracting from niveau. Defaults to water at the surface (0 m
        # depth → yw = niveau) — conservative assumption when unknown.
        yw_m: float = niveau_m - cpt.water_depth_m if cpt.water_depth_m is not None else niveau_m

        self.debug(
            f"[cpt={cpt.name}] niveau={niveau_m:.2f}m TAW, "
            f"yw={yw_m:.2f}m TAW, n_rows={len(series.depths_m)}"
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
        )

        self.success(f"SuggestLithoContacts: cpt={cpt.name} → {len(suggestions)} suggested layers")
        return suggestions

    async def execute_for_borehole(
        self,
        *,
        model_id: UUID,
        borehole_id: UUID,
        minimum_layer_thickness_m: float = 0.5,
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
            Minimum output layer thickness (default 0.5 m).

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
            f"borehole={borehole_id}, min_thickness={minimum_layer_thickness_m}m"
        )
        await self._assert_litho_model(model_id)

        # Load borehole with observations + layers (eager to avoid MissingGreenlet).
        borehole: BoreholeOrm | None = await self._session.get(
            BoreholeOrm,
            borehole_id,
            options=[selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers)],
        )
        if borehole is None:
            raise InvestigationNotFoundError(borehole_id, "Borehole")

        # Select the best available lithology observation stream.
        best_obs: ObservationOrm | None = None
        for obs_type in _LITHO_OBSERVATION_PRIORITY:
            for obs in borehole.observations:
                if obs.observation_type == obs_type and obs.layers:
                    best_obs = obs
                    break
            if best_obs is not None:
                break

        if best_obs is None:
            self.warning(
                f"Borehole {borehole.name} has no lithology observation layers "
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

        suggestions = segment_borehole(
            layer_tops_m=tops,
            layer_bases_m=bases,
            main_soil_codes=codes,
            minimum_layer_thickness_m=minimum_layer_thickness_m,
        )

        self.success(
            f"SuggestLithoContacts: borehole={borehole.name} → {len(suggestions)} suggested layers"
        )
        return suggestions

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _assert_litho_model(self, model_id: UUID) -> None:
        """Raise ``InvalidModelKindError`` when the model is not lithostratigraphic.

        Parameters
        ----------
        model_id : UUID
            Geological model to check.

        Raises
        ------
        InvalidModelKindError
            When the model does not exist or has a non-lithostratigraphic kind.
        """
        row = await self._session.execute(
            select(GeologicalModelOrm.kind).where(GeologicalModelOrm.id == model_id)
        )
        kind: str | None = row.scalar_one_or_none()
        if kind is None or kind != "lithostratigraphic":
            raise InvalidModelKindError(model_id, kind or "<not found>")
        self.debug(f"Model {model_id} kind='{kind}' — OK")
