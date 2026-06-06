"""ORM row-builder helpers for the bundle restore pipeline.

Each helper constructs one or more ORM instances from a raw bundle
payload dict, using the shared serialisation helpers in
``bundle_serialization``.  None of these functions touch the database
session — they return constructed ORM objects for the caller to
``session.add``.

Helpers:

* ``_make_location`` — Rebuild a PostGIS WKTElement from raw x/y/epsg.
* ``_build_cpt`` — Build a ``CptOrm`` (+ optional ``CptSeriesOrm``).
* ``_series_row_count`` — Peek at the depths_m array length before
  building, for the series-cap guard (debt #112).
* ``_cap`` — Truncate an oversized child array with a warning.
* ``_build_borehole`` — Build a ``BoreholeOrm`` with its full child tree.
* ``_build_observation`` — Build an ``ObservationOrm`` with layers.
* ``_build_layer`` — Build an ``ObservationLayerOrm`` with admixtures.
* ``_build_sample`` — Build a ``SampleOrm`` with all six lab-test families.
* ``_uuid`` — Coerce a raw bundle value to ``UUID | None``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from geoalchemy2 import WKTElement

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_serialization import (
    _MAX_BOREHOLE_DRILL_SEGMENTS,
    _MAX_BOREHOLE_FIELD_LOG_INTERVALS,
    _MAX_BOREHOLE_OBSERVATIONS,
    _MAX_BOREHOLE_SAMPLES,
    _MAX_LAYER_ADMIXTURES,
    _MAX_OBSERVATION_LAYERS,
    _MAX_SAMPLE_LAB_TESTS,
    _apply_json_to_kwargs,
)


def _uuid(raw: object) -> UUID | None:
    """Coerce a raw bundle value to UUID, returning None when absent.

    Parameters
    ----------
    raw : object
        A value from a bundle dict — typically ``str``, ``UUID``, or ``None``.

    Returns
    -------
    UUID | None
        Parsed UUID, or ``None`` when ``raw`` is ``None``.
    """
    if raw is None:
        return None
    return UUID(raw) if isinstance(raw, str) else raw  # type: ignore[arg-type]


def _make_location(
    location_x: float | None, location_y: float | None, epsg: int | None
) -> WKTElement | None:
    """Rebuild the PostGIS geometry from raw x/y/epsg.

    Returns ``None`` when any of the three is missing — matches the
    behaviour of the import pipeline (CPT / borehole rows can lack a
    usable EPSG and still be stored).

    Parameters
    ----------
    location_x : float | None
        Easting / longitude of the investigation point.
    location_y : float | None
        Northing / latitude of the investigation point.
    epsg : int | None
        EPSG code of the coordinate reference system.

    Returns
    -------
    WKTElement | None
        PostGIS-compatible WKT geometry element, or ``None``.
    """
    if location_x is None or location_y is None or epsg is None:
        return None
    return WKTElement(f"SRID={epsg};POINT({location_x} {location_y})")


def _series_row_count(cpt_data: dict[str, Any]) -> int | None:
    """Return the depths_m array length from a CPT bundle dict, or None.

    Used by the restore path to check the series-row cap (debt #112) before
    building the CptSeriesOrm.  Returns None when the CPT has no series or
    when depths_m is absent.

    Parameters
    ----------
    cpt_data : dict[str, Any]
        Raw CPT payload from the bundle.

    Returns
    -------
    int | None
        Length of depths_m, or None when not present.
    """
    series = cpt_data.get("series")
    if series is None:
        return None
    depths = series.get("depths_m")
    if depths is None:
        return None
    return len(depths)


def _cap(
    items: list[Any],
    cap: int,
    label: str,
    logger: GroundModelLogger,
) -> list[Any]:
    """Truncate an oversized child array to ``cap``, warning what was dropped.

    Defence against a crafted/oversized .strix bundle (debt #112, F2): a nested
    borehole child array has no Pydantic bound. Over-cap arrays are truncated
    (the parent row still restores) rather than dropped wholesale.

    Parameters
    ----------
    items : list[Any]
        The raw payload child array.
    cap : int
        Maximum number of entries to keep.
    label : str
        Human label for the warning (e.g. ``"observations on borehole X"``).
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    list[Any]
        ``items`` unchanged when within the cap, else the first ``cap`` entries.
    """
    if len(items) > cap:
        logger.warning(f"restore: {label} has {len(items)} entries — capping to {cap} (debt #112)")
        return items[:cap]
    return items


def _build_cpt(data: dict[str, Any], app_project_id: UUID) -> CptOrm:
    """Construct a ``CptOrm`` (with optional ``CptSeriesOrm``) from a bundle dict.

    Parameters
    ----------
    data : dict[str, Any]
        Raw CPT payload from the bundle, optionally carrying a nested
        ``"series"`` key.
    app_project_id : UUID
        Owning project id — injected because the bundle strips it.

    Returns
    -------
    CptOrm
        Constructed ORM instance ready for ``session.add``.
    """
    series_payload = data.get("series")
    cpt_kwargs = _apply_json_to_kwargs(CptOrm, data)
    cpt = CptOrm(app_project_id=app_project_id, **cpt_kwargs)
    # WKTElement is accepted at column-set time by GeoAlchemy2 and rewritten
    # to a WKBElement during INSERT — mypy sees only the column's declared
    # WKBElement type so the assignment is cast through ``Any`` here.
    cpt.location = _make_location(cpt.location_x, cpt.location_y, cpt.epsg)  # type: ignore[assignment]
    if series_payload is not None:
        cpt.series = CptSeriesOrm(**_apply_json_to_kwargs(CptSeriesOrm, series_payload))
    return cpt


def _build_borehole(
    data: dict[str, Any], app_project_id: UUID, *, logger: GroundModelLogger
) -> BoreholeOrm:
    """Construct a ``BoreholeOrm`` with its full child tree from a bundle dict.

    Applies per-child-array size caps (debt #112, F2) before building ORM
    instances. Local imports of leaf ORM classes are used to avoid ballooning
    the import graph for callers that never call the restore path.

    Parameters
    ----------
    data : dict[str, Any]
        Raw borehole payload from the bundle, carrying nested arrays for
        drill_segments, field_log_intervals, observations, and samples.
    app_project_id : UUID
        Owning project id.
    logger : GroundModelLogger
        Caller's logger (cap warnings).

    Returns
    -------
    BoreholeOrm
        Constructed ORM instance with all child ORM objects attached.
    """
    bh_label = data.get("name") or data.get("id") or "?"
    drill_segments = _cap(
        data.get("drill_segments") or [],
        _MAX_BOREHOLE_DRILL_SEGMENTS,
        f"drill_segments on borehole {bh_label}",
        logger,
    )
    field_log_intervals = _cap(
        data.get("field_log_intervals") or [],
        _MAX_BOREHOLE_FIELD_LOG_INTERVALS,
        f"field_log_intervals on borehole {bh_label}",
        logger,
    )
    observations = _cap(
        data.get("observations") or [],
        _MAX_BOREHOLE_OBSERVATIONS,
        f"observations on borehole {bh_label}",
        logger,
    )
    samples = _cap(
        data.get("samples") or [],
        _MAX_BOREHOLE_SAMPLES,
        f"samples on borehole {bh_label}",
        logger,
    )

    bh_kwargs = _apply_json_to_kwargs(BoreholeOrm, data)
    bh = BoreholeOrm(app_project_id=app_project_id, **bh_kwargs)
    bh.location = _make_location(bh.location_x, bh.location_y, bh.epsg)  # type: ignore[assignment]

    # Local imports to dodge circular references — each leaf class lives
    # alongside its own ORM module, and importing them at module top
    # would balloon the import graph for callers that never restore.
    from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
    from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
    from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
    from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
    from groundmodel.infrastructure.db.models.field_log_interval_orm import (
        FieldLogIntervalOrm,
    )
    from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
    from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
    from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
    from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm

    bh.drill_segments = [
        DrillSegmentOrm(**_apply_json_to_kwargs(DrillSegmentOrm, d)) for d in drill_segments
    ]
    bh.field_log_intervals = [
        FieldLogIntervalOrm(**_apply_json_to_kwargs(FieldLogIntervalOrm, d))
        for d in field_log_intervals
    ]
    bh.observations = [
        _build_observation(obs_data, AdmixtureOrm, logger=logger) for obs_data in observations
    ]
    bh.samples = [
        _build_sample(
            sample_data,
            GrainSizeOrm,
            AtterbergLimitsOrm,
            CaCO3ContentOrm,
            OrganicContentOrm,
            WaterContentOrm,
            ScalarLabTestOrm,
            logger=logger,
        )
        for sample_data in samples
    ]
    return bh


def _build_observation(
    data: dict[str, Any], admixture_cls: type[Any], *, logger: GroundModelLogger
) -> ObservationOrm:
    """Construct an ``ObservationOrm`` with its layer children.

    Parameters
    ----------
    data : dict[str, Any]
        Raw observation payload from the bundle, carrying a nested
        ``"layers"`` array.
    admixture_cls : type[Any]
        ORM class to use for admixture rows (injected to avoid an
        import cycle at module load time).
    logger : GroundModelLogger
        Caller's logger (cap warnings).

    Returns
    -------
    ObservationOrm
        Constructed ORM instance with layer children attached.
    """
    layers_payload = _cap(
        data.get("layers") or [],
        _MAX_OBSERVATION_LAYERS,
        f"layers on observation {data.get('id', '?')}",
        logger,
    )
    obs = ObservationOrm(**_apply_json_to_kwargs(ObservationOrm, data))
    obs.layers = [
        _build_layer(layer_data, admixture_cls, logger=logger) for layer_data in layers_payload
    ]
    return obs


def _build_layer(
    data: dict[str, Any], admixture_cls: type[Any], *, logger: GroundModelLogger
) -> ObservationLayerOrm:
    """Construct an ``ObservationLayerOrm`` with its admixture children.

    Parameters
    ----------
    data : dict[str, Any]
        Raw observation-layer payload, carrying a nested ``"admixtures"``
        array.
    admixture_cls : type[Any]
        ORM class for admixture rows.
    logger : GroundModelLogger
        Caller's logger (cap warnings).

    Returns
    -------
    ObservationLayerOrm
        Constructed ORM instance with admixture children attached.
    """
    admixtures_payload = _cap(
        data.get("admixtures") or [],
        _MAX_LAYER_ADMIXTURES,
        f"admixtures on layer {data.get('id', '?')}",
        logger,
    )
    layer = ObservationLayerOrm(**_apply_json_to_kwargs(ObservationLayerOrm, data))
    layer.admixtures = [
        admixture_cls(**_apply_json_to_kwargs(admixture_cls, a)) for a in admixtures_payload
    ]
    return layer


def _build_sample(
    data: dict[str, Any],
    grain_size_cls: type[Any],
    atterberg_cls: type[Any],
    caco3_cls: type[Any],
    organic_cls: type[Any],
    water_cls: type[Any],
    scalar_cls: type[Any],
    *,
    logger: GroundModelLogger,
) -> SampleOrm:
    """Construct a ``SampleOrm`` with all six lab-test family children.

    Each lab-test family is its own child array; all are capped (debt
    #112, F2) before building ORM instances.

    Parameters
    ----------
    data : dict[str, Any]
        Raw sample payload from the bundle, carrying nested arrays for
        each lab-test family.
    grain_size_cls : type[Any]
        ORM class for grain-size test rows.
    atterberg_cls : type[Any]
        ORM class for Atterberg limits test rows.
    caco3_cls : type[Any]
        ORM class for CaCO3 content test rows.
    organic_cls : type[Any]
        ORM class for organic content test rows.
    water_cls : type[Any]
        ORM class for water content test rows.
    scalar_cls : type[Any]
        ORM class for scalar lab test (catch-all) rows.
    logger : GroundModelLogger
        Caller's logger (cap warnings).

    Returns
    -------
    SampleOrm
        Constructed ORM instance with all lab-test children attached.
    """
    sample = SampleOrm(**_apply_json_to_kwargs(SampleOrm, data))
    sample_label = data.get("id", "?")
    sample.grain_sizes = [
        grain_size_cls(**_apply_json_to_kwargs(grain_size_cls, d))
        for d in _cap(
            data.get("grain_sizes") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"grain_sizes on sample {sample_label}",
            logger,
        )
    ]
    sample.atterberg_limits_tests = [
        atterberg_cls(**_apply_json_to_kwargs(atterberg_cls, d))
        for d in _cap(
            data.get("atterberg_limits_tests") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"atterberg_limits_tests on sample {sample_label}",
            logger,
        )
    ]
    sample.caco3_content_tests = [
        caco3_cls(**_apply_json_to_kwargs(caco3_cls, d))
        for d in _cap(
            data.get("caco3_content_tests") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"caco3_content_tests on sample {sample_label}",
            logger,
        )
    ]
    sample.organic_content_tests = [
        organic_cls(**_apply_json_to_kwargs(organic_cls, d))
        for d in _cap(
            data.get("organic_content_tests") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"organic_content_tests on sample {sample_label}",
            logger,
        )
    ]
    sample.water_content_tests = [
        water_cls(**_apply_json_to_kwargs(water_cls, d))
        for d in _cap(
            data.get("water_content_tests") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"water_content_tests on sample {sample_label}",
            logger,
        )
    ]
    sample.scalar_lab_tests = [
        scalar_cls(**_apply_json_to_kwargs(scalar_cls, d))
        for d in _cap(
            data.get("scalar_lab_tests") or [],
            _MAX_SAMPLE_LAB_TESTS,
            f"scalar_lab_tests on sample {sample_label}",
            logger,
        )
    ]
    return sample
