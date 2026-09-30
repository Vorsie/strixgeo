"""The raw lab-series family round-trips through the .strix bundle (no DB).

Backwards-compat rules (docs/backwards-compat.md): additive only, no
``format_version`` bump. So (1) a test tree serialised and rebuilt comes back
value for value — every reading, every timestamp, the derived strain with its
formula, the lab-reported rows; (2) a sample payload WITHOUT the new key (every
bundle written before the family existed) rebuilds with no test and no error;
(3) the restore caps a crafted over-long channel instead of allocating it.
"""

from __future__ import annotations

import json
from pathlib import Path

from groundmodel.application.lab_series_tree_builder import build_lab_series_test
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle import bundle_lab_series as bls
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_reader import (
    LabExportReader,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

_LAB = Path(__file__).resolve().parents[3] / "fixtures" / "lab"
_LOG = LoggerFactory.get_logger(__name__)


def _test(relative: str):
    """Build the ORM tree of a fixture."""
    raw = (_LAB / relative).read_bytes()
    return build_lab_series_test(
        LabExportReader().read(raw, source_name=relative),
        source_file_name=Path(relative).name,
        source_sha256="abc",
    )


def _flatten(test) -> list:
    """Every stored value of a tree, in order, for an equality check."""
    out: list = [test.lab_sample_number, test.source_sha256, test.import_issues]
    for sp in test.specimens:
        out += [sp.specimen_label, sp.initial_height_mm, sp.n_points]
        for st in sp.stages:
            out += [st.stage_index, st.reading_timestamps, st.point_numbers, st.rezero_indices]
            for ch in st.channels:
                out += [ch.channel_key, ch.provenance, ch.unit, ch.formula, ch.series_values]
                out += [ch.derivation_inputs]
    out += [(r.parameter, r.value_numeric, r.value_text, r.stage_index) for r in test.lab_results]
    return out


def _round_trip(test):
    """Serialise one test into a sample payload, through JSON, and rebuild it."""
    payload = json.loads(
        json.dumps({"id": "s", bls.LAB_SERIES_BUNDLE_KEY: [bls.lab_series_test_to_dict(test)]})
    )
    [rebuilt] = bls.build_lab_series_tests(payload, logger=_LOG)
    return rebuilt


def test_an_oedometer_test_round_trips_value_for_value() -> None:
    """20/0569 (re-zero stages, derived strain, lab summary) comes back identical."""
    test = _test("oedometer/200569B7-LstSMControleListing.txt")
    assert _flatten(_round_trip(test)) == _flatten(test)


def test_a_triaxial_test_round_trips_value_for_value() -> None:
    """tx_cu (two specimens, point-number axis, lab-derived channels) comes back identical."""
    test = _test("triaxial/tx_cu.txt")
    assert _flatten(_round_trip(test)) == _flatten(test)


def test_a_bundle_written_before_the_family_restores_with_no_test() -> None:
    """A sample payload without ``lab_series_tests`` rebuilds to nothing."""
    assert bls.build_lab_series_tests({"id": "s", "grain_sizes": []}, logger=_LOG) == []


def test_restore_attaches_trees_to_the_matching_samples_only() -> None:
    """The borehole-level attach walks samples by id: a sample with tests gets
    them, a sample without keeps none."""
    test = _test("oedometer/200568B7-LstSMControleListing.txt")
    s1 = SampleOrm(id="00000000-0000-0000-0000-000000000001")
    s2 = SampleOrm(id="00000000-0000-0000-0000-000000000002")
    borehole = BoreholeOrm(id="00000000-0000-0000-0000-0000000000bb")
    borehole.samples = [s1, s2]
    payload = {
        "samples": [
            {"id": str(s1.id), bls.LAB_SERIES_BUNDLE_KEY: [bls.lab_series_test_to_dict(test)]},
            {"id": str(s2.id)},
        ]
    }
    assert bls.attach_lab_series_trees(borehole, payload, logger=_LOG) == 1
    assert len(s1.lab_series_tests) == 1 and s2.lab_series_tests == []


def test_an_over_long_channel_is_dropped_on_restore() -> None:
    """A crafted channel longer than the readings cap is dropped, not allocated."""
    test = _test("oedometer/200568B7-LstSMControleListing.txt")
    data = bls.lab_series_test_to_dict(test)
    channel = data["specimens"][0]["stages"][0]["channels"][0]
    channel["series_values"] = [0.0] * (bls.MAX_LAB_SERIES_READINGS_PER_STAGE + 1)
    [rebuilt] = bls.build_lab_series_tests(
        {"id": "s", bls.LAB_SERIES_BUNDLE_KEY: [data]}, logger=_LOG
    )
    keys = [c.channel_key for c in rebuilt.specimens[0].stages[0].channels]
    assert channel["channel_key"] not in keys
