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

import math
from collections.abc import Iterable, Mapping
from typing import Any, cast
from uuid import UUID

from geoalchemy2 import WKTElement

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.lab_test_family_constants import LAB_TEST_FAMILIES
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_restore_drops import BundleRestoreDrops
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
    # A non-str, non-None bundle value is already a UUID (the in-process path
    # hands UUID objects through); the cast states that, it converts nothing.
    return UUID(raw) if isinstance(raw, str) else cast(UUID, raw)


def _payload_ids(rows: Iterable[Mapping[str, Any]]) -> set[UUID]:
    """Return the parsed ``id`` of every bundle row that carries one.

    Parameters
    ----------
    rows : Iterable[Mapping[str, Any]]
        Bundle row dicts; a row whose ``id`` is absent or ``None`` is skipped.

    Returns
    -------
    set[UUID]
        The non-null ids, parsed with :func:`_uuid`.
    """
    ids = {_uuid(row.get("id")) for row in rows if row.get("id") is not None}
    return {uid for uid in ids if uid is not None}


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


def _validate_tin_payload(vertices: object, triangles: object) -> bool:
    """Return ``True`` when a restored TIN blob is structurally sound.

    A ``FormationSurfaceOrm`` restored from an untrusted ``.strix`` bundle
    carries ``vertices`` (a list of ``[x, y, z]`` float triples) and
    ``triangles`` (a list of ``[i, j, k]`` integer index triples).  The
    *size* of each array is capped elsewhere (``_MAX_TIN_ARRAY_LEN``,
    debt #112); this helper guards the *shape*.  A malformed triple — wrong
    arity, a non-numeric coordinate, a non-integer triangle index, or an
    index pointing outside the vertex array — would otherwise reach the
    downstream TIN slice / export code and crash it with an opaque
    ``IndexError`` / ``TypeError`` long after the restore committed.

    The check is conservative: any malformation rejects the *whole* surface
    so the caller can blank the geometry and force a rebuild, mirroring the
    size-cap handling in ``_restore_geological_models``.  ``None`` and empty
    arrays are valid — a surface with no geometry is a legitimate
    not-yet-built state — but any *present* value that is not a well-formed
    list is rejected.

    Parameters
    ----------
    vertices : object
        Candidate vertex array from the bundle. Expected to be ``None`` (not
        yet built) or a list of 3-element ``[x, y, z]`` numeric sequences,
        but typed ``object`` because the value is untrusted and may be any
        JSON shape.
    triangles : object
        Candidate triangle array from the bundle. Expected to be ``None`` or
        a list of 3-element ``[i, j, k]`` integer index sequences
        referencing ``vertices``.

    Returns
    -------
    bool
        ``True`` when both arrays are well-formed (``None`` / empty count as
        well-formed); ``False`` on the first structural defect found.
    """
    # ``None`` is "no geometry provided" — a legitimate not-yet-built
    # surface, distinct from a present-but-malformed value. Treat as empty.
    if vertices is None:
        vertices = []
    if triangles is None:
        triangles = []
    if not isinstance(vertices, list) or not isinstance(triangles, list):
        return False

    for vertex in vertices:
        if not isinstance(vertex, (list, tuple)) or len(vertex) != 3:
            return False
        for coord in vertex:
            # ``bool`` is an ``int`` subclass — exclude it so True/False
            # coordinates do not slip through the numeric check.
            if isinstance(coord, bool) or not isinstance(coord, (int, float)):
                return False
            # NaN / ±inf are valid floats that pass the type check but yield
            # silent garbage geometry downstream — reject so the surface is
            # blanked + rebuilt from contacts instead.
            if not math.isfinite(coord):
                return False

    vertex_count = len(vertices)
    for triangle in triangles:
        if not isinstance(triangle, (list, tuple)) or len(triangle) != 3:
            return False
        for index in triangle:
            # Must be a real int (a float index crashes list indexing) and
            # must address an existing vertex (negatives wrap silently).
            if isinstance(index, bool) or not isinstance(index, int):
                return False
            if index < 0 or index >= vertex_count:
                return False

    return True


def _cap(
    items: list[Any],
    cap: int,
    label: str,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
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
    drops : BundleRestoreDrops | None, optional
        When provided, the number of dropped rows (``len - cap``) is added to
        its ``borehole_child_rows_dropped`` counter so the restore response can
        surface it (production-readiness audit L6). ``None`` for callers that
        do not track drops.

    Returns
    -------
    list[Any]
        ``items`` unchanged when within the cap, else the first ``cap`` entries.
    """
    if len(items) > cap:
        logger.warning(f"restore: {label} has {len(items)} entries — capping to {cap} (debt #112)")
        if drops is not None:
            drops.borehole_child_rows_dropped += len(items) - cap
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
    data: dict[str, Any],
    app_project_id: UUID,
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
    deferred_sample_body_links: dict[UUID, UUID] | None = None,
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
    drops : BundleRestoreDrops | None, optional
        Threaded to every ``_cap`` call so dropped-row counts across the whole
        child tree accumulate into one tally (production-readiness audit L6).

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
        drops,
    )
    field_log_intervals = _cap(
        data.get("field_log_intervals") or [],
        _MAX_BOREHOLE_FIELD_LOG_INTERVALS,
        f"field_log_intervals on borehole {bh_label}",
        logger,
        drops,
    )
    observations = _cap(
        data.get("observations") or [],
        _MAX_BOREHOLE_OBSERVATIONS,
        f"observations on borehole {bh_label}",
        logger,
        drops,
    )
    samples = _cap(
        data.get("samples") or [],
        _MAX_BOREHOLE_SAMPLES,
        f"samples on borehole {bh_label}",
        logger,
        drops,
    )

    bh_kwargs = _apply_json_to_kwargs(BoreholeOrm, data)
    bh = BoreholeOrm(app_project_id=app_project_id, **bh_kwargs)
    bh.location = _make_location(bh.location_x, bh.location_y, bh.epsg)  # type: ignore[assignment]

    # Local imports to dodge circular references — each leaf class lives
    # alongside its own ORM module, and importing them at module top
    # would balloon the import graph for callers that never restore.
    # (The six lab-test leaf classes now ride in via LAB_TEST_FAMILIES.)
    from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
    from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
    from groundmodel.infrastructure.db.models.field_log_interval_orm import (
        FieldLogIntervalOrm,
    )

    bh.drill_segments = [
        DrillSegmentOrm(**_apply_json_to_kwargs(DrillSegmentOrm, d)) for d in drill_segments
    ]
    bh.field_log_intervals = [
        FieldLogIntervalOrm(**_apply_json_to_kwargs(FieldLogIntervalOrm, d))
        for d in field_log_intervals
    ]
    bh.observations = [
        _build_observation(obs_data, AdmixtureOrm, logger=logger, drops=drops)
        for obs_data in observations
    ]
    bh.samples = [
        _build_sample(
            sample_data,
            logger=logger,
            drops=drops,
            deferred_sample_body_links=deferred_sample_body_links,
        )
        for sample_data in samples
    ]
    return bh


def _build_observation(
    data: dict[str, Any],
    admixture_cls: type[Any],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
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
    drops : BundleRestoreDrops | None, optional
        Threaded to the layer cap so dropped rows accumulate into the tally (L6).

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
        drops,
    )
    obs = ObservationOrm(**_apply_json_to_kwargs(ObservationOrm, data))
    obs.layers = [
        _build_layer(layer_data, admixture_cls, logger=logger, drops=drops)
        for layer_data in layers_payload
    ]
    return obs


def _build_layer(
    data: dict[str, Any],
    admixture_cls: type[Any],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
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
    drops : BundleRestoreDrops | None, optional
        Threaded to the admixture cap so dropped rows accumulate into the tally (L6).

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
        drops,
    )
    layer = ObservationLayerOrm(**_apply_json_to_kwargs(ObservationLayerOrm, data))
    layer.admixtures = [
        admixture_cls(**_apply_json_to_kwargs(admixture_cls, a)) for a in admixtures_payload
    ]
    return layer


def _build_sample(
    data: dict[str, Any],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
    deferred_sample_body_links: dict[UUID, UUID] | None = None,
) -> SampleOrm:
    """Construct a ``SampleOrm`` with all six lab-test family children.

    Each lab-test family is its own child array; all are capped (debt
    #112, F2) before building ORM instances. The family list (name +
    leaf ORM class) comes from the shared ``LAB_TEST_FAMILIES``
    registry, so a new typed family needs no edit here.

    Parameters
    ----------
    data : dict[str, Any]
        Raw sample payload from the bundle, carrying nested arrays for
        each lab-test family.
    logger : GroundModelLogger
        Caller's logger (cap warnings).
    drops : BundleRestoreDrops | None, optional
        Threaded to each lab-test-family cap so dropped rows accumulate into the
        tally (L6).

    Returns
    -------
    SampleOrm
        Constructed ORM instance with all lab-test children attached.
    """
    kwargs = _apply_json_to_kwargs(SampleOrm, data)
    # Defer the body FK (the cross_section.companion_body_id rule): bodies restore
    # in Phase 8, samples in Phase 2, and a saved file may carry a stamp whose
    # body was re-minted since. The core re-attaches valid stamps after Phase 8.
    stamp = kwargs.pop("geotech_body_id", None)
    if (
        stamp is not None
        and deferred_sample_body_links is not None
        and kwargs.get("id") is not None
    ):
        deferred_sample_body_links[UUID(str(kwargs["id"]))] = UUID(str(stamp))
    sample = SampleOrm(**kwargs)
    sample_label = data.get("id", "?")
    for rel_name, orm_cls in LAB_TEST_FAMILIES:
        setattr(
            sample,
            rel_name,
            [
                orm_cls(**_apply_json_to_kwargs(orm_cls, d))
                for d in _cap(
                    data.get(rel_name) or [],
                    _MAX_SAMPLE_LAB_TESTS,
                    f"{rel_name} on sample {sample_label}",
                    logger,
                    drops,
                )
            ],
        )
    return sample
