"""Golden parity harness — ``compute_section_fill`` vs the TS ``computeSectionFill``.

Each golden JSON under ``tests/unit/fixtures/partition_goldens/`` was generated
by running the TypeScript ``computeSectionFill`` (``partitionFill.ts``) on a
small synthetic section and recording its exact region output (6-decimal
rounded).  The Python port must reproduce every region EXACTLY — same count,
same order, same identity fields, polygons equal pointwise within ``1e-5``.

Parity is the contract: when a golden diverges, the PORT is wrong — fix the
port, never the fixture.

Known artefact the port must PRESERVE: the ``onlap_one_corr`` CLAY polygon
contains a consecutive duplicate point — a zero-length edge where the onlap
notch meets the matrix top.  ``insertNotches`` emits it by design (the notch's
near point coincides with the edge vertex it follows); normalising it away
would be a port divergence, not an improvement.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.services.section_partition import (
    CorrelationEdge,
    PartitionColumn,
    PartitionUnit,
    compute_section_fill,
)

GOLDEN_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "partition_goldens"

# One golden per termination path: band (2 correlated contacts), onlap (1),
# lens (0), and the re-entrant same-body split (monotonic matching blocks the
# pre-interbed occurrence). Together they exercise the carve pipeline too —
# the onlap and lens fixtures both notch their matrix quad.
GOLDEN_NAMES = [
    "band_two_columns",
    "onlap_one_corr",
    "lens_zero_corr",
    "reentrant_same_body",
]


def _load_golden(name: str) -> dict[str, Any]:
    """Read one golden fixture JSON by name."""
    return json.loads((GOLDEN_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _columns_from_json(raw_columns: list[dict[str, Any]]) -> list[PartitionColumn]:
    """Build ``PartitionColumn`` inputs from the golden's camelCase JSON shape."""
    return [
        PartitionColumn(
            investigation_id=c["investigationId"],
            surface_elev_m=c["surfaceElevM"],
            units=tuple(
                PartitionUnit(
                    top_depth_m=u["topDepthM"],
                    base_depth_m=u["baseDepthM"],
                    formation_id=u["formationId"],
                    body_id=u["bodyId"],
                    layer_id=u["layerId"],
                )
                for u in c["units"]
            ),
        )
        for c in raw_columns
    ]


@pytest.mark.parametrize("name", GOLDEN_NAMES)
def test_compute_section_fill_matches_ts_golden(name: str) -> None:
    """The port reproduces the TS region output region-by-region, in order."""
    golden = _load_golden(name)
    columns = _columns_from_json(golden["columns"])
    edges = [CorrelationEdge(a=e["a"], b=e["b"]) for e in golden["edges"]]

    actual = compute_section_fill(columns, edges)
    expected = golden["regions"]

    assert len(actual) == len(expected), (
        f"{name}: region count {len(actual)} != golden {len(expected)}"
    )
    for idx, (act, exp) in enumerate(zip(actual, expected, strict=True)):
        ctx = f"{name} region[{idx}]"
        assert act.body_id == exp["bodyId"], ctx
        assert act.formation_id == exp["formationId"], ctx
        assert act.kind == exp["kind"], ctx
        assert act.gap_index == exp["gapIndex"], ctx
        # overlayTier is PRESENT only on kind=='lens' overlay regions in the
        # golden; mains leave it absent → the port must leave it None.
        assert act.overlay_tier == exp.get("overlayTier"), ctx
        exp_polygon = exp["polygon"]
        assert len(act.polygon) == len(exp_polygon), (
            f"{ctx}: polygon vertex count {len(act.polygon)} != {len(exp_polygon)}\n"
            f"actual: {[(p.fraction, p.elevation) for p in act.polygon]}\n"
            f"golden: {[(p['fraction'], p['elevation']) for p in exp_polygon]}"
        )
        for p_idx, (ap, ep) in enumerate(zip(act.polygon, exp_polygon, strict=True)):
            # The golden JSONs are 6-decimal-rounded, so pointwise abs=1e-5.
            assert ap.fraction == pytest.approx(ep["fraction"], abs=1e-5), (
                f"{ctx} point[{p_idx}] fraction"
            )
            assert ap.elevation == pytest.approx(ep["elevation"], abs=1e-5), (
                f"{ctx} point[{p_idx}] elevation"
            )
