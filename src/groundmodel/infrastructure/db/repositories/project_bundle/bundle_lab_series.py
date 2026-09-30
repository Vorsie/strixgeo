"""Bundle (.strix) serialise + restore for the raw lab-series family.

The six older lab families are flat leaf rows and ride the shared
``LAB_TEST_FAMILIES`` registry. The raw lab-series family nests four levels
(test → specimens → stages → channels, plus the test's lab results), so it
gets its own functions. They attach one level ABOVE the flat sample helpers
(the bundle build adds each sample's tests to the borehole payload; the
restore attaches the built trees to the borehole's samples) so the
serialise / row-builder modules stay free of an import cycle.

Additive: a sample payload WITHOUT ``lab_series_tests``
(every bundle written before this family existed) restores with none — no
``format_version`` bump (backwards-compat.md).

Restore is a trust boundary (a ``.strix`` is user-supplied), so every nested
array is capped and every channel longer than its stage's readings cap is
dropped with a warning, like the CPT series cap (debt #112).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.lab_series_channel_orm import LabSeriesChannelOrm
from groundmodel.infrastructure.db.models.lab_series_lab_result_orm import (
    LabSeriesLabResultOrm,
)
from groundmodel.infrastructure.db.models.lab_series_specimen_orm import LabSeriesSpecimenOrm
from groundmodel.infrastructure.db.models.lab_series_stage_orm import LabSeriesStageOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_restore_drops import BundleRestoreDrops
from .bundle_row_builders import _cap
from .bundle_serialization import _SKIP_COLUMNS, _apply_json_to_kwargs, _column_to_json

# Bundle key on each sample payload.
LAB_SERIES_BUNDLE_KEY = "lab_series_tests"

# Restore caps (debt #112 pattern). Far above any real test: a triaxial test
# has 3 specimens × 1 shear stage × ~13 channels × ~1 100 points; an oedometer
# 1 specimen × ~20 stages × ~8 channels × ≤ 1 500 readings.
MAX_LAB_SERIES_TESTS_PER_SAMPLE = 200
MAX_LAB_SERIES_SPECIMENS_PER_TEST = 50
MAX_LAB_SERIES_STAGES_PER_SPECIMEN = 500
MAX_LAB_SERIES_CHANNELS_PER_STAGE = 64
MAX_LAB_SERIES_READINGS_PER_STAGE = 200_000
MAX_LAB_SERIES_RESULTS_PER_TEST = 10_000


def lab_series_eager_load_options() -> list[Any]:
    """Loader options that bring every sample's lab-series tree along.

    Appended to ``borehole_full_tree_options()`` by the bundle build ONLY: the
    borehole detail endpoints never load the channel arrays (far too heavy for
    the section-open path).

    Returns
    -------
    list
        ``selectinload`` chains rooted at ``BoreholeOrm.samples``.
    """
    tests = selectinload(BoreholeOrm.samples).selectinload(SampleOrm.lab_series_tests)
    return [
        tests.selectinload(LabSeriesTestOrm.specimens)
        .selectinload(LabSeriesSpecimenOrm.stages)
        .selectinload(LabSeriesStageOrm.channels),
        selectinload(BoreholeOrm.samples)
        .selectinload(SampleOrm.lab_series_tests)
        .selectinload(LabSeriesTestOrm.lab_results),
    ]


def attach_lab_series_payloads(bh_payload: dict[str, Any], borehole: BoreholeOrm) -> None:
    """Add ``lab_series_tests`` to every sample dict of a borehole payload.

    Parameters
    ----------
    bh_payload : dict[str, Any]
        The borehole's bundle dict (``samples`` already serialised).
    borehole : BoreholeOrm
        The same borehole with :func:`lab_series_eager_load_options` applied.
    """
    by_id = {str(s.id): s for s in borehole.samples}
    for sample_payload in bh_payload.get("samples") or []:
        sample = by_id.get(str(sample_payload.get("id")))
        tests = sample.lab_series_tests if sample is not None else []
        sample_payload[LAB_SERIES_BUNDLE_KEY] = [lab_series_test_to_dict(t) for t in tests]


def attach_lab_series_trees(
    borehole: BoreholeOrm,
    bh_payload: dict[str, Any],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
) -> int:
    """Build and attach every sample's lab-series tests on restore.

    Parameters
    ----------
    borehole : BoreholeOrm
        The transient borehole ``_build_borehole`` returned (samples built).
    bh_payload : dict[str, Any]
        Its bundle dict.
    logger : GroundModelLogger
        Caller's logger.
    drops : BundleRestoreDrops or None
        Tally of capped rows.

    Returns
    -------
    int
        Number of tests attached (0 for a bundle written before the family).
    """
    payload_by_id = {
        str(s.get("id")): s for s in bh_payload.get("samples") or [] if s.get("id") is not None
    }
    attached = 0
    for sample in borehole.samples:
        sample_payload = payload_by_id.get(str(sample.id))
        if not sample_payload or not sample_payload.get(LAB_SERIES_BUNDLE_KEY):
            continue
        sample.lab_series_tests = build_lab_series_tests(sample_payload, logger=logger, drops=drops)
        attached += len(sample.lab_series_tests)
    if attached:
        logger.debug(f"restore: {attached} lab-series test(s) on borehole {borehole.id}")
    return attached


def lab_series_test_to_dict(test: LabSeriesTestOrm) -> dict[str, Any]:
    """Serialise one test with its specimens, stages, channels and lab results.

    Parameters
    ----------
    test : LabSeriesTestOrm
        A test with ``specimens → stages → channels`` and ``lab_results``
        eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly nested dict (timestamps as ISO strings).
    """
    payload = _column_to_json(test, _SKIP_COLUMNS | {"sample_id"})
    payload["specimens"] = [
        {
            **_column_to_json(specimen, _SKIP_COLUMNS | {"test_id"}),
            "stages": [
                {
                    **_column_to_json(stage, _SKIP_COLUMNS | {"specimen_id"}),
                    "channels": [
                        _column_to_json(channel, _SKIP_COLUMNS | {"stage_id"})
                        for channel in stage.channels
                    ],
                }
                for stage in specimen.stages
            ],
        }
        for specimen in test.specimens
    ]
    payload["lab_results"] = [
        _column_to_json(row, _SKIP_COLUMNS | {"test_id"}) for row in test.lab_results
    ]
    return payload


def build_lab_series_tests(
    sample_payload: dict[str, Any],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
) -> list[LabSeriesTestOrm]:
    """Construct the lab-series trees of one sample payload (capped).

    Parameters
    ----------
    sample_payload : dict[str, Any]
        The sample's bundle dict; ``lab_series_tests`` may be absent (an older
        bundle) — then no test is built.
    logger : GroundModelLogger
        Caller's logger (cap warnings).
    drops : BundleRestoreDrops or None
        Tally of dropped rows (audit L6).

    Returns
    -------
    list[LabSeriesTestOrm]
        Transient ORM trees ready to attach to the sample.
    """
    label = sample_payload.get("id", "?")
    tests_payload = _cap(
        list(sample_payload.get(LAB_SERIES_BUNDLE_KEY) or []),
        MAX_LAB_SERIES_TESTS_PER_SAMPLE,
        f"lab_series_tests on sample {label}",
        logger,
        drops,
    )
    return [_build_test(t, logger=logger, drops=drops) for t in tests_payload]


def _build_test(
    data: dict[str, Any], *, logger: GroundModelLogger, drops: BundleRestoreDrops | None
) -> LabSeriesTestOrm:
    """Build one test tree from its payload."""
    test = LabSeriesTestOrm(**_apply_json_to_kwargs(LabSeriesTestOrm, data))
    tid = data.get("id", "?")
    specimens = _cap(
        list(data.get("specimens") or []),
        MAX_LAB_SERIES_SPECIMENS_PER_TEST,
        f"specimens on lab-series test {tid}",
        logger,
        drops,
    )
    test.specimens = [_build_specimen(s, logger=logger, drops=drops) for s in specimens]
    results = _cap(
        list(data.get("lab_results") or []),
        MAX_LAB_SERIES_RESULTS_PER_TEST,
        f"lab results on lab-series test {tid}",
        logger,
        drops,
    )
    test.lab_results = [
        LabSeriesLabResultOrm(**_apply_json_to_kwargs(LabSeriesLabResultOrm, r)) for r in results
    ]
    return test


def _build_specimen(
    data: dict[str, Any], *, logger: GroundModelLogger, drops: BundleRestoreDrops | None
) -> LabSeriesSpecimenOrm:
    """Build one specimen with its stages."""
    specimen = LabSeriesSpecimenOrm(**_apply_json_to_kwargs(LabSeriesSpecimenOrm, data))
    stages = _cap(
        list(data.get("stages") or []),
        MAX_LAB_SERIES_STAGES_PER_SPECIMEN,
        f"stages on lab-series specimen {data.get('id', '?')}",
        logger,
        drops,
    )
    specimen.stages = [_build_stage(s, logger=logger, drops=drops) for s in stages]
    return specimen


def _build_stage(
    data: dict[str, Any], *, logger: GroundModelLogger, drops: BundleRestoreDrops | None
) -> LabSeriesStageOrm:
    """Build one stage with its channels; parse the timestamp array.

    ``_apply_json_to_kwargs`` parses a scalar datetime column but not an ARRAY
    of datetimes (the column's python type is ``list``), so the timestamps are
    parsed here. An over-long channel is dropped, never truncated: a
    truncated series would silently misalign with the reading axis.
    """
    kwargs = _apply_json_to_kwargs(LabSeriesStageOrm, data)
    stamps = kwargs.get("reading_timestamps")
    if stamps is not None:
        kwargs["reading_timestamps"] = [
            datetime.fromisoformat(s) if isinstance(s, str) else s for s in stamps
        ]
    stage = LabSeriesStageOrm(**kwargs)
    sid = data.get("id", "?")
    channels = _cap(
        list(data.get("channels") or []),
        MAX_LAB_SERIES_CHANNELS_PER_STAGE,
        f"channels on lab-series stage {sid}",
        logger,
        drops,
    )
    built: list[LabSeriesChannelOrm] = []
    for c in channels:
        values = c.get("series_values") or []
        if len(values) > MAX_LAB_SERIES_READINGS_PER_STAGE:
            logger.warning(
                f"restore: lab-series channel {c.get('channel_key')!r} on stage {sid} has "
                f"{len(values)} values (cap {MAX_LAB_SERIES_READINGS_PER_STAGE}) — dropped"
            )
            if drops is not None:
                drops.borehole_child_rows_dropped += 1
            continue
        built.append(LabSeriesChannelOrm(**_apply_json_to_kwargs(LabSeriesChannelOrm, c)))
    stage.channels = built
    return stage
