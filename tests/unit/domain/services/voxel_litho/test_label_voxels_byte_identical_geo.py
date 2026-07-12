"""Byte-identical snapshot pin for the geology-bounded ``label_voxels`` path.

This is the end-to-end safety net for the per-column geo-surface-elevation
cache + per-section projection/stack hoist (a PURE-SPEED refactor).  The
optimisation removes ~12.9 M redundant ``evaluate_tin_at`` calls by computing
each surface elevation (and each section's projection + full stack) ONCE per
column instead of per band per section — but it MUST compute the same labels.

The pin is a SHA-256 of the full ``labels`` array over a representative
geology-bounded fixture (deep ZAND-over-KLEI + shallow ZAND-only sections, a
flat geological surface at -5 m, an honored borehole, anisotropic 2 m / 1 m
voxels — exercising the band-extent + reach-filter + clip + blend + void-fill +
honor-fallback + surface-clamp paths the refactor touches).  The hash was
captured from the pre-refactor implementation; if any voxel label changes, the
hash diverges and this test fails — proving byte-identity was broken.

To regenerate after an INTENTIONAL output change (there should be none for a
pure-speed refactor): run the fixture through ``label_voxels`` and print
``hashlib.sha256(labels.tobytes()).hexdigest()``.
"""

from __future__ import annotations

import hashlib

import numpy as np

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.surface_bound import SurfaceBound
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# SHA-256 of ``labels.astype(int32).tobytes()`` captured on the fixture below.
# Any drift breaks byte-identity.
#
# Re-baselined when the footprint gate became boundary-inclusive (a grid cell
# whose centre sits on/near a hull edge now labels — see
# ``ModelDomain.contains(..., tol=...)``): the rectangular fixture's edge
# columns (x=0, x=80, and the y edges) previously got voided by strict
# point-in-polygon parity even though the labeller produced a full stack for
# them. The non-void count therefore rose (27000 → 28782 = the recovered
# boundary corridor); the shape and body set are unchanged.
_BASELINE_LABELS_SHA256 = "3c353d8b7219f510e85dcd76c2b5dabcd64af0945cd39221d65e5209f1d1ff71"
_BASELINE_SHAPE = (41, 26, 28)
_BASELINE_NONVOID = 28782
_BASELINE_BODIES = ("kleiDeep", "zandDeep", "zandShallow")


def _flat_geo(elev: float) -> SurfaceBound:
    """A flat geological surface at constant elevation spanning the footprint."""
    return SurfaceBound(
        vertices=[(-1000.0, -1000.0, elev), (2000.0, -1000.0, elev), (0.0, 2000.0, elev)],
        triangles=[(0, 1, 2)],
    )


def _deep_section(y: float, prefix: str) -> SectionPartitionInput:
    """DEEP section: ZAND in the upper band over KLEI in the lower band."""
    columns = (
        SectionColumnInput(f"{prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_ZAND, "zandDeep", ((0.0, 12.0), (1.0, 12.0), (1.0, -5.0), (0.0, -5.0)), 0),
        RegionInput(_KLEI, "kleiDeep", ((0.0, -5.0), (1.0, -5.0), (1.0, -15.0), (0.0, -15.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def _shallow_section(y: float, prefix: str, base: float) -> SectionPartitionInput:
    """SHALLOW section: ZAND only, stopping above the geological surface."""
    columns = (
        SectionColumnInput(f"{prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_ZAND, "zandShallow", ((0.0, 12.0), (1.0, 12.0), (1.0, base), (0.0, base)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


_KLEI = "KLEI"
_ZAND = "ZAND"


def _build_geo_bounded_grid():
    """Build the representative geology-bounded grid the snapshot pins."""
    tests = [
        DomainTest("F0", 0.0, -5.0, 10.0, -10.0),
        DomainTest("Fmid", 40.0, -5.0, 10.0, -10.0),
        DomainTest("F1", 80.0, -5.0, 10.0, -10.0),
        DomainTest("G0", 0.0, 45.0, 10.0, -10.0),
        DomainTest("Gmid", 40.0, 45.0, 10.0, -10.0),
        DomainTest("G1", 80.0, 45.0, 10.0, -10.0),
    ]
    domain = build_model_domain(tests)
    sections = [_deep_section(0.0, "D"), _shallow_section(40.0, "S", base=-1.0)]
    surfaces = (_flat_geo(-5.0),)
    borehole = InvestigationColumn(
        investigation_id="BH1",
        world_x=40.0,
        world_y=40.0,
        intervals=(("zandShallow", "ZAND", 12.0, -1.0),),
    )
    return label_voxels(
        domain,
        2.0,
        sections,
        vertical_spacing_m=1.0,
        investigation_columns=(borehole,),
        geo_surfaces=surfaces,
        litho_snap_tolerance_m=0.20,
    )


def test_geo_bounded_labels_are_byte_identical_to_baseline() -> None:
    """The geology-bounded labels array hashes to the pre-refactor snapshot.

    A pure-speed refactor (caching geo-surface elevations + hoisting per-section
    projection out of the per-band loop) MUST leave every voxel label unchanged.
    The SHA-256 of the full labels array is the byte-identical witness: a single
    mislabelled voxel changes the hash and fails this test.
    """
    grid = _build_geo_bounded_grid()
    digest = hashlib.sha256(np.ascontiguousarray(grid.labels, dtype=np.int32).tobytes()).hexdigest()
    assert grid.labels.shape == _BASELINE_SHAPE
    assert int((grid.labels >= 0).sum()) == _BASELINE_NONVOID
    assert grid.body_id_by_index == _BASELINE_BODIES
    assert digest == _BASELINE_LABELS_SHA256, (
        "geology-bounded labels diverged from the pre-refactor baseline — "
        "byte-identity broken by the speed refactor"
    )
