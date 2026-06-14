"""Litho-3D implicit strat-field lens-carve performance benchmarks.

Run with::

    uv run pytest tests/benchmarks/bench_lens_carve.py --benchmark-enable -v

:func:`~groundmodel.domain.services.strat_field.lens_carving.carve_lenses` is the
final stage of the implicit stratigraphic 3-D builder: AFTER the matrix bodies are
assembled it carves each enclosed lens back into its host, splitting the host into
two height-field prisms straddling the lens prism so a column through the lens reads
HOST / LENS / HOST (the ``test.strix`` KLEI / SILT / KLEI over-merge signature).

Why this benchmark exists
-------------------------
The carve was the dominant real-data hotspot.  Resolving a carved host's
single-valued ``(top, base)`` height field used to mean an
O(grid_nodes × triangles) vertical RAY-CAST per host
(``_prism_height_fields``); on the real ``test.strix`` model that carve ran
~410 s.  The fast path threads the per-node ``(top, base)`` arrays that body
assembly already computed (``build_strat_model_with_fields`` /
``assemble_bodies_with_fields``) into ``carve_lenses(..., host_height_fields=...)``,
so each chosen host is an O(nodes) dict lookup + copy instead of a ray-cast — the
~410 s → seconds win.  This bench (a) captures the fast path so a regression shows
up as a wall-clock jump, and (b) records the slow ray-cast fallback at one spacing
so the saved baseline documents the speedup ratio.

What is timed (and what is NOT)
-------------------------------
The PRIMARY measurement is ``carve_lenses`` alone — the matrix meshes, the host
height fields, the ``LensCarveInput`` list, and the shared grid are all built ONCE
OUTSIDE the timing loop (mirroring the production wiring in
``RecomputeLithoSolids``: ``build_strat_model_with_fields`` → ``build_lens_carve_inputs``
→ ``build_shared_grid`` → ``carve_lenses``).  Measuring the carve in isolation is
the point — the field fit + matrix assembly are already covered by
``bench_litho_solid_builder.py``, and conflating them would hide a carve-only
regression.

Tiers
-----
* ``carve-threaded`` at coarse-5m / medium-2m / fine-1m — the production FAST path
  (``host_height_fields`` threaded).  The same three spacings as
  ``bench_litho_solid_builder`` so the two read against each other; spacing is the
  dominant cost driver (node count ≈ hull_area / spacing²).
* ``raycast-fallback-5m`` — the SLOW path (``host_height_fields=None``) at COARSE
  spacing ONLY.  This reconstructs each carved host by ray-cast — the path the
  optimisation removed.  Run only at 5 m because at medium / fine it would take
  minutes (it is the O(grid_nodes × triangles) cost we eliminated); one coarse
  data point is enough to document the threaded-vs-raycast speedup ratio in the
  saved baseline.
* ``build-plus-carve-2m`` — an optional end-to-end tier
  (``build_strat_model_with_fields`` + ``build_lens_carve_inputs`` + ``carve_lenses``)
  at medium spacing, capturing the realistic build-with-lenses wall-time the user
  sees on a Build click.  The carve-only tiers stay the primary deliverable.

Fixture
-------
``widely_spaced_enclosed_lens_carve_fixture`` — seven investigations at Lambert-72
magnitude (x ≈ 150 000 m), irregularly spaced 100–300 m apart over a
~680 m × ~700 m footprint (the same ``_WIDE_SPECS`` footprint the matrix-build
bench uses), carrying a ZAND / KLEI / SILT / KLEI / ZAND stack where ONE
``klei_host`` instance_key brackets the SILT minority above AND below — a genuine
depth-1 enclosed lens that ``classify_lenses`` recognises (asserted in the
fixture).  This is the real-data shape — NOT a tiny compact layer-cake — so the
carve's per-host field-resolution cost (the thing the optimisation targets) is
exercised at the real coordinate magnitude and grid node count.

Sanity assertions
------------------
Each timed call is followed by a sanity check (outside the timing window):

* the carve result is non-empty;
* no body is flagged (``is_flagged is False``) — the carve never flags;
* the lens body (``lens:`` id) is present — proves the carve actually carved;
* every body has at least one triangle — no degenerate mesh.

Baseline numbers land in CLAUDE.local.md after a stable run (see the
"Litho-3D implicit strat-field LENS CARVE" section there).
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.strat_field.body_assembly import build_shared_grid
from groundmodel.domain.services.strat_field.lens_carving import carve_lenses
from groundmodel.domain.services.strat_field.lens_geometry import build_lens_carve_inputs
from groundmodel.domain.services.strat_field.strat_builder import build_strat_model_with_fields
from tests.unit.domain.services.strat_field.fixtures import (
    widely_spaced_enclosed_lens_carve_fixture,
)


def _carve_setup(spacing_m: float) -> tuple:
    """Build everything the carve consumes, OUTSIDE the timing loop.

    Mirrors the production wiring in ``RecomputeLithoSolids``: fit the matrix
    field + assemble its bodies (exposing the per-body height fields), build the
    lens carve inputs from the lens's picks, and rebuild the shared grid.  Only
    the final ``carve_lenses`` call is timed by the bench.

    Parameters
    ----------
    spacing_m : float
        Grid spacing in metres for the matrix assembly + the shared grid (the
        carve must use the SAME grid the matrix was built on).

    Returns
    -------
    tuple
        ``(lens_carve_inputs, meshes, gx, gy, node_inside, host_height_fields)`` —
        the positional + keyword arguments of ``carve_lenses``.
    """
    control, domain, partition, picks_by_body = widely_spaced_enclosed_lens_carve_fixture()
    meshes, host_height_fields = build_strat_model_with_fields(control, domain, [domain], spacing_m)
    lens_carve_inputs = build_lens_carve_inputs(partition, picks_by_body, domain, spacing_m)
    gx, gy, node_inside = build_shared_grid(domain, spacing_m)
    return lens_carve_inputs, meshes, gx, gy, node_inside, host_height_fields


def _assert_carve_sane(bodies: list, spacing_m: float) -> None:
    """Assert the carve produced a real, non-degenerate, lens-bearing model.

    Run OUTSIDE the timing window.  Checks the carve did real work (non-empty,
    a lens prism present), never flagged a body, and emitted no zero-triangle mesh.

    Parameters
    ----------
    bodies : list of LithoBodyMesh
        The ``carve_lenses`` output.
    spacing_m : float
        The grid spacing of this run (for assertion messages).
    """
    assert bodies, f"carve_lenses at spacing={spacing_m} m returned no bodies"
    assert any(b.body_id.startswith("lens:") for b in bodies), (
        f"carve_lenses at spacing={spacing_m} m emitted no lens body — the carve did "
        "not run (fixture lost its enclosed lens?)"
    )
    for body in bodies:
        assert body.is_flagged is False, (
            f"body {body.body_id!r} is flagged — carve_lenses never flags a body"
        )
        assert len(body.triangles) > 0, (
            f"body {body.body_id!r} has zero triangles at spacing={spacing_m} m"
        )


@pytest.mark.parametrize(
    "spacing_m",
    [20.0, 5.0, 2.0, 1.0],
    ids=["carve-threaded-20m", "carve-threaded-5m", "carve-threaded-2m", "carve-threaded-1m"],
)
def test_bench_carve_lenses_threaded(benchmark, spacing_m: float) -> None:
    """Benchmark ``carve_lenses`` on the production FAST path (threaded host fields).

    The matrix meshes + host height fields + lens inputs + shared grid are built
    ONCE in ``_carve_setup`` BEFORE the timing loop (they are the field-fit /
    assembly cost already covered by ``bench_litho_solid_builder``); the benchmark
    times only ``carve_lenses(..., host_height_fields=fields)`` — the carve reuses
    the threaded ``(top, base)`` arrays instead of ray-cast reconstruction.

    Grid spacing choice mirrors ``bench_litho_solid_builder``: 5 m coarse / 2 m
    medium / 1 m fine (the production default).  Carve cost scales with the chosen
    host's footprint node count (≈ hull_area / spacing²), so the fine tier is the
    load-bearing throughput number.

    Parameters
    ----------
    benchmark : pytest_benchmark.fixture.BenchmarkFixture
        The pytest-benchmark fixture (injected by the plugin).
    spacing_m : float
        Grid spacing in metres for this parametrised tier.
    """
    lens_inputs, meshes, gx, gy, node_inside, fields = _carve_setup(spacing_m)

    bodies = benchmark(
        carve_lenses, lens_inputs, meshes, gx, gy, node_inside, host_height_fields=fields
    )

    _assert_carve_sane(bodies, spacing_m)


@pytest.mark.benchmark(min_rounds=1, max_time=0.1, warmup=False)
def test_bench_carve_lenses_raycast_fallback(benchmark) -> None:
    """Benchmark ``carve_lenses`` on the SLOW ray-cast fallback at VERY COARSE (20 m).

    This is the path the optimisation REMOVED: with ``host_height_fields=None`` the
    carve reconstructs each carved host's height field by an
    O(grid_nodes × triangles) vertical ray-cast.  Run at a VERY COARSE 20 m
    spacing and ``min_rounds=1`` ONLY — at 5 m / medium / fine this path takes
    MINUTES per call (the cost we eliminated; a 5 m run with the default 5 rounds
    exceeded 15 minutes), so a single very-coarse data point is enough to
    document that the removed path is orders slower.  The geometry is identical to
    the threaded path (pinned by
    ``test_threaded_host_fields_are_geometrically_identical_to_raycast``); only the
    wall-clock differs.  Compare this 20 m ray-cast wall-time against the threaded
    20 m datapoint (``carve-threaded-20m``) for an apples-to-apples speedup ratio.

    Parameters
    ----------
    benchmark : pytest_benchmark.fixture.BenchmarkFixture
        The pytest-benchmark fixture (injected by the plugin).
    """
    spacing_m = 20.0
    lens_inputs, meshes, gx, gy, node_inside, _ = _carve_setup(spacing_m)

    # host_height_fields omitted → None → the legacy ray-cast reconstruction path.
    bodies = benchmark(carve_lenses, lens_inputs, meshes, gx, gy, node_inside)

    _assert_carve_sane(bodies, spacing_m)


@pytest.mark.benchmark(min_rounds=2, max_time=0.1, warmup=False)
def test_bench_build_plus_carve_medium(benchmark) -> None:
    """Benchmark the realistic end-to-end build-with-lenses wall-time at medium (2 m).

    Unlike the carve-only tiers, this measures the FULL on-Build path a user with a
    lens-bearing model sees: ``build_strat_model_with_fields`` (field fit + matrix
    assembly) + ``build_lens_carve_inputs`` (lens surfaces from picks) +
    ``carve_lenses`` (the threaded carve).  Only the fixture itself
    (``classify_lenses`` + control data, ~ms) is built outside the loop.  Medium
    (2 m) spacing is the realistic field-visit quality.  The carve-only tiers stay
    the primary deliverable; this one frames the carve's share of a real build.

    Parameters
    ----------
    benchmark : pytest_benchmark.fixture.BenchmarkFixture
        The pytest-benchmark fixture (injected by the plugin).
    """
    spacing_m = 2.0
    control, domain, partition, picks_by_body = widely_spaced_enclosed_lens_carve_fixture()

    def _build_and_carve() -> list:
        """Run the full build + lens carve at the fixed medium spacing."""
        meshes, fields = build_strat_model_with_fields(control, domain, [domain], spacing_m)
        lens_inputs = build_lens_carve_inputs(partition, picks_by_body, domain, spacing_m)
        gx, gy, node_inside = build_shared_grid(domain, spacing_m)
        return carve_lenses(lens_inputs, meshes, gx, gy, node_inside, host_height_fields=fields)

    bodies = benchmark(_build_and_carve)

    _assert_carve_sane(bodies, spacing_m)
