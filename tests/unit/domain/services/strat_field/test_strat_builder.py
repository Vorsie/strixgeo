"""Full-pipeline gate for the implicit stratigraphic 3-D builder (Task 6 orchestrator).

``build_strat_model`` is the single public entry the application layer calls: it
fits the potential field through the Stage-2 control data and assembles the
watertight body solids.  These tests run the WHOLE pipeline end-to-end on a
real-data-shaped, well-constrained fixture (four densely-spaced columns over a
compact block — a genuine RBF fit, not an analytic field) and assert the same
Task-7 invariants the body-assembly tests use: every body is a closed manifold,
no two bodies overlap (STRICT), and the model reproduces the authored litho stack
at every control column (the anti-loft column-diff).
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.strat_field.strat_builder import build_strat_model
from tests.unit.domain.services.strat_field.fixtures import build_strat_fixture
from tests.unit.domain.services.strat_field.strat_invariants import (
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
)

# Grid spacing for the full-pipeline build: 2 m over the ~20 m block → ~10 cells
# per axis, fast (<1 s) and fine enough to reproduce the flat bases within the
# 0.6 m column-diff tolerance.
_SPACING_M = 2.0


def _build() -> tuple[list, list]:
    """Run the full builder on the dense fixture; return (bodies, authored columns)."""
    control, domain, authored = build_strat_fixture()
    bodies = build_strat_model(control, domain, [domain], _SPACING_M)
    return bodies, authored


def _interior_samples(n: int = 10) -> list[tuple[float, float]]:
    """Return ``n × n`` interior ``(x, y)`` samples of the builder fixture's domain."""
    _, domain, _ = build_strat_fixture()
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    sx = np.linspace(min(xs) + 1.0, max(xs) - 1.0, n)
    sy = np.linspace(min(ys) + 1.0, max(ys) - 1.0, n)
    return [(float(x), float(y)) for x in sx for y in sy]


def test_pipeline_emits_the_full_litho_stack() -> None:
    """The builder emits one body per band of the KLEI/ZAND/VEEN stack, none flagged."""
    bodies, _ = _build()
    assert {b.formation_id for b in bodies} == {"KLEI", "ZAND", "VEEN"}
    for b in bodies:
        assert b.is_flagged is False


def test_pipeline_bodies_are_closed_manifolds() -> None:
    """Every body the full pipeline emits is a closed 2-manifold (consistent winding)."""
    bodies, _ = _build()
    assert bodies
    for b in bodies:
        assert_closed_manifold(b.vertices, b.triangles)


def test_pipeline_bodies_do_not_overlap() -> None:
    """No two different pipeline bodies interpenetrate at any sample (STRICT, TOL=1e-6)."""
    bodies, _ = _build()
    assert_no_overlap_sampled(bodies, _interior_samples(n=10))


def test_pipeline_model_tiles_the_authored_columns() -> None:
    """The full-pipeline model reproduces the authored litho stack at every column.

    This is the end-to-end anti-loft gate: a real RBF fit, assembled into watertight
    prisms, must reproduce the KLEI/ZAND/VEEN bases at each borehole within tolerance
    with no inter-body overlap — the exact property the old loft builder lost.
    """
    bodies, authored = _build()
    assert_model_matches_columns(bodies, authored, tol_m=0.6)


def test_pipeline_is_deterministic() -> None:
    """Two runs of the full pipeline produce byte-identical meshes (bundle replay)."""
    a, _ = _build()
    b, _ = _build()
    assert len(a) == len(b)
    for ba, bb in zip(a, b, strict=True):
        assert (ba.body_id, ba.formation_id) == (bb.body_id, bb.formation_id)
        assert ba.vertices == bb.vertices
        assert ba.triangles == bb.triangles
