"""Litho-3D implicit strat-field builder performance benchmarks (Task 10).

Run with::

    uv run pytest tests/benchmarks/bench_litho_solid_builder.py --benchmark-enable -v

:func:`~groundmodel.domain.services.strat_field.strat_builder.build_strat_model`
is the CPU-bound per-model surface introduced by the implicit stratigraphic
builder: given a :class:`~groundmodel.domain.services.strat_field.strat_types.StratControlData`
(Stage-2 control data carrying the stratigraphic order + per-contact field
constraints) it fits the cubic-RBF potential field (SciPy ``RBFInterpolator``,
C-backed) then assembles one watertight body solid per lithostratigraphic band
over a regular grid spanning the domain block.  Per the CLAUDE.md "when to add
a benchmark" rule (CPU-bound per-element function, lands alongside the code it
measures) it belongs here.

The function runs **once per model, on the user-clicked Build** — not per
render frame and not auto-batched.  The heavy lift is:

1. SciPy ``RBFInterpolator`` fit over ~20–28 normalised control points (one per
   internal contact per investigation) — C-backed cubic kernel; cost is
   O(n_points³) at fit time, O(n_grid × n_points) at query time.
2. Height-field sampling: for every grid node and every interior horizon, find
   the monotone z-crossing of the field.  The node count scales as
   ``(area / spacing²) × n_horizons``.  This is the hot inner loop — pure
   Python with NumPy; vectorisable if a Phase-5 real-project profile ever
   demands it.
3. Cell-complex boundary assembly: accumulate face counts for every grid cell
   of every body, cancel interior faces, emit boundary faces.  Cost is O(N_body
   × n_cells) — light relative to the field sampling.

Synthetic fixture
-----------------
All tiers use the ``widely_spaced_build_fixture`` from the unit-test fixtures
module: seven investigation columns at real Lambert-72 magnitude (~150 000 m
easting, ~200 000 m northing), 100–300 m apart on a ~680 m × 700 m footprint,
with a four-band ZAND/KLEI/ZAND/KLEI interbedded stack at a few metres depth.
This fixture is the **real-data-shaped** configuration that exposed the
coordinate-spread RBF explosion (Task 8.5) — it is the right bench input
because it is exactly what real BE/NL builds look like.  The fixture is
deterministic (no RNG) so repeated runs are comparable.

The **grid spacing** is the dominant cost driver: node count ≈
(hull_area / spacing²), so halving the spacing quadruples the node count and
roughly quadruples the field-sampling cost.  The three tiers span the realistic
range from a coarse preview build to a fine production build:

* coarse (5 m spacing) — quick preview quality, blocky tapers; the grid over the
  ~680 m × 700 m hull has ≈ 19 200 nodes.  Expected sub-second.
* medium (2 m spacing) — the sweet spot; smoother tapers; ≈ 120 000 nodes.
  Expected a few seconds.
* fine   (1 m spacing) — production quality, smooth tapers + dipping contacts
  faithfully reproduced; ≈ 476 000 nodes.  Expected several seconds; this is
  ``_DEFAULT_STRAT_GRID_SPACING_M`` in ``recompute_litho_solids.py``.

Sanity assertions
-----------------
Each timed call is followed by a sanity check (outside the timing window):

* ``bodies`` is non-empty — the field yielded at least one band with nonzero
  volume (proves real work happened, not a degenerate short-circuit).
* No body is flagged (``is_flagged is False``) — the builder omits degenerate
  zero-volume bands rather than marking them; a flagged solid indicates the
  application layer, which is NOT called here, has injected a fallback row.
* Every body has at least one triangle — the mesh is non-degenerate.

These mirror the assertions the old loft bench used to ensure "real meshes, not
degenerate stubs".

Baseline numbers land in CLAUDE.local.md after a stable run (see "Litho-3D
implicit strat-field builder" section there).
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.strat_field.strat_builder import build_strat_model
from tests.unit.domain.services.strat_field.fixtures import widely_spaced_build_fixture


def _fixture() -> tuple:
    """Return the widely-spaced build fixture (control, domain, authored columns).

    Builds the fixture once per call — the fixture itself is deterministic and
    fast (no field fitting here), so constructing it inside the bench parametrise
    rather than at module level avoids any cross-test state.

    Returns
    -------
    tuple
        ``(StratControlData, Block, list[AuthoredColumn])`` from
        :func:`widely_spaced_build_fixture`.
    """
    return widely_spaced_build_fixture()


@pytest.mark.parametrize(
    "spacing_m",
    [5.0, 2.0, 1.0],
    ids=["coarse-5m", "medium-2m", "fine-1m"],
)
def test_bench_build_strat_model(benchmark, spacing_m: float) -> None:
    """Benchmark :func:`build_strat_model` at three grid spacings.

    The ``widely_spaced_build_fixture`` is constructed ONCE before the timing
    loop starts (the fixture build is ~1 ms; measuring it would conflate
    ``build_stratigraphic_order`` + ``build_control_data`` cost with the hot
    field-fit + body-assembly path).  The benchmark function calls
    ``build_strat_model`` directly.

    Grid spacing choice rationale:

    * 5 m (coarse) — tests the fast-preview path; ~19 200 nodes over the
      ~680 × 700 m hull.  Should be sub-second.
    * 2 m (medium) — realistic field-visit quality; ~120 000 nodes.  Expected
      a few seconds on a typical dev laptop.
    * 1 m (fine) — the production default (``_DEFAULT_STRAT_GRID_SPACING_M``);
      ~476 000 nodes.  The load-bearing throughput case: if a real 14-section
      test.strix build at 1 m is too slow, this is the number to look at first.

    The node-count estimate uses hull_area / spacing² as a lower bound — the
    actual body_assembly grid samples the bounding rectangle of the hull polygon,
    which is slightly larger.

    Parameters
    ----------
    benchmark : pytest_benchmark.fixture.BenchmarkFixture
        The pytest-benchmark fixture (injected by the plugin).
    spacing_m : float
        Grid spacing in metres for this parametrised tier.
    """
    # Build the fixture outside the timing loop — it is a one-time setup, not
    # the thing we are measuring.
    control, domain, _ = _fixture()

    bodies = benchmark(build_strat_model, control, domain, [domain], spacing_m)

    # Sanity: the field must have produced at least one band with nonzero volume.
    # An empty list means either the field exploded (pre-Task-8.5 bug) or the
    # fixture was degenerate — both are real failures, not acceptable bench results.
    assert bodies, (
        f"build_strat_model at spacing={spacing_m} m returned no bodies — "
        "the field may have exploded or the fixture is degenerate"
    )

    # No body is flagged — the strat builder omits zero-volume bands; a flagged
    # solid means the application layer injected a fallback marker outside this
    # call's scope.  If this fires, the bench is measuring something other than
    # build_strat_model.
    for body in bodies:
        assert body.is_flagged is False, (
            f"body {body.body_id!r} (formation {body.formation_id!r}) is flagged — "
            "build_strat_model should only emit non-flagged bodies"
        )

    # Every body must have at least one triangle — a zero-triangle mesh means
    # the assembly loop ran but emitted no boundary faces, which indicates an
    # implementation bug (not a spacing-sensitivity artefact).
    for body in bodies:
        assert len(body.triangles) > 0, (
            f"body {body.body_id!r} has zero triangles at spacing={spacing_m} m"
        )
