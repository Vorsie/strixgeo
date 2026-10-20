"""Pick consistency check wall-clock (budget, spec §8: ≤ 1 s for 50 picks, ≤ 5 s for 200).

Run with::

    uv run pytest tests/benchmarks/bench_pick_check.py --benchmark-enable -v

Recorded in docs/benchmarks-journal.md; never a unit-test time bound (lessons-learned).
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.geostat.leave_one_out_check import check_formation_picks
from groundmodel.domain.value_objects.pick_observation import PickObservation


def _picks(n: int) -> list[PickObservation]:
    """Return ``n`` picks of a smooth synthetic surface with 0.2 m noise (fixed seed)."""
    rng = np.random.default_rng(7)
    xy = rng.uniform(0.0, 1500.0, size=(n, 2))
    z = -4.0 + 1.5 * np.sin(xy[:, 0] / 250.0) + rng.normal(0.0, 0.2, size=n)
    return [
        PickObservation(f"c{i}", f"i{i}", "cpt", f"T{i}", float(x), float(y), float(v), 0.1)
        for i, ((x, y), v) in enumerate(zip(xy, z, strict=True))
    ]


# ``test_`` prefix: pyproject collects ``bench_*.py`` files but keeps pytest's
# default ``test_*`` function pattern (as in bench_tin_surface.py).
@pytest.mark.parametrize("n", [18, 50, 100, 200])
def test_bench_check_formation_picks(benchmark, n: int) -> None:  # noqa: ANN001 — pytest-benchmark fixture
    """Full refit leave-one-out for ``n`` picks of one formation."""
    picks = _picks(n)
    result = benchmark(check_formation_picks, picks)
    assert result.status == "checked"
