"""Domain → ORM builders shared by the two DOV borehole import paths.

The DOV bbox import (``ImportBoreholeDov`` + ``ImportInterpretationsDov``) and
the local-file import (``ImportBoreholeFile``) persist the SAME shapes: a
borehole row with its drill segments and field log, and observations with
their layers and admixtures. The mapping lives here once so the two paths
cannot drift (a column added to one and not the other would make a file-
imported borehole differ from a bbox-imported one).

Pure functions: no I/O, no session, no logging.
"""

from __future__ import annotations

from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_PROJECT_ID


def build_drill_segment_orms(result: BoreholeParseResult) -> list[DrillSegmentOrm]:
    """Map the parsed drill segments to fresh ORM rows.

    Parameters
    ----------
    result : BoreholeParseResult
        Parsed boring.

    Returns
    -------
    list[DrillSegmentOrm]
        One new row per segment (fresh ids).
    """
    return [
        DrillSegmentOrm(id=uuid7(), top_m=seg.top_m, base_m=seg.base_m, method=seg.method)
        for seg in result.drill_segments
    ]


def build_field_log_orms(result: BoreholeParseResult) -> list[FieldLogIntervalOrm]:
    """Map the parsed field-log intervals to fresh ORM rows.

    Parameters
    ----------
    result : BoreholeParseResult
        Parsed boring.

    Returns
    -------
    list[FieldLogIntervalOrm]
        One new row per interval (fresh ids).
    """
    return [
        FieldLogIntervalOrm(
            id=uuid7(), top_m=fl.top_m, base_m=fl.base_m, kind=fl.kind.value, value=fl.value
        )
        for fl in result.field_log
    ]


def build_borehole_orm(
    bh: Borehole,
    result: BoreholeParseResult,
    *,
    borehole_id: UUID,
    test_id: str,
    app_project_id: UUID | None,
) -> BoreholeOrm:
    """Build a new DOV ``BoreholeOrm`` (with its children) from a parsed boring.

    Parameters
    ----------
    bh : Borehole
        The borehole header to persist: the parser's, possibly already merged
        with the WFS row (bbox path).
    result : BoreholeParseResult
        The parse the drill segments and field log come from.
    borehole_id : UUID
        Id of the new row.
    test_id : str
        DOV identificatie (``boornummer``); with ``project_id="DOV"`` the
        dedup key.
    app_project_id : UUID | None
        App project scope.

    Returns
    -------
    BoreholeOrm
        Transient row, not yet added to a session.
    """
    return BoreholeOrm(
        id=borehole_id,
        name=bh.name,
        app_project_id=app_project_id,
        project_id=DOV_PROJECT_ID,
        test_id=test_id,
        location_x=bh.location_x,
        location_y=bh.location_y,
        elevation_m=bh.elevation_m,
        # DOV imports always stamp the DOV source when Z was present, NONE
        # otherwise. The refresh-on-duplicate path checks this before
        # overwriting an imported Z so manual edits survive re-imports
        # (debt #8).
        elevation_source=(
            ElevationSource.DOV.value if bh.elevation_m is not None else ElevationSource.NONE.value
        ),
        epsg=bh.epsg,
        z_epsg=bh.z_epsg,
        location=None,  # PostGIS point: wired in Phase C2 / when the GIS path lands
        start_date=bh.start_date,
        drill_method=bh.drill_method,
        borehole_type=bh.borehole_type,
        purpose=bh.purpose,
        municipality=bh.municipality,
        executor=bh.executor,
        total_depth_m=bh.total_depth_m,
        water_table_depth_m=bh.water_table_depth_m,
        n_drill_segments=len(result.drill_segments),
        n_field_log_intervals=len(result.field_log),
        drill_segments=build_drill_segment_orms(result),
        field_log_intervals=build_field_log_orms(result),
    )


def build_observation_layer_orms(observation: Observation) -> list[ObservationLayerOrm]:
    """Map an observation's layers (and their admixtures) to fresh ORM rows.

    Parameters
    ----------
    observation : Observation
        Parsed observation with its layers nested.

    Returns
    -------
    list[ObservationLayerOrm]
        One new row per layer, admixtures nested (fresh ids).
    """
    return [
        ObservationLayerOrm(
            id=uuid7(),
            top_m=layer.top_m,
            base_m=layer.base_m,
            color=layer.color,
            main_soil_codes=list(layer.main_soil_codes),
            description=layer.description,
            layer_index=layer.layer_index,
            admixtures=[
                AdmixtureOrm(
                    id=uuid7(), soil_code=adm.soil_code, amount=adm.amount, locally=adm.locally
                )
                for adm in layer.admixtures
            ],
        )
        for layer in observation.layers
    ]


def build_observation_orm(
    observation: Observation,
    dov_permkey: str | None,
    *,
    borehole_id: UUID | None = None,
) -> ObservationOrm | None:
    """Map a parsed Observation + its layers + admixtures into one ORM tree.

    Returns ``None`` when the observation has no usable layers: empty
    observations are dropped at this boundary so consumers never see an
    ``Observation`` with zero layers in the DB.

    Parameters
    ----------
    observation : Observation
        Parsed observation.
    dov_permkey : str | None
        The interpretation's DOV permkey; stable upstream identity used by
        re-import dedup (refresh-on-duplicate).
    borehole_id : UUID | None
        Parent borehole; defaults to ``observation.borehole_id`` (the bbox
        path parses against the real id already).

    Returns
    -------
    ObservationOrm | None
        Transient row, or None for a layer-less observation.
    """
    if not observation.layers:
        return None
    return ObservationOrm(
        id=observation.id,
        borehole_id=borehole_id if borehole_id is not None else observation.borehole_id,
        dov_permkey=dov_permkey,
        # The ORM column is plain VARCHAR (a ninth interpretation type needs no
        # ENUM migration); the enum's ``.value`` is the single source of truth.
        observation_type=observation.observation_type.value,
        author=observation.author,
        observation_date=observation.observation_date,
        reliability=observation.reliability,
        score_category=observation.score_category,
        drill_method_score=observation.drill_method_score,
        layers=build_observation_layer_orms(observation),
    )
