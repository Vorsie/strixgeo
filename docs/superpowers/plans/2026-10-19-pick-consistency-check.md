# Pick Consistency Check (uncertainty slice A0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Strix house rules that override the generic skill:** builders NEVER commit, never push, never run the integration wrapper or the e2e suite. Each "Commit" step below is done by the session main after it has verified the output (one file per commit, `git commit -s`, Conventional Commits). Work only in the worktree `C:\Users\robin\Documents\Strix-wt-pick` (branch `feat/pick-consistency-check`). Run Vitest from `desktop/` only. Python gates per touched file: `uv run ruff format <file>` + `uv run ruff check --fix <file>`; numpy docstrings on every public module, class and function.

**Goal:** Flag geological-model picks that do not fit their neighbours, always on and in the background, with a manual page at explainer depth.

**Architecture:** Pure numpy/scipy geostatistics in `domain/services/geostat/` (Matérn-3/2 covariance, REML fit with analytic gradients, ordinary kriging, leave-one-out with refit). An application use case loads the same picks the surfaces use, a per-process cache computes changed formations in a worker thread, and a read-only `GET …/contact-consistency` endpoint reports `computing`/`ready`. The desktop polls it and shows an amber banner under the crossings banner in the Geology inspector; "Show" opens a section through the two tests.

**Tech Stack:** Python 3.11, numpy, scipy (L-BFGS-B, `cho_factor`), FastAPI, SQLAlchemy async; React 18 + TypeScript, Vitest; Sphinx manual + matplotlib figures.

**Spec:** `docs/superpowers/specs/2026-10-19-pick-consistency-check-design.md`. Fixture: `tests/fixtures/geostat/worked_example_top_egem.json` (committed, 17 real picks on top Egem + Cross-section 1 geometry).

**Verified on the fixture before planning (prototype, L-BFGS-B, floors added to the fitted noise):** stored picks → B16 z = +5.4, S16 z = −5.4, 2025-01415 S4 z = +3.3, B12/S12 |z| < 2; 17 refits in 0.13 s. With B16 removed → only S4 (z = +3.3).

---

## File structure

Backend, new:

| File | Responsibility |
| --- | --- |
| `src/groundmodel/domain/services/geostat/__init__.py` | package marker |
| `src/groundmodel/domain/services/geostat/geostat_constants.py` | thresholds, bounds, floors, statuses |
| `src/groundmodel/domain/services/geostat/matern_covariance.py` | distances, C(h), ∂C/∂log r, γ(h), expected \|Δ\| |
| `src/groundmodel/domain/services/geostat/ordinary_kriging.py` | weights, prediction, kriging variance |
| `src/groundmodel/domain/services/geostat/reml_objective.py` | REML value + analytic gradient |
| `src/groundmodel/domain/services/geostat/fit_covariance_model.py` | bounded L-BFGS-B fit |
| `src/groundmodel/domain/services/geostat/pick_noise_floor.py` | investigation kind → floor |
| `src/groundmodel/domain/services/geostat/leave_one_out_check.py` | refit LOO, z, flags, coverage |
| `src/groundmodel/domain/value_objects/covariance_model.py` | `CovarianceModel` |
| `src/groundmodel/domain/value_objects/pick_observation.py` | `PickObservation` |
| `src/groundmodel/domain/value_objects/pick_flag.py` | `PickFlag` |
| `src/groundmodel/domain/value_objects/formation_pick_check.py` | `FormationPickCheck` |
| `src/groundmodel/application/formation_picks.py` | `FormationPicks` |
| `src/groundmodel/application/load_formation_picks.py` | DB → `FormationPicks` (same filters as the surfaces) |
| `src/groundmodel/application/pick_observation_digest.py` | cache key digest |
| `src/groundmodel/application/contact_consistency_cache.py` | `ContactConsistencyCache` (background compute) |
| `src/groundmodel/application/formation_consistency_entry.py` | `FormationConsistencyEntry` |
| `src/groundmodel/application/check_contact_consistency.py` | `CheckContactConsistency` use case |
| `src/groundmodel/api/schemas/project/contact_consistency.py` | response schemas |
| `src/groundmodel/api/routers/geology/contact_consistency.py` | `GET …/contact-consistency` |

Backend, modified: `src/groundmodel/shared/exceptions.py` (`GeostatFitError`), `src/groundmodel/api/routers/geology/__init__.py` (register router), `docs/api.md` (endpoint line), the spec (§4.2 noise model).

Tests, new: `tests/unit/domain/services/geostat/{__init__,test_matern_covariance,test_ordinary_kriging,test_reml_objective,test_fit_covariance_model,test_pick_noise_floor,test_leave_one_out_check}.py`, `tests/unit/application/test_pick_observation_digest.py`, `tests/unit/application/test_contact_consistency_cache.py`, `tests/integration/api/test_contact_consistency.py`, `tests/benchmarks/bench_pick_check.py`.

Desktop, new: `desktop/src/renderer/src/hooks/useContactConsistency.ts` (+ `.test.tsx`), `desktop/src/renderer/src/shell/stages/geology/PickCheckBanner.tsx` (+ `.test.tsx`). Modified: `api/clients/geology.types.ts`, `api/clients/geology.ts`, `api/client.ts`, `i18n/locales/en/models.ts`, `i18n/locales/nl/models.ts`, `shell/stages/geology/GeologyInspector.tsx`, and every test file that mocks `api.geology` for a rendered `GeologyInspector`/`App`.

Docs, new: `scripts/manual_figures/pick_check_figures.py`, `docs/manual/_static/figures/pick-check/*.png`. Modified: `docs/manual/chapters/03-methods.rst`, `pyproject.toml` + `uv.lock` (matplotlib in the `docs` group).

---

### Task 0: Spec amendment — floors are added to the fitted noise

The prototype showed that a smooth noise model fits better than `max(n, floor²)`: the per-pick noise variance is `floorᵢ² + n` with `n ≥ 1e-6`. It still guarantees "never more accurate than the floor".

**Files:** Modify: `docs/superpowers/specs/2026-10-19-pick-consistency-check-design.md` (§4.2 and §8)

- [ ] **Step 1: Replace the noise formula in §4.2**

Replace the line `τᵢ² = max(n, floorᵢ²)` and the sentence before it with:

```markdown
and ε independent pick noise with variance

τᵢ² = floorᵢ² + n

where *n* ≥ 0 is the fitted extra nugget and floorᵢ is the source floor (owner ruling 2026-10-19). The sum is smooth for the optimiser and still guarantees that a pick is never treated as more accurate than its floor:
```

- [ ] **Step 2: Add the measured number to §8**

Append to §8:

```markdown
Measured on the worked-example fixture with L-BFGS-B (numerical gradients, floors added to the noise): 17 refits in 0.13 s; flags B16 (+5.4), S16 (−5.4), 2025-01415 S4 (+3.3); B12/S12 not flagged.
```

- [ ] **Step 3: Commit** — `docs(spec): pick check noise is floor squared plus fitted nugget`

---

### Task 1: Constants, exception and value objects

**Files:**
- Create: `src/groundmodel/domain/services/geostat/__init__.py`, `src/groundmodel/domain/services/geostat/geostat_constants.py`
- Create: `src/groundmodel/domain/value_objects/covariance_model.py`, `pick_observation.py`, `pick_flag.py`, `formation_pick_check.py`
- Modify: `src/groundmodel/shared/exceptions.py`
- Test: `tests/unit/domain/services/geostat/__init__.py`, `tests/unit/domain/services/geostat/test_value_objects.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/domain/services/geostat/__init__.py`: empty file.

`tests/unit/domain/services/geostat/test_value_objects.py`:

```python
"""Value objects of the pick consistency check carry what the banner needs."""

from __future__ import annotations

import math

import numpy as np
import pytest

from groundmodel.domain.services.geostat.geostat_constants import (
    MIN_PICKS,
    PICK_NOISE_FLOOR_M,
    Z_FLAG,
)
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation


def test_owner_floors_and_thresholds() -> None:
    """Owner ruling 2026-10-19: borehole ±0.25 m, CPT ±0.10 m; flag above 3σ; at least 6 picks."""
    assert PICK_NOISE_FLOOR_M == {"cpt": 0.10, "borehole": 0.25}
    assert Z_FLAG == 3.0
    assert MIN_PICKS == 6


def test_covariance_model_log_params_round_trip() -> None:
    """The optimiser works on log parameters; the model must give them back exactly."""
    model = CovarianceModel(sill_m2=4.0, range_m=210.0, nugget_m2=0.01)
    np.testing.assert_allclose(np.exp(model.log_params()), [4.0, 210.0, 0.01])


def test_value_objects_are_frozen() -> None:
    """Results are shared between the cache and the API; nobody may mutate them."""
    pick = PickObservation("c1", "i1", "cpt", "S16", 0.0, 0.0, -4.15, 0.10)
    check = FormationPickCheck(status="too_few_picks", n_picks=1, model=None, coverage_90=None, flags=())
    with pytest.raises(AttributeError):
        pick.elevation_m = 0.0  # type: ignore[misc]
    with pytest.raises(AttributeError):
        check.status = "checked"  # type: ignore[misc]
    assert math.isclose(pick.noise_floor_m, 0.10)
```

- [ ] **Step 2: Run it, see it fail**

Run: `uv run pytest tests/unit/domain/services/geostat/test_value_objects.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'groundmodel.domain.services.geostat'`.

- [ ] **Step 3: Implement**

`src/groundmodel/domain/services/geostat/__init__.py`:

```python
"""Geostatistics services: covariance models, kriging and the pick consistency check."""
```

`src/groundmodel/domain/services/geostat/geostat_constants.py`:

```python
"""Constants of the geostatistics services (pick consistency check, uncertainty slice A0).

Every value here is an owner ruling or a numerical safeguard; the WHY is next to it.
"""

from __future__ import annotations

import math

# A three-parameter covariance fit (sill, range, nugget) on fewer picks is meaningless,
# and leave-one-out would leave at most four points to fit.
MIN_PICKS = 6

# |z| above 3 happens by chance about 1 time in 370 under a normal model, so a flag
# at 3σ almost always means a wrong pick (spec §3).
Z_FLAG = 3.0

# Two-sided 90 % band; used for the per-formation self-check ("coverage").
COVERAGE_Z = 1.645

# Owner ruling 2026-10-19: a pick is never treated as more accurate than this.
# A borehole log is described in about 0.5 m steps; a CPT pick is sharper.
PICK_NOISE_FLOOR_M = {"cpt": 0.10, "borehole": 0.25}

# Search box of the REML fit (spec §4.3). Ranges under 20 m cannot be resolved by
# tests that stand 50-100 m apart; above 5 km a site-scale model is a plane.
RANGE_BOUNDS_M = (20.0, 5000.0)
SILL_BOUNDS_M2 = (1e-4, 1e4)
NUGGET_BOUNDS_M2 = (1e-6, 1e2)

# Start value of the extra nugget (m²) before the optimiser moves it.
INITIAL_NUGGET_M2 = 1e-2

# Start range = this factor × the median nearest-neighbour distance.
INITIAL_RANGE_FACTOR = 3.0

# When the first fit lands on a range bound, retry once from this factor × the start range.
RANGE_RETRY_FACTOR = 10.0

# Iteration caps: the full fit may search; a refit starts at the full fit and only corrects.
FULL_FIT_MAX_ITERATIONS = 200
REFIT_MAX_ITERATIONS = 30

# Added to the covariance diagonal so a Cholesky factor always exists.
JITTER_M2 = 1e-8

# Objective value returned when the matrix is not positive definite; L-BFGS-B backs off.
LARGE_OBJECTIVE = 1e10

MATERN_SQRT3 = math.sqrt(3.0)

STATUS_CHECKED = "checked"
STATUS_TOO_FEW_PICKS = "too_few_picks"
STATUS_FIT_FAILED = "fit_failed"
```

`src/groundmodel/domain/value_objects/covariance_model.py`:

```python
"""Fitted Matérn-3/2 covariance model of one contact surface."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class CovarianceModel:
    """Sill, range and extra nugget of a Matérn-3/2 covariance.

    Attributes
    ----------
    sill_m2 : float
        Variance of the contact elevation between far-apart tests (m²).
    range_m : float
        Distance over which two picks stop being related (m).
    nugget_m2 : float
        Extra pick noise variance on top of each pick's source floor (m²).
    """

    sill_m2: float
    range_m: float
    nugget_m2: float

    def log_params(self) -> np.ndarray:
        """Return ``log([sill, range, nugget])``, the optimiser's parameter vector.

        Returns
        -------
        numpy.ndarray
            Shape ``(3,)``.
        """
        return np.log([self.sill_m2, self.range_m, self.nugget_m2])
```

`src/groundmodel/domain/value_objects/pick_observation.py`:

```python
"""One contact pick as an (x, y, elevation) observation for the geostatistics."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PickObservation:
    """A formation-top pick at one investigation.

    Attributes
    ----------
    contact_id : str
        The ``formation_contact`` id.
    investigation_id : str
        The CPT or borehole id.
    investigation_kind : str
        ``"cpt"`` or ``"borehole"``.
    investigation_name : str
        Display name of the test (e.g. ``GEO-02/146-B16``).
    x_m, y_m : float
        Position in the project's horizontal CRS (m).
    elevation_m : float
        Contact elevation (m TAW) = ground elevation - pick depth.
    noise_floor_m : float
        Smallest pick standard deviation allowed for this source (m).
    """

    contact_id: str
    investigation_id: str
    investigation_kind: str
    investigation_name: str
    x_m: float
    y_m: float
    elevation_m: float
    noise_floor_m: float
```

`src/groundmodel/domain/value_objects/pick_flag.py`:

```python
"""A pick that does not fit its neighbours."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.pick_observation import PickObservation


@dataclass(frozen=True)
class PickFlag:
    """One flagged pick with the evidence the engineer needs.

    Attributes
    ----------
    pick : PickObservation
        The flagged pick.
    predicted_elevation_m : float
        Leave-one-out guess from the other picks (m TAW).
    sigma_m : float
        Standard deviation of (pick - guess), including the pick's own noise (m).
    z_score : float
        ``(pick - guess) / sigma``.
    nearest : PickObservation
        The closest other pick of the same formation.
    nearest_distance_m : float
        Horizontal distance to ``nearest`` (m).
    """

    pick: PickObservation
    predicted_elevation_m: float
    sigma_m: float
    z_score: float
    nearest: PickObservation
    nearest_distance_m: float
```

`src/groundmodel/domain/value_objects/formation_pick_check.py`:

```python
"""Result of the pick consistency check for one formation."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.pick_flag import PickFlag


@dataclass(frozen=True)
class FormationPickCheck:
    """Outcome of :func:`check_formation_picks`.

    Attributes
    ----------
    status : str
        ``checked``, ``too_few_picks`` or ``fit_failed`` (geostat_constants).
    n_picks : int
        Number of picks considered.
    model : CovarianceModel or None
        Fit on all picks; ``None`` unless ``status == "checked"``.
    coverage_90 : float or None
        Share of picks inside their own leave-one-out 90 % band.
    flags : tuple[PickFlag, ...]
        Flagged picks, largest |z| first.
    reason : str or None
        Why the fit failed, for ``fit_failed``.
    """

    status: str
    n_picks: int
    model: CovarianceModel | None
    coverage_90: float | None
    flags: tuple[PickFlag, ...]
    reason: str | None = None
```

Append to `src/groundmodel/shared/exceptions.py` (after the existing domain errors, same style):

```python
class GeostatFitError(GroundModelError):
    """A covariance model could not be fitted to a set of picks."""
```

- [ ] **Step 4: Run, see it pass**

Run: `uv run pytest tests/unit/domain/services/geostat/test_value_objects.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit** (one file per commit): the constants, each value object, the exception, the tests.

---

### Task 2: Matérn covariance and semivariogram

**Files:**
- Create: `src/groundmodel/domain/services/geostat/matern_covariance.py`
- Test: `tests/unit/domain/services/geostat/test_matern_covariance.py`

- [ ] **Step 1: Write the failing test**

```python
"""Matérn-3/2: full covariance at distance 0, about half at one range, nearly none at ten ranges."""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.matern_covariance import (
    expected_absolute_difference,
    matern32_covariance,
    matern32_covariance_dlog_range,
    pairwise_distances,
    semivariogram,
)
from groundmodel.domain.value_objects.covariance_model import CovarianceModel


def test_covariance_at_zero_one_and_ten_ranges() -> None:
    """C(0) = s; C(r) = s(1+√3)e^-√3 ≈ 0.4833 s; C(10 r) is practically zero."""
    s, r = 4.0, 200.0
    c = matern32_covariance(np.array([0.0, r, 10 * r]), s, r)
    assert math.isclose(c[0], 4.0)
    assert math.isclose(c[1], 4.0 * (1 + math.sqrt(3)) * math.exp(-math.sqrt(3)), rel_tol=1e-12)
    assert c[2] < 4.0 * 1e-6


def test_range_derivative_matches_finite_difference() -> None:
    """∂C/∂log r = s a² e^-a with a = √3 h / r."""
    h = np.array([5.0, 50.0, 300.0])
    s, r, eps = 2.0, 120.0, 1e-6
    numeric = (matern32_covariance(h, s, r * math.exp(eps)) - matern32_covariance(h, s, r * math.exp(-eps))) / (2 * eps)
    np.testing.assert_allclose(matern32_covariance_dlog_range(h, s, r), numeric, rtol=1e-6)


def test_pairwise_distances() -> None:
    """Plain Euclidean distances in the horizontal plane."""
    a = np.array([[0.0, 0.0], [3.0, 4.0]])
    np.testing.assert_allclose(pairwise_distances(a, a), [[0.0, 5.0], [5.0, 0.0]])


def test_semivariogram_and_expected_difference() -> None:
    """γ(h) = n + s - C(h); expected |difference| = √(2γ + floors) · √(2/π)."""
    model = CovarianceModel(sill_m2=1.0, range_m=100.0, nugget_m2=0.04)
    gamma = semivariogram(np.array([0.0, 1e6]), model)
    np.testing.assert_allclose(gamma, [0.04, 1.04], atol=1e-12)
    diff = expected_absolute_difference(np.array([0.0]), model, pick_noise_m2=0.02)
    assert math.isclose(diff[0], math.sqrt(2 * 0.04 + 0.02) * math.sqrt(2 / math.pi))
```

- [ ] **Step 2: Run, see it fail** — `uv run pytest tests/unit/domain/services/geostat/test_matern_covariance.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/matern_covariance.py`:

```python
"""Matérn-3/2 covariance, its range derivative and the semivariogram.

C(h) = s · (1 + a) · e^(-a) with a = √3 · h / r. Matérn-3/2 is once differentiable:
a contact surface that is smooth but not artificially so, the usual choice for
geological surfaces (Rasmussen & Williams 2006, §4.2).
"""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.geostat_constants import MATERN_SQRT3
from groundmodel.domain.value_objects.covariance_model import CovarianceModel


def pairwise_distances(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Return the Euclidean distance between every row of ``a`` and every row of ``b``.

    Parameters
    ----------
    a : numpy.ndarray
        Shape ``(n, 2)`` positions (m).
    b : numpy.ndarray
        Shape ``(m, 2)`` positions (m).

    Returns
    -------
    numpy.ndarray
        Shape ``(n, m)`` distances (m).
    """
    diff = a[:, None, :] - b[None, :, :]
    return np.sqrt((diff * diff).sum(axis=-1))


def matern32_covariance(distance_m: np.ndarray, sill_m2: float, range_m: float) -> np.ndarray:
    """Return the Matérn-3/2 covariance at the given distances.

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m), any shape.
    sill_m2 : float
        Sill s (m²).
    range_m : float
        Range r (m).

    Returns
    -------
    numpy.ndarray
        Covariance (m²), same shape as ``distance_m``.
    """
    a = MATERN_SQRT3 * np.asarray(distance_m, dtype=float) / range_m
    return sill_m2 * (1.0 + a) * np.exp(-a)


def matern32_covariance_dlog_range(distance_m: np.ndarray, sill_m2: float, range_m: float) -> np.ndarray:
    """Return ∂C/∂(log r) = s · a² · e^(-a), used by the REML gradient.

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    sill_m2 : float
        Sill s (m²).
    range_m : float
        Range r (m).

    Returns
    -------
    numpy.ndarray
        Derivative (m²), same shape as ``distance_m``.
    """
    a = MATERN_SQRT3 * np.asarray(distance_m, dtype=float) / range_m
    return sill_m2 * a * a * np.exp(-a)


def semivariogram(distance_m: np.ndarray, model: CovarianceModel) -> np.ndarray:
    """Return γ(h) = n + s - C(h), half the expected squared difference of two picks.

    At h = 0 this is the nugget: two distinct picks at the same spot still differ by
    their noise (the strict γ(0) = 0 holds only for a pick compared with itself).

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    model : CovarianceModel
        Fitted model.

    Returns
    -------
    numpy.ndarray
        Semivariance (m²).
    """
    cov = matern32_covariance(distance_m, model.sill_m2, model.range_m)
    return model.nugget_m2 + model.sill_m2 - cov


def expected_absolute_difference(
    distance_m: np.ndarray, model: CovarianceModel, *, pick_noise_m2: float = 0.0
) -> np.ndarray:
    """Return the expected |difference| of two picks h apart (the manual's "green curve").

    For a normal difference with variance v, E|Δ| = √v · √(2/π). Here
    v = 2 γ(h) + the two picks' floor variances (``pick_noise_m2``).

    Parameters
    ----------
    distance_m : numpy.ndarray
        Distances (m).
    model : CovarianceModel
        Fitted model.
    pick_noise_m2 : float, optional
        Sum of the two picks' floor variances (m²).

    Returns
    -------
    numpy.ndarray
        Expected absolute difference (m).
    """
    variance = 2.0 * semivariogram(distance_m, model) + pick_noise_m2
    return np.sqrt(variance) * math.sqrt(2.0 / math.pi)
```

- [ ] **Step 4: Run, see it pass** — `4 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): matern-3/2 covariance and semivariogram`; `test(geostat): …`.

---

### Task 3: Ordinary kriging with a hand-worked example

**Files:**
- Create: `src/groundmodel/domain/services/geostat/ordinary_kriging.py`
- Test: `tests/unit/domain/services/geostat/test_ordinary_kriging.py`

- [ ] **Step 1: Write the failing test**

```python
"""Ordinary kriging against an example worked out by hand.

Two data points, one target. Covariance between the data K = [[1, 0.5], [0.5, 1]];
covariance data -> target k = [0.8, 0.2]; sill (prior variance) 1; values z = [1, 3].

By hand:
  K⁻¹ = (4/3)·[[1, -0.5], [-0.5, 1]]
  K⁻¹k = (4/3)·[0.7, -0.2] = [14/15, -4/15];  K⁻¹1 = [2/3, 2/3];  1ᵀK⁻¹1 = 4/3
  u = 1 - 1ᵀK⁻¹k = 1 - 10/15 = 1/3
  weights w = K⁻¹k + K⁻¹1 · u / (1ᵀK⁻¹1) = [14/15 + 1/6, -4/15 + 1/6] = [1.1, -0.1]  (sum 1)
  guess = 1.1·1 - 0.1·3 = 0.8
  variance = 1 - kᵀK⁻¹k + u²/(1ᵀK⁻¹1) = 1 - 10.4/15 + (1/9)/(4/3) = 0.39
A negative weight is correct: the far point is "screened" by the near one.
"""

from __future__ import annotations

import math

import numpy as np

from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging


def test_hand_worked_example() -> None:
    """Weights, guess and variance equal the paper calculation in the module docstring."""
    k_data = np.array([[1.0, 0.5], [0.5, 1.0]])
    k_target = np.array([0.8, 0.2])
    value, variance, weights = ordinary_kriging(k_data, k_target, np.array([1.0, 3.0]), 1.0)
    np.testing.assert_allclose(weights, [1.1, -0.1], atol=1e-12)
    assert math.isclose(weights.sum(), 1.0)
    assert math.isclose(value, 0.8, abs_tol=1e-12)
    assert math.isclose(variance, 0.39, abs_tol=1e-12)


def test_symmetric_target_gets_equal_votes() -> None:
    """A target equally far from two points takes their mean; variance 0.75 by hand."""
    value, variance, weights = ordinary_kriging(
        np.array([[1.0, 0.5], [0.5, 1.0]]), np.array([0.5, 0.5]), np.array([1.0, 3.0]), 1.0
    )
    np.testing.assert_allclose(weights, [0.5, 0.5])
    assert math.isclose(value, 2.0)
    assert math.isclose(variance, 0.75)
```

- [ ] **Step 2: Run, see it fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/ordinary_kriging.py`:

```python
"""Ordinary kriging: the best linear guess with an unknown constant mean.

The weights minimise the expected squared error under the constraint that they sum
to 1 (so the unknown mean cancels). Written in its generalised-least-squares form,
which needs only solves with the data covariance K:

  w = K⁻¹k + K⁻¹1 · u / (1ᵀK⁻¹1),  u = 1 - 1ᵀK⁻¹k
  σ² = c₀ - kᵀK⁻¹k + u² / (1ᵀK⁻¹1)

with k the covariance between the data and the target and c₀ the prior variance at
the target. The test module works an example out by hand.
"""

from __future__ import annotations

import numpy as np
from scipy.linalg import cho_factor, cho_solve


def ordinary_kriging(
    data_covariance: np.ndarray,
    target_covariance: np.ndarray,
    values: np.ndarray,
    prior_variance: float,
) -> tuple[float, float, np.ndarray]:
    """Return the ordinary-kriging guess, its variance and the weights.

    Parameters
    ----------
    data_covariance : numpy.ndarray
        Shape ``(n, n)`` covariance K between the data, noise on the diagonal (m²).
    target_covariance : numpy.ndarray
        Shape ``(n,)`` covariance k between each datum and the target (m²).
    values : numpy.ndarray
        Shape ``(n,)`` observed values.
    prior_variance : float
        Variance c₀ of the field at the target, without noise (m²).

    Returns
    -------
    tuple[float, float, numpy.ndarray]
        ``(guess, variance, weights)``; the variance is clipped at 0 against round-off.

    Raises
    ------
    numpy.linalg.LinAlgError
        When ``data_covariance`` is not positive definite.
    """
    factor = cho_factor(data_covariance, lower=True)
    one = np.ones(len(values))
    ki_k = cho_solve(factor, target_covariance)
    ki_1 = cho_solve(factor, one)
    sum_ki_1 = float(one @ ki_1)
    unbias_gap = 1.0 - float(one @ ki_k)
    weights = ki_k + ki_1 * (unbias_gap / sum_ki_1)
    guess = float(weights @ values)
    variance = float(prior_variance - target_covariance @ ki_k + unbias_gap * unbias_gap / sum_ki_1)
    return guess, max(variance, 0.0), weights
```

- [ ] **Step 4: Run, see it pass** — `2 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): ordinary kriging in generalised-least-squares form`.

---

### Task 4: REML objective with analytic gradient

**Files:**
- Create: `src/groundmodel/domain/services/geostat/reml_objective.py`
- Test: `tests/unit/domain/services/geostat/test_reml_objective.py`

- [ ] **Step 1: Write the failing test**

```python
"""The REML gradient must equal the slope you measure by nudging each parameter."""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.geostat.matern_covariance import pairwise_distances
from groundmodel.domain.services.geostat.reml_objective import reml_objective


def _case() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3)
    xy = rng.uniform(0.0, 400.0, size=(12, 2))
    values = -3.0 + 0.004 * xy[:, 0] + rng.normal(0.0, 0.2, size=12)
    floors = np.full(12, 0.10**2)
    return pairwise_distances(xy, xy), values, floors


def test_gradient_matches_central_differences() -> None:
    """Analytic ∂/∂(log s, log r, log n) equals central differences to 1e-5 relative."""
    dist, values, floors = _case()
    x = np.log([1.5, 150.0, 0.02])
    _, grad = reml_objective(x, dist, values, floors)
    eps = 1e-6
    numeric = []
    for j in range(3):
        step = np.zeros(3)
        step[j] = eps
        up, _ = reml_objective(x + step, dist, values, floors)
        down, _ = reml_objective(x - step, dist, values, floors)
        numeric.append((up - down) / (2 * eps))
    np.testing.assert_allclose(grad, numeric, rtol=1e-5, atol=1e-7)


def test_non_positive_definite_returns_large_value() -> None:
    """A broken matrix must not crash the optimiser; it gets a large value and zero slope."""
    dist, values, floors = _case()
    value, grad = reml_objective(np.log([1.0, 100.0, 1e-6]), dist, values, floors * 0 - 1.0)
    assert value >= 1e10
    np.testing.assert_array_equal(grad, np.zeros(3))
```

- [ ] **Step 2: Run, see it fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/reml_objective.py`:

```python
"""Restricted (residual) maximum likelihood of a Matérn-3/2 model with an unknown mean.

Negative log REML (constants dropped):
  ℓ(θ) = ½ [ zᵀPz + log|K| + log(1ᵀK⁻¹1) ],  P = K⁻¹ - K⁻¹1 1ᵀK⁻¹ / (1ᵀK⁻¹1)
with K = C(s, r) + diag(floorᵢ² + n). Its gradient for any parameter θⱼ:
  ∂ℓ/∂θⱼ = ½ [ tr(P ∂K/∂θⱼ) - zᵀP (∂K/∂θⱼ) P z ]
on log parameters: ∂K/∂log s = C, ∂K/∂log r = s a² e^-a, ∂K/∂log n = n·I.
REML rather than plain ML because ML underestimates the variance when the mean is
estimated from the same few picks.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.linalg import cho_solve

from groundmodel.domain.services.geostat.geostat_constants import JITTER_M2, LARGE_OBJECTIVE
from groundmodel.domain.services.geostat.matern_covariance import (
    matern32_covariance,
    matern32_covariance_dlog_range,
)


def reml_objective(
    log_params: np.ndarray,
    distances: np.ndarray,
    values: np.ndarray,
    noise_floor_m2: np.ndarray,
) -> tuple[float, np.ndarray]:
    """Return the negative log REML and its gradient on ``log([sill, range, nugget])``.

    Parameters
    ----------
    log_params : numpy.ndarray
        Shape ``(3,)``: ``log(sill m²), log(range m), log(extra nugget m²)``.
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).
    noise_floor_m2 : numpy.ndarray
        Shape ``(n,)`` per-pick floor variances (m²).

    Returns
    -------
    tuple[float, numpy.ndarray]
        ``(value, gradient)``; ``(LARGE_OBJECTIVE, zeros)`` when K is not positive definite.
    """
    sill, range_m, nugget = np.exp(log_params)
    count = len(values)
    cov = matern32_covariance(distances, sill, range_m)
    k_mat = cov + np.diag(noise_floor_m2 + nugget + JITTER_M2)
    try:
        chol = np.linalg.cholesky(k_mat)
    except np.linalg.LinAlgError:
        return LARGE_OBJECTIVE, np.zeros(3)
    k_inv = cho_solve((chol, True), np.eye(count))
    one = np.ones(count)
    ki_1 = k_inv @ one
    sum_ki_1 = float(one @ ki_1)
    projector = k_inv - np.outer(ki_1, ki_1) / sum_ki_1
    p_z = projector @ values
    value = 0.5 * (float(values @ p_z) + 2.0 * float(np.log(np.diag(chol)).sum()) + math.log(sum_ki_1))
    derivatives = (
        cov,
        matern32_covariance_dlog_range(distances, sill, range_m),
        nugget * np.eye(count),
    )
    gradient = np.array(
        [0.5 * (float(np.sum(projector * d_k)) - float(p_z @ d_k @ p_z)) for d_k in derivatives]
    )
    return value, gradient
```

- [ ] **Step 4: Run, see it pass** — `2 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): REML objective with analytic gradient`.

---

### Task 5: Bounded covariance fit

**Files:**
- Create: `src/groundmodel/domain/services/geostat/fit_covariance_model.py`
- Test: `tests/unit/domain/services/geostat/test_fit_covariance_model.py`

- [ ] **Step 1: Write the failing test**

```python
"""The fit stays inside its box, respects a warm start and refuses broken input."""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.geostat.fit_covariance_model import fit_covariance_model
from groundmodel.domain.services.geostat.geostat_constants import RANGE_BOUNDS_M
from groundmodel.domain.services.geostat.matern_covariance import pairwise_distances
from groundmodel.shared.exceptions import GeostatFitError


def _smooth_field(n: int = 15) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(11)
    xy = rng.uniform(0.0, 600.0, size=(n, 2))
    values = -4.0 + 1.5 * np.sin(xy[:, 0] / 150.0) + rng.normal(0.0, 0.05, size=n)
    return pairwise_distances(xy, xy), values, np.full(n, 0.10**2)


def test_fit_inside_bounds_and_finds_a_smooth_field() -> None:
    """A smooth field with little noise gives a range inside the box and a small nugget."""
    dist, values, floors = _smooth_field()
    model = fit_covariance_model(dist, values, floors)
    assert RANGE_BOUNDS_M[0] <= model.range_m <= RANGE_BOUNDS_M[1]
    assert model.nugget_m2 < 0.1


def test_warm_start_from_a_previous_fit_is_accepted() -> None:
    """A refit from the full fit lands at (almost) the same model."""
    dist, values, floors = _smooth_field()
    full = fit_covariance_model(dist, values, floors)
    again = fit_covariance_model(dist, values, floors, start=full.log_params(), max_iterations=30)
    assert abs(np.log(again.range_m) - np.log(full.range_m)) < 0.05


def test_non_finite_values_are_refused() -> None:
    """A NaN elevation is a loading bug, not something to fit."""
    dist, values, floors = _smooth_field()
    values[0] = np.nan
    with pytest.raises(GeostatFitError):
        fit_covariance_model(dist, values, floors)
```

- [ ] **Step 2: Run, see it fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/fit_covariance_model.py`:

```python
"""Fit sill, range and extra nugget by REML with a bounded L-BFGS-B search."""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

from groundmodel.domain.services.geostat.geostat_constants import (
    FULL_FIT_MAX_ITERATIONS,
    INITIAL_NUGGET_M2,
    INITIAL_RANGE_FACTOR,
    LARGE_OBJECTIVE,
    NUGGET_BOUNDS_M2,
    RANGE_BOUNDS_M,
    RANGE_RETRY_FACTOR,
    SILL_BOUNDS_M2,
)
from groundmodel.domain.services.geostat.reml_objective import reml_objective
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.shared.exceptions import GeostatFitError

_LOG_BOUNDS = (
    (float(np.log(SILL_BOUNDS_M2[0])), float(np.log(SILL_BOUNDS_M2[1]))),
    (float(np.log(RANGE_BOUNDS_M[0])), float(np.log(RANGE_BOUNDS_M[1]))),
    (float(np.log(NUGGET_BOUNDS_M2[0])), float(np.log(NUGGET_BOUNDS_M2[1]))),
)


def initial_log_params(distances: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Return a data-driven start: sill = variance, range = 3 × median neighbour gap.

    Parameters
    ----------
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).

    Returns
    -------
    numpy.ndarray
        ``log([sill, range, nugget])`` inside the search box.
    """
    count = len(values)
    nearest = np.sort(distances + np.diag(np.full(count, np.inf)), axis=1)[:, 0]
    range0 = float(np.clip(INITIAL_RANGE_FACTOR * np.median(nearest), *RANGE_BOUNDS_M))
    sill0 = float(np.clip(np.var(values), *SILL_BOUNDS_M2))
    return np.log([sill0, range0, INITIAL_NUGGET_M2])


def _clip_to_box(log_params: np.ndarray) -> np.ndarray:
    lows = np.array([b[0] for b in _LOG_BOUNDS])
    highs = np.array([b[1] for b in _LOG_BOUNDS])
    return np.clip(log_params, lows, highs)


def _on_range_bound(log_range: float) -> bool:
    low, high = _LOG_BOUNDS[1]
    return abs(log_range - low) < 1e-6 or abs(log_range - high) < 1e-6


def fit_covariance_model(
    distances: np.ndarray,
    values: np.ndarray,
    noise_floor_m2: np.ndarray,
    *,
    start: np.ndarray | None = None,
    max_iterations: int = FULL_FIT_MAX_ITERATIONS,
) -> CovarianceModel:
    """Fit a Matérn-3/2 model to picks by REML.

    Parameters
    ----------
    distances : numpy.ndarray
        Shape ``(n, n)`` pairwise distances (m).
    values : numpy.ndarray
        Shape ``(n,)`` pick elevations (m TAW).
    noise_floor_m2 : numpy.ndarray
        Shape ``(n,)`` per-pick floor variances (m²).
    start : numpy.ndarray, optional
        Warm start ``log([sill, range, nugget])`` (a refit starts at the full fit).
    max_iterations : int, optional
        L-BFGS-B iteration cap.

    Returns
    -------
    CovarianceModel
        The fitted model.

    Raises
    ------
    GeostatFitError
        On non-finite input or when no positive-definite model was found.
    """
    if not np.all(np.isfinite(values)):
        raise GeostatFitError("pick elevations contain NaN or infinity")

    def run(x0: np.ndarray):  # noqa: ANN202 — scipy OptimizeResult
        return minimize(
            reml_objective,
            _clip_to_box(x0),
            args=(distances, values, noise_floor_m2),
            jac=True,
            method="L-BFGS-B",
            bounds=_LOG_BOUNDS,
            options={"maxiter": max_iterations},
        )

    first = initial_log_params(distances, values) if start is None else np.asarray(start, dtype=float)
    best = run(first)
    if start is None and _on_range_bound(float(best.x[1])):
        retry = first.copy()
        retry[1] = first[1] + np.log(RANGE_RETRY_FACTOR)
        second = run(retry)
        if second.fun < best.fun:
            best = second
    if not np.isfinite(best.fun) or best.fun >= LARGE_OBJECTIVE:
        raise GeostatFitError(f"covariance fit failed: {best.message}")
    sill, range_m, nugget = (float(v) for v in np.exp(best.x))
    return CovarianceModel(sill_m2=sill, range_m=range_m, nugget_m2=nugget)
```

- [ ] **Step 4: Run, see it pass** — `3 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): bounded REML fit of the covariance model`.

---

### Task 6: Pick noise floor per source

**Files:**
- Create: `src/groundmodel/domain/services/geostat/pick_noise_floor.py`
- Test: `tests/unit/domain/services/geostat/test_pick_noise_floor.py`

- [ ] **Step 1: Write the failing test**

```python
"""Owner ruling 2026-10-19: borehole ±0.25 m, CPT ±0.10 m; anything else is a bug."""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m


def test_floors_per_source() -> None:
    """A borehole log is coarser than a CPT trace."""
    assert pick_noise_floor_m("borehole") == 0.25
    assert pick_noise_floor_m("cpt") == 0.10


def test_unknown_kind_is_refused() -> None:
    """A new investigation kind must get its own floor on purpose."""
    with pytest.raises(ValueError, match="dmt"):
        pick_noise_floor_m("dmt")
```

- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/pick_noise_floor.py`:

```python
"""Smallest pick standard deviation per investigation kind (owner ruling 2026-10-19)."""

from __future__ import annotations

from groundmodel.domain.services.geostat.geostat_constants import PICK_NOISE_FLOOR_M


def pick_noise_floor_m(investigation_kind: str) -> float:
    """Return the noise floor (m) of a pick on this kind of investigation.

    Parameters
    ----------
    investigation_kind : str
        ``"cpt"`` or ``"borehole"``.

    Returns
    -------
    float
        Floor standard deviation (m).

    Raises
    ------
    ValueError
        For a kind without a ruled floor.
    """
    try:
        return PICK_NOISE_FLOOR_M[investigation_kind]
    except KeyError as exc:
        raise ValueError(
            f"no pick noise floor for investigation kind {investigation_kind!r}; "
            f"known kinds: {sorted(PICK_NOISE_FLOOR_M)}"
        ) from exc
```

- [ ] **Step 4: Run, see it pass** — `2 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): pick noise floor per investigation kind`.

---

### Task 7: Leave-one-out check with refit

**Files:**
- Create: `src/groundmodel/domain/services/geostat/leave_one_out_check.py`
- Test: `tests/unit/domain/services/geostat/test_leave_one_out_check.py`

- [ ] **Step 1: Write the failing test**

```python
"""Cover up each test, guess it from its neighbours, flag it when it is > 3σ off.

Real data: tests/fixtures/geostat/worked_example_top_egem.json (17 picks on top Egem).
"""

from __future__ import annotations

import json
from pathlib import Path

from groundmodel.domain.services.geostat.geostat_constants import (
    STATUS_CHECKED,
    STATUS_TOO_FEW_PICKS,
)
from groundmodel.domain.services.geostat.leave_one_out_check import check_formation_picks
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m
from groundmodel.domain.value_objects.pick_observation import PickObservation

FIXTURE = Path(__file__).parents[4] / "fixtures" / "geostat" / "worked_example_top_egem.json"


def _picks(*, drop: str | None = None) -> list[PickObservation]:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))["picks"]
    return [
        PickObservation(
            contact_id=r["name"],
            investigation_id=r["name"],
            investigation_kind=r["kind"],
            investigation_name=r["name"],
            x_m=r["x"],
            y_m=r["y"],
            elevation_m=r["ground_elevation_m"] - r["depth_top_m"],
            noise_floor_m=pick_noise_floor_m(r["kind"]),
        )
        for r in rows
        if r["name"] != drop
    ]


def _flagged(result) -> set[str]:  # noqa: ANN001 — FormationPickCheck
    return {f.pick.investigation_name for f in result.flags}


def test_b16_and_s16_disagree_at_the_same_spot() -> None:
    """Stored picks: borehole B16 and CPT S16 stand 0.4 m apart and differ 1.7 m → both flagged."""
    result = check_formation_picks(_picks())
    assert result.status == STATUS_CHECKED
    flagged = _flagged(result)
    assert {"GEO-02/146-B16", "GEO-02/145-S16"} <= flagged
    b16 = next(f for f in result.flags if f.pick.investigation_name == "GEO-02/146-B16")
    assert b16.nearest.investigation_name == "GEO-02/145-S16"
    assert b16.nearest_distance_m < 1.0
    # 2025-01415 S4 (13 m high ground) is recorded, not asserted: it is the owner's call.
    print("S4 flagged:", "2025-01415 S4" in flagged)


def test_borehole_floor_keeps_b12_s12_quiet() -> None:
    """B12/S12 stand at the same spot and differ 0.41 m: normal for a log in 0.5 m steps."""
    assert not {"GEO-02/146-B12", "GEO-02/145-S12"} & _flagged(check_formation_picks(_picks()))
    assert not {"GEO-02/146-B12", "GEO-02/145-S12"} & _flagged(
        check_formation_picks(_picks(drop="GEO-02/146-B16"))
    )


def test_after_the_owner_ruling_b16_s16_is_clean() -> None:
    """With B16's wrong pick removed, S16 fits its neighbours again."""
    assert "GEO-02/145-S16" not in _flagged(check_formation_picks(_picks(drop="GEO-02/146-B16")))


def test_masking_trap_single_fit_hides_the_bad_pair() -> None:
    """One fit for all picks learns its noise FROM B16/S16 and then calls them normal.

    The refit (default) judges each test by a model fitted without it.
    """
    naive = check_formation_picks(_picks(), refit=False)
    assert "GEO-02/146-B16" not in _flagged(naive)
    assert "GEO-02/146-B16" in _flagged(check_formation_picks(_picks()))


def test_too_few_picks() -> None:
    """Five picks cannot carry a three-parameter fit."""
    result = check_formation_picks(_picks()[:5])
    assert result.status == STATUS_TOO_FEW_PICKS
    assert result.flags == ()


def test_coverage_is_reported() -> None:
    """The self-check is a share between 0 and 1."""
    result = check_formation_picks(_picks(drop="GEO-02/146-B16"))
    assert result.coverage_90 is not None
    assert 0.0 <= result.coverage_90 <= 1.0
```

- [ ] **Step 2: Run, see it fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `src/groundmodel/domain/services/geostat/leave_one_out_check.py`:

```python
"""Leave-one-out pick consistency check with refit (spec §4.4).

For each pick: refit the covariance model WITHOUT it (warm start at the full fit),
krige its elevation from the others, and compare. z = (pick - guess) / σ with
σ² = kriging variance + the pick's own noise (floor² + nugget). |z| > 3 → flag.

Why refit: a single fit on all picks lets a wrong pick inflate the nugget, which then
makes that same pick look normal (worked example: B16 z 1.9 single fit, 5.4 refit).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from groundmodel.domain.services.geostat.fit_covariance_model import fit_covariance_model
from groundmodel.domain.services.geostat.geostat_constants import (
    COVERAGE_Z,
    MIN_PICKS,
    REFIT_MAX_ITERATIONS,
    STATUS_CHECKED,
    STATUS_FIT_FAILED,
    STATUS_TOO_FEW_PICKS,
    Z_FLAG,
)
from groundmodel.domain.services.geostat.matern_covariance import (
    matern32_covariance,
    pairwise_distances,
)
from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging
from groundmodel.domain.value_objects.covariance_model import CovarianceModel
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_flag import PickFlag
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.shared.exceptions import GeostatFitError


def _predict_held_out(
    index: int,
    model: CovarianceModel,
    distances: np.ndarray,
    values: np.ndarray,
    floor_m2: np.ndarray,
) -> tuple[float, float]:
    """Return the guess and σ for pick ``index`` from all other picks under ``model``."""
    keep = np.arange(len(values)) != index
    k_data = matern32_covariance(distances[np.ix_(keep, keep)], model.sill_m2, model.range_m)
    k_data = k_data + np.diag(floor_m2[keep] + model.nugget_m2)
    k_target = matern32_covariance(distances[index, keep], model.sill_m2, model.range_m)
    guess, variance, _ = ordinary_kriging(k_data, k_target, values[keep], model.sill_m2)
    sigma = math.sqrt(variance + floor_m2[index] + model.nugget_m2)
    return guess, sigma


def check_formation_picks(picks: Sequence[PickObservation], *, refit: bool = True) -> FormationPickCheck:
    """Flag picks of one formation that do not fit their neighbours.

    Parameters
    ----------
    picks : Sequence[PickObservation]
        All picks of the formation that feed the model.
    refit : bool, optional
        Refit the model without each held-out pick (default). ``False`` reproduces the
        masking trap and exists for the test and the manual figure only.

    Returns
    -------
    FormationPickCheck
        ``too_few_picks`` below ``MIN_PICKS``, ``fit_failed`` with a reason, else ``checked``.
    """
    count = len(picks)
    if count < MIN_PICKS:
        return FormationPickCheck(STATUS_TOO_FEW_PICKS, count, None, None, ())
    positions = np.array([[p.x_m, p.y_m] for p in picks])
    values = np.array([p.elevation_m for p in picks])
    floor_m2 = np.array([p.noise_floor_m**2 for p in picks])
    distances = pairwise_distances(positions, positions)
    try:
        full = fit_covariance_model(distances, values, floor_m2)
    except GeostatFitError as exc:
        return FormationPickCheck(STATUS_FIT_FAILED, count, None, None, (), reason=str(exc))

    flags: list[PickFlag] = []
    inside = 0
    for i in range(count):
        model = full
        if refit:
            keep = np.arange(count) != i
            try:
                model = fit_covariance_model(
                    distances[np.ix_(keep, keep)],
                    values[keep],
                    floor_m2[keep],
                    start=full.log_params(),
                    max_iterations=REFIT_MAX_ITERATIONS,
                )
            except GeostatFitError:
                model = full
        try:
            guess, sigma = _predict_held_out(i, model, distances, values, floor_m2)
        except np.linalg.LinAlgError as exc:
            return FormationPickCheck(STATUS_FIT_FAILED, count, None, None, (), reason=str(exc))
        z_score = (values[i] - guess) / sigma
        if abs(z_score) <= COVERAGE_Z:
            inside += 1
        if abs(z_score) > Z_FLAG:
            others = distances[i].copy()
            others[i] = np.inf
            j = int(np.argmin(others))
            flags.append(PickFlag(picks[i], guess, sigma, float(z_score), picks[j], float(others[j])))
    flags.sort(key=lambda f: -abs(f.z_score))
    return FormationPickCheck(STATUS_CHECKED, count, full, inside / count, tuple(flags))
```

- [ ] **Step 4: Run, see it pass** — `6 passed`. If `test_masking_trap_single_fit_hides_the_bad_pair` fails because the single fit DOES flag B16, print both z values and report them; do not weaken the refit assertion.
- [ ] **Step 5: Commit** — `feat(geostat): leave-one-out pick check with refit`.

---

### Task 8: Load the picks the surfaces use

**Files:**
- Create: `src/groundmodel/application/formation_picks.py`, `src/groundmodel/application/load_formation_picks.py`
- Test: covered by the integration test in Task 11 (it needs PostgreSQL).

- [ ] **Step 1: Implement** `src/groundmodel/application/formation_picks.py`:

```python
"""The picks of one formation, ready for the pick consistency check."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.value_objects.pick_observation import PickObservation


@dataclass(frozen=True)
class FormationPicks:
    """Picks of one formation in one geological model.

    Attributes
    ----------
    formation_id : UUID
        The formation.
    formation_name : str
        Display name.
    display_order : int
        Stratigraphic order (higher = younger); used to sort the report top-down.
    picks : tuple[PickObservation, ...]
        Picks on tests that feed the model (same filter as the surfaces).
    skipped_no_location : int
        Picks dropped because their test has no position or ground elevation.
    """

    formation_id: UUID
    formation_name: str
    display_order: int
    picks: tuple[PickObservation, ...]
    skipped_no_location: int
```

`src/groundmodel/application/load_formation_picks.py`:

```python
"""Load a geological model's picks as observations, filtered like the surface build.

A pick feeds the check exactly when it feeds the TIN: its test is drawn by a
cross-section, not removed from the project and not excluded from the model
(`contact_feeds_surface`). Synthetic pinch-out contacts are extrapolations, not
observations, and are skipped.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.formation_picks import FormationPicks
from groundmodel.application.section_membership import load_section_member_investigation_ids
from groundmodel.domain.services.formation_surface_contacts import contact_feeds_surface
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


async def load_formation_picks(
    session: AsyncSession, model_id: UUID, logger: GroundModelLogger
) -> list[FormationPicks]:
    """Return the model's picks grouped per formation, youngest formation first.

    Parameters
    ----------
    session : AsyncSession
        Open database session.
    model_id : UUID
        Geological model.
    logger : GroundModelLogger
        The calling use case's logger (helpers never own one).

    Returns
    -------
    list[FormationPicks]
        One entry per formation with at least one contact in the model.
    """
    model_row = (
        await session.execute(
            select(GeologicalModelOrm.app_project_id, GeologicalModelOrm.excluded_borehole_ids).where(
                GeologicalModelOrm.id == model_id
            )
        )
    ).one_or_none()
    if model_row is None:
        logger.warning(f"load_formation_picks: model {model_id} not found")
        return []
    project_id = model_row.app_project_id
    excluded = set(model_row.excluded_borehole_ids or [])
    hidden = await InvestigationReviewRepository(session).hidden_investigation_ids(project_id)
    members = await load_section_member_investigation_ids(session, project_id=project_id)

    contacts = await GeologyRepository(session).list_contacts(model_id)
    anchored = [c for c in contacts if c.borehole_id is not None or c.cpt_id is not None]
    kept = [
        c
        for c in anchored
        if contact_feeds_surface(
            borehole_id=c.borehole_id,
            cpt_id=c.cpt_id,
            hidden_investigation_ids=hidden,
            excluded_borehole_ids=excluded,
            section_member_ids=members,
        )
    ]
    logger.info(
        f"load_formation_picks: model={model_id} contacts={len(contacts)} "
        f"synthetic_skipped={len(contacts) - len(anchored)} "
        f"off_model_skipped={len(anchored) - len(kept)}"
    )

    bh_ids = {c.borehole_id for c in kept if c.borehole_id is not None}
    cpt_ids = {c.cpt_id for c in kept if c.cpt_id is not None}
    boreholes = (
        {b.id: b for b in (await session.execute(select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids)))).scalars()}
        if bh_ids
        else {}
    )
    cpts = (
        {c.id: c for c in (await session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids)))).scalars()}
        if cpt_ids
        else {}
    )
    formation_ids = {c.formation_id for c in kept}
    formations = (
        {
            f.id: f
            for f in (
                await session.execute(
                    select(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(formation_ids))
                )
            ).scalars()
        }
        if formation_ids
        else {}
    )

    grouped: dict[UUID, list[PickObservation]] = defaultdict(list)
    skipped: dict[UUID, int] = defaultdict(int)
    for c in kept:
        kind = "borehole" if c.borehole_id is not None else "cpt"
        anchor = boreholes.get(c.borehole_id) if kind == "borehole" else cpts.get(c.cpt_id)
        if anchor is None or anchor.location_x is None or anchor.location_y is None or anchor.elevation_m is None:
            skipped[c.formation_id] += 1
            continue
        grouped[c.formation_id].append(
            PickObservation(
                contact_id=str(c.id),
                investigation_id=str(anchor.id),
                investigation_kind=kind,
                investigation_name=anchor.name or anchor.test_id,
                x_m=float(anchor.location_x),
                y_m=float(anchor.location_y),
                elevation_m=float(anchor.elevation_m) - float(c.depth_top_m),
                noise_floor_m=pick_noise_floor_m(kind),
            )
        )
    if any(skipped.values()):
        logger.warning(f"load_formation_picks: model={model_id} picks without position/elevation={dict(skipped)}")

    result = [
        FormationPicks(
            formation_id=fid,
            formation_name=formations[fid].name,
            display_order=formations[fid].display_order,
            picks=tuple(grouped.get(fid, [])),
            skipped_no_location=skipped.get(fid, 0),
        )
        for fid in formation_ids
        if fid in formations
    ]
    result.sort(key=lambda g: -g.display_order)
    return result
```

Check before running: `BoreholeOrm` and `CptOrm` both have `name` and `test_id` (they do on develop; `grep -n "name\|test_id" src/groundmodel/infrastructure/db/models/cpt_orm.py`).

- [ ] **Step 2: Gate** — `uv run ruff format` + `ruff check --fix` on both files; `uv run mypy src/groundmodel/application/load_formation_picks.py src/groundmodel/application/formation_picks.py`.
- [ ] **Step 3: Commit** — `feat(geostat): load model picks with the surface filters`.

---

### Task 9: Cache with background compute

**Files:**
- Create: `src/groundmodel/application/pick_observation_digest.py`, `src/groundmodel/application/contact_consistency_cache.py`
- Test: `tests/unit/application/test_pick_observation_digest.py`, `tests/unit/application/test_contact_consistency_cache.py`

- [ ] **Step 1: Write the failing tests**

`tests/unit/application/test_pick_observation_digest.py`:

```python
"""The cache key changes when a pick moves and not when the order changes."""

from __future__ import annotations

from groundmodel.application.pick_observation_digest import pick_observation_digest
from groundmodel.domain.value_objects.pick_observation import PickObservation


def _pick(cid: str, z: float) -> PickObservation:
    return PickObservation(cid, cid, "cpt", cid, 0.0, 0.0, z, 0.10)


def test_order_does_not_matter_but_a_moved_pick_does() -> None:
    """Same picks in another order → same digest; one pick moved 1 cm → new digest."""
    a = pick_observation_digest([_pick("a", -4.0), _pick("b", -3.0)])
    b = pick_observation_digest([_pick("b", -3.0), _pick("a", -4.0)])
    c = pick_observation_digest([_pick("a", -4.01), _pick("b", -3.0)])
    assert a == b
    assert a != c
```

`tests/unit/application/test_contact_consistency_cache.py`:

```python
"""Always on, never blocking: first ask schedules, a later ask returns the result."""

from __future__ import annotations

import asyncio

import pytest

from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation

pytestmark = pytest.mark.asyncio


def _picks(n: int, shift: float = 0.0) -> tuple[PickObservation, ...]:
    return tuple(PickObservation(f"c{i}", f"i{i}", "cpt", f"T{i}", i * 50.0, 0.0, -4.0 + shift, 0.1) for i in range(n))


class _CountingCompute:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, picks):  # noqa: ANN001, ANN204
        self.calls += 1
        return FormationPickCheck("checked", len(picks), None, 1.0, ())


async def _wait_ready(cache: ContactConsistencyCache, key, picks):  # noqa: ANN001, ANN202
    for _ in range(200):
        result = cache.lookup_or_schedule(key, picks)
        if result is not None:
            return result
        await asyncio.sleep(0.01)
    raise AssertionError("never became ready")


async def test_first_lookup_schedules_then_returns_the_result() -> None:
    """None while computing, then the result; one computation for unchanged picks."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    picks = _picks(8)
    assert cache.lookup_or_schedule(("m", "f"), picks) is None
    result = await _wait_ready(cache, ("m", "f"), picks)
    assert result.n_picks == 8
    assert cache.lookup_or_schedule(("m", "f"), picks) is result
    assert compute.calls == 1


async def test_a_changed_pick_recomputes() -> None:
    """Moving one pick invalidates the formation's result."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    await _wait_ready(cache, ("m", "f"), _picks(8))
    assert cache.lookup_or_schedule(("m", "f"), _picks(8, shift=0.5)) is None
    await _wait_ready(cache, ("m", "f"), _picks(8, shift=0.5))
    assert compute.calls == 2


async def test_too_few_picks_answer_at_once() -> None:
    """Below MIN_PICKS nothing is fitted, so there is nothing to wait for."""
    compute = _CountingCompute()
    cache = ContactConsistencyCache(compute=compute)
    assert cache.lookup_or_schedule(("m", "f"), _picks(3)) is not None
```

- [ ] **Step 2: Run, see them fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Implement**

`src/groundmodel/application/pick_observation_digest.py`:

```python
"""Digest of a formation's picks: the cache key of the pick consistency check."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from groundmodel.domain.value_objects.pick_observation import PickObservation


def pick_observation_digest(picks: Sequence[PickObservation]) -> str:
    """Return a SHA-256 over the picks, independent of their order.

    Parameters
    ----------
    picks : Sequence[PickObservation]
        The formation's picks.

    Returns
    -------
    str
        Hex digest; changes when any pick moves by 0.1 mm or more.
    """
    digest = hashlib.sha256()
    for p in sorted(picks, key=lambda q: q.contact_id):
        digest.update(f"{p.contact_id}|{p.x_m:.3f}|{p.y_m:.3f}|{p.elevation_m:.4f}|{p.noise_floor_m:.3f}\n".encode())
    return digest.hexdigest()
```

`src/groundmodel/application/contact_consistency_cache.py`:

```python
"""In-process cache of pick checks, computed in a worker thread (spec §5).

``lookup_or_schedule`` never blocks: it returns a cached result for unchanged picks,
or schedules the computation and returns ``None`` ("computing"). The cache lives in
the engine process and is rebuilt on the first request after a restart.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Hashable, Sequence

from groundmodel.application.pick_observation_digest import pick_observation_digest
from groundmodel.domain.services.geostat.geostat_constants import MIN_PICKS
from groundmodel.domain.services.geostat.leave_one_out_check import check_formation_picks
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

ComputeFn = Callable[[Sequence[PickObservation]], FormationPickCheck]


class ContactConsistencyCache(GroundModelLogger):
    """Per-(model, formation) results keyed by a digest of the picks."""

    def __init__(self, compute: ComputeFn = check_formation_picks) -> None:
        """Initialise an empty cache.

        Parameters
        ----------
        compute : Callable, optional
            The check to run; injectable for tests.
        """
        super().__init__(__name__)
        self._compute = compute
        self._results: dict[Hashable, tuple[str, FormationPickCheck]] = {}
        self._running: dict[Hashable, tuple[str, asyncio.Task[None]]] = {}

    def lookup_or_schedule(self, key: Hashable, picks: Sequence[PickObservation]) -> FormationPickCheck | None:
        """Return the cached result, or schedule a computation and return ``None``.

        Parameters
        ----------
        key : Hashable
            ``(model_id, formation_id)``.
        picks : Sequence[PickObservation]
            The formation's current picks.

        Returns
        -------
        FormationPickCheck or None
            ``None`` while the computation for these picks runs.
        """
        if len(picks) < MIN_PICKS:
            return self._compute(picks)
        digest = pick_observation_digest(picks)
        cached = self._results.get(key)
        if cached is not None and cached[0] == digest:
            return cached[1]
        running = self._running.get(key)
        if running is not None and running[0] == digest and not running[1].done():
            return None
        task = asyncio.get_running_loop().create_task(self._run(key, digest, tuple(picks)))
        self._running[key] = (digest, task)
        self.debug(f"pick check scheduled: key={key} picks={len(picks)}")
        return None

    async def _run(self, key: Hashable, digest: str, picks: tuple[PickObservation, ...]) -> None:
        """Compute in a worker thread (numpy releases the GIL) and store the result."""
        try:
            result = await asyncio.to_thread(self._compute, picks)
        except Exception:  # noqa: BLE001 — a failed check must not kill the engine loop
            self.exception(f"pick check crashed: key={key}")
            return
        running = self._running.get(key)
        if running is not None and running[0] == digest:
            self._results[key] = (digest, result)
            del self._running[key]
            self.success(f"pick check ready: key={key} status={result.status} flags={len(result.flags)}")
```

- [ ] **Step 4: Run, see them pass** — `uv run pytest tests/unit/application/test_pick_observation_digest.py tests/unit/application/test_contact_consistency_cache.py -q` → `4 passed`.
- [ ] **Step 5: Commit** — `feat(geostat): background cache for pick checks`.

---

### Task 10: Use case, schemas and router

**Files:**
- Create: `src/groundmodel/application/formation_consistency_entry.py`, `src/groundmodel/application/check_contact_consistency.py`, `src/groundmodel/api/schemas/project/contact_consistency.py`, `src/groundmodel/api/routers/geology/contact_consistency.py`
- Modify: `src/groundmodel/api/routers/geology/__init__.py`

- [ ] **Step 1: Implement** `src/groundmodel/application/formation_consistency_entry.py`:

```python
"""One formation's row in the pick consistency report."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck


@dataclass(frozen=True)
class FormationConsistencyEntry:
    """A formation and its check (``None`` while computing).

    Attributes
    ----------
    formation_id : UUID
        The formation.
    formation_name : str
        Display name.
    n_picks : int
        Picks that feed the model.
    skipped_no_location : int
        Picks dropped for a missing position or ground elevation.
    check : FormationPickCheck or None
        The result, or ``None`` while the background computation runs.
    """

    formation_id: UUID
    formation_name: str
    n_picks: int
    skipped_no_location: int
    check: FormationPickCheck | None
```

`src/groundmodel/application/check_contact_consistency.py`:

```python
"""Check-contact-consistency use case: the always-on pick check of a geological model.

Read-only. Loads the picks the surfaces use, asks the cache per formation and
returns what is ready; changed formations compute in the background.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.application.formation_consistency_entry import FormationConsistencyEntry
from groundmodel.application.load_formation_picks import load_formation_picks
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.model_kind import NON_STRATIGRAPHIC_KINDS
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CheckContactConsistency(GroundModelLogger):
    """Run the pick consistency check for one geological model."""

    def __init__(self, session: AsyncSession, cache: ContactConsistencyCache) -> None:
        """Initialise with a session and the process-wide cache.

        Parameters
        ----------
        session : AsyncSession
            Open database session.
        cache : ContactConsistencyCache
            Process-wide result cache.
        """
        super().__init__(__name__)
        self._session = session
        self._cache = cache

    async def execute(self, model_id: UUID) -> list[FormationConsistencyEntry]:
        """Return one entry per formation; ``check is None`` means still computing.

        Parameters
        ----------
        model_id : UUID
            Geological model.

        Returns
        -------
        list[FormationConsistencyEntry]
            Empty for litho and geotech models (not checked in this slice).
        """
        self.info(f"check_contact_consistency: model={model_id}")
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.kind in NON_STRATIGRAPHIC_KINDS:
            self.debug(f"check_contact_consistency: model={model_id} skipped (missing or non-geological)")
            return []
        groups = await load_formation_picks(self._session, model_id, self)
        entries = [
            FormationConsistencyEntry(
                formation_id=g.formation_id,
                formation_name=g.formation_name,
                n_picks=len(g.picks),
                skipped_no_location=g.skipped_no_location,
                check=self._cache.lookup_or_schedule((model_id, g.formation_id), g.picks),
            )
            for g in groups
        ]
        computing = sum(1 for e in entries if e.check is None)
        flags = sum(len(e.check.flags) for e in entries if e.check is not None)
        self.success(
            f"check_contact_consistency: model={model_id} formations={len(entries)} "
            f"computing={computing} flags={flags}"
        )
        return entries
```

`src/groundmodel/api/schemas/project/contact_consistency.py`:

```python
"""Response schemas of ``GET /projects/{pid}/geology/models/{mid}/contact-consistency``."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class PickCheckNeighbourResponse(BaseModel):
    """The closest other pick of the same formation."""

    contact_id: str
    investigation_name: str
    distance_m: float
    pick_elevation_m: float


class PickCheckFlagResponse(BaseModel):
    """A pick that does not fit its neighbours."""

    contact_id: str
    investigation_id: str
    investigation_kind: str
    investigation_name: str
    pick_elevation_m: float
    predicted_elevation_m: float
    sigma_m: float
    z: float
    nearest: PickCheckNeighbourResponse


class PickCheckFitResponse(BaseModel):
    """The fitted covariance model, as standard deviations for display."""

    range_m: float
    sill_sd_m: float
    nugget_sd_m: float


class FormationPickCheckResponse(BaseModel):
    """One formation's result; ``status`` is ``computing`` while it runs."""

    formation_id: UUID
    formation_name: str
    status: str
    n_picks: int
    skipped_no_location: int = 0
    fit: PickCheckFitResponse | None = None
    coverage_90: float | None = None
    flags: list[PickCheckFlagResponse] = Field(default_factory=list)
    reason: str | None = None


class ContactConsistencyResponse(BaseModel):
    """The model's report; ``status`` is ``computing`` while any formation runs."""

    model_id: UUID
    status: str
    formations: list[FormationPickCheckResponse]
```

`src/groundmodel/api/routers/geology/contact_consistency.py`:

```python
"""Geology API — always-on pick consistency check (uncertainty slice A0).

Mounted under /projects/{project_id}/geology by the package __init__.
"""

from __future__ import annotations

import math
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.contact_consistency import (
    ContactConsistencyResponse,
    FormationPickCheckResponse,
    PickCheckFitResponse,
    PickCheckFlagResponse,
    PickCheckNeighbourResponse,
)
from groundmodel.application.check_contact_consistency import CheckContactConsistency
from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.application.formation_consistency_entry import FormationConsistencyEntry
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

router = APIRouter()

# One cache per engine process: results survive between requests, not restarts.
contact_consistency_cache = ContactConsistencyCache()


def _to_response(entry: FormationConsistencyEntry) -> FormationPickCheckResponse:
    """Map a use-case entry to its API schema."""
    check = entry.check
    if check is None:
        return FormationPickCheckResponse(
            formation_id=entry.formation_id,
            formation_name=entry.formation_name,
            status="computing",
            n_picks=entry.n_picks,
            skipped_no_location=entry.skipped_no_location,
        )
    fit = (
        PickCheckFitResponse(
            range_m=check.model.range_m,
            sill_sd_m=math.sqrt(check.model.sill_m2),
            nugget_sd_m=math.sqrt(check.model.nugget_m2),
        )
        if check.model is not None
        else None
    )
    flags = [
        PickCheckFlagResponse(
            contact_id=f.pick.contact_id,
            investigation_id=f.pick.investigation_id,
            investigation_kind=f.pick.investigation_kind,
            investigation_name=f.pick.investigation_name,
            pick_elevation_m=f.pick.elevation_m,
            predicted_elevation_m=f.predicted_elevation_m,
            sigma_m=f.sigma_m,
            z=f.z_score,
            nearest=PickCheckNeighbourResponse(
                contact_id=f.nearest.contact_id,
                investigation_name=f.nearest.investigation_name,
                distance_m=f.nearest_distance_m,
                pick_elevation_m=f.nearest.elevation_m,
            ),
        )
        for f in check.flags
    ]
    return FormationPickCheckResponse(
        formation_id=entry.formation_id,
        formation_name=entry.formation_name,
        status=check.status,
        n_picks=entry.n_picks,
        skipped_no_location=entry.skipped_no_location,
        fit=fit,
        coverage_90=check.coverage_90,
        flags=flags,
        reason=check.reason,
    )


@router.get("/models/{model_id}/contact-consistency", response_model=ContactConsistencyResponse)
async def get_contact_consistency(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ContactConsistencyResponse:
    """Return the pick consistency report of a geological model.

    Never blocks on the computation: formations whose picks changed report
    ``computing`` and the desktop polls until ``status == "ready"``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model.
    session : AsyncSession
        Database session injected by FastAPI.

    Returns
    -------
    ContactConsistencyResponse
        Per-formation results.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or belongs to another project.
    """
    await get_in_project_or_404(session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found")
    entries = await CheckContactConsistency(session, contact_consistency_cache).execute(model_id)
    formations = [_to_response(e) for e in entries]
    status = "computing" if any(f.status == "computing" for f in formations) else "ready"
    return ContactConsistencyResponse(model_id=model_id, status=status, formations=formations)
```

In `src/groundmodel/api/routers/geology/__init__.py`: add `contact_consistency` to the `from . import (...)` list (alphabetical) and `router.include_router(contact_consistency.router)` after `router.include_router(surfaces.router)`.

- [ ] **Step 2: Gate** — ruff format/check on the four new files and `__init__.py`; `uv run mypy src/groundmodel/api/routers/geology/contact_consistency.py src/groundmodel/application/check_contact_consistency.py`; `uv run pytest tests/unit -q -k "geostat or contact_consistency or pick_observation"`.
- [ ] **Step 3: Commit** — one per file, `feat(api): GET contact-consistency for the always-on pick check` for the router.

---

### Task 11: Integration test (session main runs it; builders do not)

**Files:**
- Create: `tests/integration/api/test_contact_consistency.py`

- [ ] **Step 1: Write the test** (red until Tasks 8–10 exist; the session main runs it through `.\scripts\run-integration-tests.ps1`):

```python
"""End to end: a borehole/CPT-like pair 0.4 m apart that disagrees by 2 m is flagged."""

from __future__ import annotations

import asyncio

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._section_builders import covering_section


async def _setup(client: AsyncClient, session: AsyncSession, *, n: int, pair: bool) -> tuple[ProjectOrm, str]:
    project = ProjectOrm(id=uuid7(), name="Pick check", status="active")
    session.add(project)
    await session.flush()
    session.add(covering_section(project.id))
    holes = []
    for i in range(n):
        holes.append((f"BH-{i}", 50.0 * i, 5.0 + 0.005 * 50.0 * i))
    if pair:
        holes.append(("BH-P", 150.4, 5.0 + 0.005 * 150.0 + 2.0))
    rows = []
    for name, x, depth in holes:
        bh = BoreholeOrm(
            id=uuid7(), name=name, app_project_id=project.id, project_id="DOV", test_id=name,
            location_x=x, location_y=0.0, epsg=31370, elevation_m=10.0, total_depth_m=30.0,
        )
        rows.append((bh, depth))
        session.add(bh)
    await session.commit()
    formation = (await client.post(f"/projects/{project.id}/geology/formations", json={"name": "Egem", "color": "#84cc16"})).json()
    model = (await client.post(f"/projects/{project.id}/geology/models", json={"name": "Model"})).json()
    for bh, depth in rows:
        resp = await client.post(
            f"/projects/{project.id}/geology/models/{model['id']}/contacts",
            json={"formation_id": formation["id"], "borehole_id": str(bh.id), "depth_top_m": depth},
        )
        assert resp.status_code == 201, resp.text
    return project, model["id"]


async def _ready(client: AsyncClient, url: str) -> dict:
    for _ in range(100):
        body = (await client.get(url)).json()
        if body["status"] == "ready":
            return body
        await asyncio.sleep(0.1)
    raise AssertionError("contact-consistency never became ready")


async def test_disagreeing_pair_is_flagged(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """Seven smooth picks plus a 2 m outlier 0.4 m from BH-3 → BH-3 and BH-P flagged."""
    project, model_id = await _setup(async_client, db_session, n=7, pair=True)
    body = await _ready(async_client, f"/projects/{project.id}/geology/models/{model_id}/contact-consistency")
    (formation,) = body["formations"]
    assert formation["status"] == "checked"
    assert {f["investigation_name"] for f in formation["flags"]} == {"BH-3", "BH-P"}


async def test_too_few_picks_is_reported(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """Three picks → too_few_picks, no flags, ready at once."""
    project, model_id = await _setup(async_client, db_session, n=3, pair=False)
    body = (await async_client.get(f"/projects/{project.id}/geology/models/{model_id}/contact-consistency")).json()
    assert body["status"] == "ready"
    assert body["formations"][0]["status"] == "too_few_picks"


async def test_foreign_model_is_404(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """Project A cannot read project B's model."""
    _, model_id = await _setup(async_client, db_session, n=3, pair=False)
    other = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(other)
    await db_session.commit()
    resp = await async_client.get(f"/projects/{other.id}/geology/models/{model_id}/contact-consistency")
    assert resp.status_code == 404
```

- [ ] **Step 2: Session main runs** `.\scripts\run-integration-tests.ps1 tests/integration/api/test_contact_consistency.py` (red before Task 10 lands, green after). Read the skipped count on the summary.
- [ ] **Step 3: Commit** — `test(integration): contact-consistency flags a disagreeing pair`.

---

### Task 12: Benchmark

**Files:**
- Create: `tests/benchmarks/bench_pick_check.py`

- [ ] **Step 1: Write**

```python
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
    rng = np.random.default_rng(7)
    xy = rng.uniform(0.0, 1500.0, size=(n, 2))
    z = -4.0 + 1.5 * np.sin(xy[:, 0] / 250.0) + rng.normal(0.0, 0.2, size=n)
    return [PickObservation(f"c{i}", f"i{i}", "cpt", f"T{i}", float(x), float(y), float(v), 0.1) for i, ((x, y), v) in enumerate(zip(xy, z, strict=True))]


@pytest.mark.parametrize("n", [18, 50, 100, 200])
def bench_check_formation_picks(benchmark, n: int) -> None:  # noqa: ANN001 — pytest-benchmark fixture
    """Full refit leave-one-out for ``n`` picks of one formation."""
    picks = _picks(n)
    result = benchmark(check_formation_picks, picks)
    assert result.status == "checked"
```

- [ ] **Step 2: Run** — `uv run pytest tests/benchmarks/bench_pick_check.py --benchmark-enable -q`. Report the four means. If n = 200 is over 5 s, report it with a profile (`python -m cProfile`) and stop: the next step is the session main's call (spec §8: Numba only after profiling).
- [ ] **Step 3: Append the numbers** to `docs/benchmarks-journal.md` under a dated heading "2026-10-19 pick consistency check".
- [ ] **Step 4: Commit** — `test(bench): pick consistency check at 18-200 picks`; `docs(bench): …`.

---

### Task 13: Desktop types and client

**Files:**
- Modify: `desktop/src/renderer/src/api/clients/geology.types.ts`, `desktop/src/renderer/src/api/clients/geology.ts`, `desktop/src/renderer/src/api/client.ts`

- [ ] **Step 1: Append to `geology.types.ts`** (after `CrossingValidationResponse`):

```ts
/** Closest other pick of the same formation (pick consistency check). */
export interface PickCheckNeighbourResponse {
  contact_id: string
  investigation_name: string
  distance_m: number
  pick_elevation_m: number
}

/** A pick that does not fit its neighbours (|z| > 3). */
export interface PickCheckFlagResponse {
  contact_id: string
  investigation_id: string
  investigation_kind: 'cpt' | 'borehole'
  investigation_name: string
  pick_elevation_m: number
  predicted_elevation_m: number
  sigma_m: number
  z: number
  nearest: PickCheckNeighbourResponse
}

/** One formation's pick check; ``computing`` while the engine runs it. */
export interface FormationPickCheckResponse {
  formation_id: string
  formation_name: string
  status: 'checked' | 'too_few_picks' | 'fit_failed' | 'computing'
  n_picks: number
  skipped_no_location: number
  fit: { range_m: number; sill_sd_m: number; nugget_sd_m: number } | null
  coverage_90: number | null
  flags: PickCheckFlagResponse[]
  reason: string | null
}

/** Response from ``GET .../contact-consistency``. */
export interface ContactConsistencyResponse {
  model_id: string
  status: 'ready' | 'computing'
  formations: FormationPickCheckResponse[]
}
```

- [ ] **Step 2: Client.** In `geology.ts` add `ContactConsistencyResponse` to the `import type { … } from './geology.types'` list and add, next to `validateCrossings`:

```ts
  getContactConsistency: (
    projectId: string,
    modelId: string,
  ): Promise<ContactConsistencyResponse> =>
    get(`/projects/${projectId}/geology/models/${modelId}/contact-consistency`),
```

In `api/client.ts`, add `ContactConsistencyResponse`, `FormationPickCheckResponse`, `PickCheckFlagResponse` to the type re-export block that ends with `} from './clients/geology'`.

- [ ] **Step 3: Gate** — `cd desktop && npx tsc --noEmit -p tsconfig.web.json` → clean.
- [ ] **Step 4: Commit** — one per file.

---

### Task 14: `useContactConsistency` hook

**Files:**
- Create: `desktop/src/renderer/src/hooks/useContactConsistency.ts`, `desktop/src/renderer/src/hooks/useContactConsistency.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// Always on, in the background (owner 2026-10-19): fetch when the model opens,
// wait 2 s after a pick edit, poll while the engine computes, never block.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PICK_CHECK_DEBOUNCE_MS, PICK_CHECK_POLL_MS, useContactConsistency } from './useContactConsistency'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { geology: { getContactConsistency: vi.fn() } } }))
vi.mock('../utils/log', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

const mockGet = vi.mocked(api.geology.getContactConsistency)
const ready = { model_id: 'm1', status: 'ready' as const, formations: [] }
const computing = { model_id: 'm1', status: 'computing' as const, formations: [] }

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  mockGet.mockReset()
})

describe('useContactConsistency', () => {
  it('opening a model fetches at once', async () => {
    mockGet.mockResolvedValue(ready)
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
  })

  it('a pick edit waits 2 s before asking again', async () => {
    mockGet.mockResolvedValue(ready)
    const { rerender } = renderHook(({ s }) => useContactConsistency('p1', 'm1', s), { initialProps: { s: 0 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ s: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(PICK_CHECK_DEBOUNCE_MS - 1) })
    expect(mockGet).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('polls while the engine computes, then reports ready', async () => {
    mockGet.mockResolvedValueOnce(computing).mockResolvedValueOnce(ready)
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('computing')
    await act(async () => { await vi.advanceTimersByTimeAsync(PICK_CHECK_POLL_MS) })
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ready')
  })

  it('a failed request is not a clean model', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('failed')
  })

  it('no model, no request', async () => {
    const { result } = renderHook(() => useContactConsistency('p1', null, 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(mockGet).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
})
```

- [ ] **Step 2: Run, see it fail** — `cd desktop && npx vitest run src/renderer/src/hooks/useContactConsistency.test.tsx` → cannot resolve `./useContactConsistency`.
- [ ] **Step 3: Implement** `desktop/src/renderer/src/hooks/useContactConsistency.ts`:

```ts
// Always-on pick consistency check (uncertainty slice A0, owner 2026-10-19).
//
// The engine computes in the background and answers ``computing`` until a
// changed formation is done, so this hook never blocks: it fetches when a
// model opens, waits PICK_CHECK_DEBOUNCE_MS after a pick edit (a drag fires
// many edits), and polls every PICK_CHECK_POLL_MS while the answer is
// ``computing``. The model id must already be project-guarded by the caller
// (``modelOfProject``), so a project switch sends no request for the old model.

import { useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import type { FormationPickCheckResponse } from '../api/client'
import { log } from '../utils/log'

export const PICK_CHECK_DEBOUNCE_MS = 2000
export const PICK_CHECK_POLL_MS = 2000

export type PickCheckStatus = 'idle' | 'computing' | 'ready' | 'failed'

export interface ContactConsistency {
  status: PickCheckStatus
  formations: FormationPickCheckResponse[]
}

/**
 * Track the pick consistency report of a geological model.
 *
 * Parameters
 * ----------
 * projectId
 *     The active project id.
 * modelId
 *     The active geological model id, or ``null`` when none.
 * refreshSignal
 *     Bumps on every contact mutation (``crossingsRefreshCounter``).
 *
 * Returns
 * -------
 * ContactConsistency
 *     ``status`` and the per-formation results.
 */
export function useContactConsistency(
  projectId: string,
  modelId: string | null,
  refreshSignal: number,
): ContactConsistency {
  const [state, setState] = useState<ContactConsistency>({ status: 'idle', formations: [] })
  const lastModelRef = useRef<string | null>(null)

  useEffect(() => {
    if (modelId === null) {
      lastModelRef.current = null
      setState({ status: 'idle', formations: [] })
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const fetchOnce = (): void => {
      api.geology
        .getContactConsistency(projectId, modelId)
        .then(resp => {
          if (cancelled) return
          if (resp.status === 'computing') {
            setState({ status: 'computing', formations: resp.formations })
            timer = setTimeout(fetchOnce, PICK_CHECK_POLL_MS)
            return
          }
          setState({ status: 'ready', formations: resp.formations })
        })
        .catch(err => {
          // ERROR: an unchecked model must not look like a clean one.
          log.error('geology', `getContactConsistency failed for ${modelId}`, err)
          if (cancelled) return
          setState({ status: 'failed', formations: [] })
        })
    }
    const delay = lastModelRef.current === modelId ? PICK_CHECK_DEBOUNCE_MS : 0
    lastModelRef.current = modelId
    timer = setTimeout(fetchOnce, delay)
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [projectId, modelId, refreshSignal])

  return state
}
```

- [ ] **Step 4: Run, see it pass** — `5 passed`. Then run the `react-hook-order-check` skill on the file.
- [ ] **Step 5: Commit.**

---

### Task 15: `PickCheckBanner` + EN/NL strings

**Files:**
- Create: `desktop/src/renderer/src/shell/stages/geology/PickCheckBanner.tsx`, `desktop/src/renderer/src/shell/stages/geology/PickCheckBanner.test.tsx`
- Modify: `desktop/src/renderer/src/i18n/locales/en/models.ts`, `desktop/src/renderer/src/i18n/locales/nl/models.ts`

- [ ] **Step 1: Add the strings** next to `'geology.crossingsNotChecked'` in both catalogues.

EN (`en/models.ts`):

```ts
  'geology.pickCheck.computing': 'Checking each pick against its neighbours.',
  'geology.pickCheck.failed': 'The pick check failed. The picks were not checked.',
  'geology.pickCheck.titleOne': '1 pick to check',
  'geology.pickCheck.titleMany': '{n} picks to check',
  'geology.pickCheck.row': '{test}: {pick} m TAW, expected {expected} ± {sigma} m ({times}× further off than normal)',
  'geology.pickCheck.nearest': 'Nearest test: {test}, {distance} m away, {pick} m TAW',
  'geology.pickCheck.fitLine': 'Range {range} m, pick uncertainty {nugget} m, {coverage} % of picks inside their 90 % band',
  'geology.pickCheck.show': 'Show',
```

NL (`nl/models.ts`):

```ts
  'geology.pickCheck.computing': 'Elke grens wordt vergeleken met de naburige proeven.',
  'geology.pickCheck.failed': 'De controle van de grenzen is mislukt. De grenzen zijn niet gecontroleerd.',
  'geology.pickCheck.titleOne': '1 grens om te controleren',
  'geology.pickCheck.titleMany': '{n} grenzen om te controleren',
  'geology.pickCheck.row': '{test}: {pick} m TAW, verwacht {expected} ± {sigma} m ({times}× verder af dan normaal)',
  'geology.pickCheck.nearest': 'Dichtste proef: {test}, op {distance} m, {pick} m TAW',
  'geology.pickCheck.fitLine': 'Bereik {range} m, onzekerheid van de grens {nugget} m, {coverage} % van de grenzen binnen hun 90 %-band',
  'geology.pickCheck.show': 'Toon',
```

- [ ] **Step 2: Write the failing test** `PickCheckBanner.test.tsx`:

```tsx
// The banner names the pick, the guess, how far off it is and the nearest test;
// "Show" opens a section through BOTH tests.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PickCheckBanner from './PickCheckBanner'
import type { FormationPickCheckResponse } from '../../../api/client'
import { createTranslator } from '../../../i18n/translate'

const t = createTranslator('en')

const egem: FormationPickCheckResponse = {
  formation_id: 'f1',
  formation_name: 'Lid van Egem',
  status: 'checked',
  n_picks: 17,
  skipped_no_location: 0,
  fit: { range_m: 291, sill_sd_m: 4.2, nugget_sd_m: 0.61 },
  coverage_90: 0.82,
  reason: null,
  flags: [
    {
      contact_id: 'c-b16',
      investigation_id: 'b16',
      investigation_kind: 'borehole',
      investigation_name: 'GEO-02/146-B16',
      pick_elevation_m: -2.45,
      predicted_elevation_m: -4.14,
      sigma_m: 0.31,
      z: 5.4,
      nearest: { contact_id: 'c-s16', investigation_name: 'GEO-02/145-S16', distance_m: 0.4, pick_elevation_m: -4.15 },
    },
  ],
}

describe('PickCheckBanner', () => {
  it('lists a flagged pick in plain words', () => {
    render(<PickCheckBanner status="ready" formations={[egem]} onShow={vi.fn()} t={t} />)
    expect(screen.getByText('1 pick to check')).toBeTruthy()
    expect(screen.getByText(/GEO-02\/146-B16: -2.45 m TAW, expected -4.14 ± 0.31 m \(5.4× further off than normal\)/)).toBeTruthy()
    expect(screen.getByText(/Nearest test: GEO-02\/145-S16, 0.4 m away/)).toBeTruthy()
  })

  it('Show opens a section through both tests', () => {
    const onShow = vi.fn()
    render(<PickCheckBanner status="ready" formations={[egem]} onShow={onShow} t={t} />)
    fireEvent.click(screen.getByTestId('pick-check-show-c-b16'))
    expect(onShow).toHaveBeenCalledWith(['c-b16', 'c-s16'])
  })

  it('a clean model shows nothing', () => {
    const { container } = render(
      <PickCheckBanner status="ready" formations={[{ ...egem, flags: [] }]} onShow={vi.fn()} t={t} />,
    )
    expect(container.textContent).toBe('')
  })

  it('computing and failed are said out loud', () => {
    const { rerender } = render(<PickCheckBanner status="computing" formations={[]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-computing')).toBeTruthy()
    rerender(<PickCheckBanner status="failed" formations={[]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-failed')).toBeTruthy()
  })
})
```

Before running: confirm the translator factory name in `i18n/translate.ts` (`grep -n "export function" desktop/src/renderer/src/i18n/translate.ts`). If it is not `createTranslator`, use the factory the other component tests use (`grep -rn "from '../../../i18n/translate'" desktop/src/renderer/src/shell/stages/geology/*.test.tsx`) and keep everything else unchanged.

- [ ] **Step 3: Run, see it fail** — cannot resolve `./PickCheckBanner`.
- [ ] **Step 4: Implement** `PickCheckBanner.tsx`:

```tsx
// Geology inspector — always-on pick consistency banner (uncertainty slice A0).
//
// Presentational only: the inspector owns useContactConsistency and the
// open-a-section navigation. Styling matches GeologyCrossingsBanner (amber
// for a known problem, neutral for "still checking"). A clean model renders
// nothing: silence is the success state, as for the crossings banner.

import { AlertTriangle, Info } from 'lucide-react'

import type { FormationPickCheckResponse } from '../../../api/client'
import type { PickCheckStatus } from '../../../hooks/useContactConsistency'
import type { Translator } from '../../../i18n/translate'

interface PickCheckBannerProps {
  status: PickCheckStatus
  formations: readonly FormationPickCheckResponse[]
  /** Open a cross-section through these contacts (flagged pick + its nearest). */
  onShow: (contactIds: readonly string[]) => void
  t: Translator
}

const AMBER =
  'rounded border border-status-amber bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[11px] text-text-primary'
const NEUTRAL = 'rounded border border-border-subtle bg-surface-app px-2 py-1.5 text-[11px] text-text-muted'

/**
 * Render the pick consistency banner.
 *
 * Parameters
 * ----------
 * status
 *     Hook status: idle, computing, ready or failed.
 * formations
 *     Per-formation results from the engine.
 * onShow
 *     Fired with the flagged pick's and its nearest test's contact ids.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The banner, or an empty fragment for a clean model.
 */
export default function PickCheckBanner({ status, formations, onShow, t }: PickCheckBannerProps): JSX.Element {
  const flagged = formations.filter(f => f.flags.length > 0)
  const count = flagged.reduce((n, f) => n + f.flags.length, 0)

  if (status === 'failed') {
    return (
      <div className={AMBER} role="alert" data-testid="pick-check-failed">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} />
          <span>{t('geology.pickCheck.failed')}</span>
        </div>
      </div>
    )
  }
  if (status === 'computing' && count === 0) {
    return (
      <div className={NEUTRAL} role="status" data-testid="pick-check-computing">
        <div className="flex items-center gap-1.5">
          <Info size={12} />
          <span>{t('geology.pickCheck.computing')}</span>
        </div>
      </div>
    )
  }
  if (count === 0) return <></>

  return (
    <div className={AMBER} role="alert" data-testid="pick-check-banner">
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={12} />
        <span>{count === 1 ? t('geology.pickCheck.titleOne') : t('geology.pickCheck.titleMany', { n: count })}</span>
      </div>
      {flagged.map(f => (
        <div key={f.formation_id} className="mt-1" data-testid={`pick-check-formation-${f.formation_id}`}>
          <div className="font-medium">{f.formation_name}</div>
          <ul className="ml-5 list-disc space-y-0.5">
            {f.flags.map(flag => (
              <li key={flag.contact_id}>
                <div>
                  {t('geology.pickCheck.row', {
                    test: flag.investigation_name,
                    pick: flag.pick_elevation_m.toFixed(2),
                    expected: flag.predicted_elevation_m.toFixed(2),
                    sigma: flag.sigma_m.toFixed(2),
                    times: Math.abs(flag.z).toFixed(1),
                  })}
                </div>
                <div className="text-text-muted">
                  {t('geology.pickCheck.nearest', {
                    test: flag.nearest.investigation_name,
                    distance: flag.nearest.distance_m.toFixed(1),
                    pick: flag.nearest.pick_elevation_m.toFixed(2),
                  })}
                </div>
                <button
                  type="button"
                  className="mt-0.5 rounded px-1 py-0.5 underline hover:bg-amber-100 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                  onClick={() => onShow([flag.contact_id, flag.nearest.contact_id])}
                  data-testid={`pick-check-show-${flag.contact_id}`}
                >
                  {t('geology.pickCheck.show')}
                </button>
              </li>
            ))}
          </ul>
          {f.fit !== null && f.coverage_90 !== null && (
            <div className="mt-0.5 text-text-muted">
              {t('geology.pickCheck.fitLine', {
                range: Math.round(f.fit.range_m),
                nugget: f.fit.nugget_sd_m.toFixed(2),
                coverage: Math.round(f.coverage_90 * 100),
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

If the catalogue's number convention for NL uses a decimal comma elsewhere (`grep -rn "toLocaleString\|formatDecimal" desktop/src/renderer/src/utils | head`), use that helper instead of `toFixed` and adapt the test's expected strings; report which you chose.

- [ ] **Step 5: Run** — the banner test `4 passed`; `npx vitest run src/renderer/src/i18n` (locale parity) green.
- [ ] **Step 6: Commit** — one per file.

---

### Task 16: Wire into the Geology inspector

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx`
- Modify: every test that mocks `api.geology` for a rendered inspector or App: `App.smoke.test.tsx`, `shell/stages/geology/GeologyInspector.crossingSection.test.tsx`, `GeologyInspector.roster.test.tsx`, `GeologyInspector.smoke.test.tsx`, `GeologyStage.test.tsx`, `shell/stages/sections/geoDeepLink.test.tsx` (check each: only those whose mock defines `validateCrossings` for a rendered inspector need the new mock).

- [ ] **Step 1: Extract the navigation.** In `GeologyInspector.tsx`, rename the body of `handleClickCrossingIssue` into `openSectionForContacts = useCallback((contactIds: readonly string[]) => { … }, [same deps])`, replacing every `issue.contact_ids` with `contactIds` and the `crossingIssueTests(issue, …)` call with `crossingIssueTests({ contact_ids: [...contactIds] }, …)`. Then:

```tsx
  const handleClickCrossingIssue = useCallback(
    (issue: GapIssueResponse) => openSectionForContacts(issue.contact_ids),
    [openSectionForContacts],
  )
```

- [ ] **Step 2: Add the hook** right after the `useCrossingsValidation(...)` call (above every early return; run the `react-hook-order-check` skill afterwards):

```tsx
  // Always-on pick consistency check (uncertainty slice A0): same refresh
  // signal as the crossings banner, so a pick edit re-checks after 2 s.
  const pickCheck = useContactConsistency(projectId, activeGeologicalModel?.id ?? null, crossingsRefreshCounter)
```

and the import `import { useContactConsistency } from '../../../hooks/useContactConsistency'` plus `import PickCheckBanner from './PickCheckBanner'`.

- [ ] **Step 3: Render** directly under `<GeologyCrossingsBanner … />`:

```tsx
      {/* Pick consistency check (uncertainty slice A0, owner 2026-10-19). */}
      <PickCheckBanner
        status={pickCheck.status}
        formations={pickCheck.formations}
        onShow={openSectionForContacts}
        t={t}
      />
```

- [ ] **Step 4: Mocks.** In each test file from the list whose `api.geology` mock renders the inspector, add beside `validateCrossings`:

```ts
        getContactConsistency: vi.fn().mockResolvedValue({ model_id: '', status: 'ready', formations: [] }),
```

- [ ] **Step 5: Gates** — `cd desktop && npx vitest run src/renderer/src/shell/stages/geology src/renderer/src/App.smoke.test.tsx src/renderer/src/shell/stages/sections/geoDeepLink.test.tsx` green; `npx tsc --noEmit -p tsconfig.web.json` clean; `strix-section-geometry-check` is not needed (no along-section drawing).
- [ ] **Step 6: Commit** — one per file.

---

### Task 17: Manual page at explainer depth, with figures

**Files:**
- Modify: `pyproject.toml` (docs group), `uv.lock`
- Create: `scripts/manual_figures/pick_check_figures.py`, `docs/manual/_static/figures/pick-check/{01-votes,02-guess,03-variogram,04-bands}.png`
- Modify: `docs/manual/chapters/03-methods.rst`, `docs/api.md`

- [ ] **Step 1: Dependency.** Add `"matplotlib>=3.10"` to the `docs` dependency group in `pyproject.toml`; run `uv lock` and `uv sync --group dev --group docs`.

- [ ] **Step 2: Figure script** `scripts/manual_figures/pick_check_figures.py`:

```python
"""Generate the pick consistency check figures of the user manual from the fixture.

Run with::

    uv run --group docs python scripts/manual_figures/pick_check_figures.py

Writes four PNGs to docs/manual/_static/figures/pick-check/. Uses the shipped domain
code (no second implementation), so the manual always shows what the app computes.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from groundmodel.domain.services.geostat.fit_covariance_model import fit_covariance_model  # noqa: E402
from groundmodel.domain.services.geostat.matern_covariance import (  # noqa: E402
    expected_absolute_difference,
    matern32_covariance,
    pairwise_distances,
)
from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging  # noqa: E402
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "geostat" / "worked_example_top_egem.json"
OUT = ROOT / "docs" / "manual" / "_static" / "figures" / "pick-check"
HIDDEN = "GEO-02/146-B16"
BLUE, GREEN, RED, GREY = "#2563eb", "#16a34a", "#dc2626", "#6b7280"


def _load() -> tuple[list[dict], dict]:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for p in data["picks"]:
        p["z"] = p["ground_elevation_m"] - p["depth_top_m"]
        p["floor2"] = pick_noise_floor_m(p["kind"]) ** 2
    return data["picks"], data["section"]


def _arrays(picks: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xy = np.array([[p["x"], p["y"]] for p in picks])
    return xy, np.array([p["z"] for p in picks]), np.array([p["floor2"] for p in picks])


def _short(name: str) -> str:
    return name.split("-")[-1] if name.startswith("GEO-") else name


def figure_votes_and_guess(picks: list[dict]) -> None:
    """Figures 1 and 2: the neighbours' votes for B16, and the guess against the pick."""
    others = [p for p in picks if p["name"] != HIDDEN]
    hidden = next(p for p in picks if p["name"] == HIDDEN)
    xy, z, f2 = _arrays(others)
    dist = pairwise_distances(xy, xy)
    model = fit_covariance_model(dist, z, f2)
    k_data = matern32_covariance(dist, model.sill_m2, model.range_m) + np.diag(f2 + model.nugget_m2)
    target = np.array([[hidden["x"], hidden["y"]]])
    k_target = matern32_covariance(pairwise_distances(target, xy)[0], model.sill_m2, model.range_m)
    guess, variance, weights = ordinary_kriging(k_data, k_target, z, model.sill_m2)
    sigma = float(np.sqrt(variance + hidden["floor2"] + model.nugget_m2))

    x0, y0 = xy.min(axis=0)
    fig, ax = plt.subplots(figsize=(7, 5))
    for (x, y), w in zip(xy, weights, strict=True):
        if w > 0.005:
            ax.plot([x - x0, hidden["x"] - x0], [y - y0, hidden["y"] - y0], color=BLUE, lw=1 + 12 * w, alpha=0.6)
    ax.scatter(xy[:, 0] - x0, xy[:, 1] - y0, color=BLUE, zorder=3)
    for p, w in zip(others, weights, strict=True):
        ax.annotate(f"{_short(p['name'])} {w:.0%}" if w > 0.01 else _short(p["name"]), (p["x"] - x0, p["y"] - y0), fontsize=7, xytext=(3, 3), textcoords="offset points")
    ax.scatter([hidden["x"] - x0], [hidden["y"] - y0], marker="x", s=120, color=GREY, zorder=4)
    ax.annotate("B16 (covered up)", (hidden["x"] - x0, hidden["y"] - y0), fontsize=8, xytext=(6, -12), textcoords="offset points")
    ax.set(xlabel="east (m)", ylabel="north (m)", title="Step 1: each neighbour votes; thicker line = bigger vote", aspect="equal")
    fig.tight_layout()
    fig.savefig(OUT / "01-votes.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 1.8))
    ax.barh([0], [2 * 1.645 * sigma], left=[guess - 1.645 * sigma], height=0.4, color=GREEN, alpha=0.5)
    ax.plot([guess], [0], "o", color=GREEN)
    ax.plot([hidden["z"]], [0], "D", color=RED)
    ax.annotate(f"guess {guess:.2f} ± {sigma:.2f} m", (guess, 0), xytext=(0, 14), textcoords="offset points", ha="center", fontsize=8)
    ax.annotate(f"B16 pick {hidden['z']:.2f} m  (z = {(hidden['z'] - guess) / sigma:.1f})", (hidden["z"], 0), xytext=(0, -18), textcoords="offset points", ha="center", fontsize=8, color=RED)
    ax.set(yticks=[], xlabel="top of Egem (m TAW)", ylim=(-1, 1), title="Step 2: the guess (green, 90 % band) against the real pick")
    fig.tight_layout()
    fig.savefig(OUT / "02-guess.png", dpi=150)
    plt.close(fig)


def figure_variogram(picks: list[dict]) -> None:
    """Figure 3: every pair of tests and the fitted 'normal difference' curve."""
    others = [p for p in picks if p["name"] != HIDDEN]
    xy, z, f2 = _arrays(others)
    model = fit_covariance_model(pairwise_distances(xy, xy), z, f2)
    pairs = []
    for i in range(len(picks)):
        for j in range(i + 1, len(picks)):
            a, b = picks[i], picks[j]
            d = float(np.hypot(a["x"] - b["x"], a["y"] - b["y"]))
            pairs.append((max(d, 0.3), abs(a["z"] - b["z"]), {a["name"], b["name"]} == {HIDDEN, "GEO-02/145-S16"}))
    h = np.geomspace(0.3, 2000, 200)
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.scatter([p[0] for p in pairs if not p[2]], [p[1] for p in pairs if not p[2]], s=10, color=BLUE, alpha=0.5, label="one pair of tests")
    ax.plot(h, expected_absolute_difference(h, model, pick_noise_m2=2 * 0.10**2), color=GREEN, lw=2.5, label="normal difference (fitted)")
    hs = [p for p in pairs if p[2]][0]
    ax.scatter([hs[0]], [hs[1]], s=80, color=RED, zorder=4, label="B16 + S16")
    ax.set(xscale="log", xlabel="distance between the two tests (m)", ylabel="difference in top of Egem (m)", title="Step 3: what is 'normal'?")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "03-variogram.png", dpi=150)
    plt.close(fig)


def figure_bands(picks: list[dict], section: dict) -> None:
    """Figure 4: the P5-P95 band on Cross-section 1 with and without B16's wrong pick."""
    start = np.array([section["start_x"], section["start_y"]])
    end = np.array([section["end_x"], section["end_y"]])
    length = float(np.linalg.norm(end - start))
    along = np.linspace(0, length, 240)
    line = start + np.outer(along / length, end - start)
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for subset, colour, label in (
        (picks, RED, "with B16's wrong pick"),
        ([p for p in picks if p["name"] != HIDDEN], GREEN, "without it"),
    ):
        xy, z, f2 = _arrays(subset)
        dist = pairwise_distances(xy, xy)
        model = fit_covariance_model(dist, z, f2)
        k_data = matern32_covariance(dist, model.sill_m2, model.range_m) + np.diag(f2 + model.nugget_m2)
        means, sds = [], []
        for point in line:
            k_target = matern32_covariance(pairwise_distances(point[None, :], xy)[0], model.sill_m2, model.range_m)
            guess, variance, _ = ordinary_kriging(k_data, k_target, z, model.sill_m2)
            means.append(guess)
            sds.append(np.sqrt(variance))
        means_a, sds_a = np.array(means), np.array(sds)
        width = float(np.median(2 * 1.645 * sds_a))
        ax.fill_between(along, means_a - 1.645 * sds_a, means_a + 1.645 * sds_a, color=colour, alpha=0.3, label=f"{label}: band {width:.1f} m wide")
    direction = (end - start) / length
    normal = np.array([-direction[1], direction[0]])
    for p in picks:
        rel = np.array([p["x"], p["y"]]) - start
        if abs(rel @ normal) <= section["projection_buffer_m"] and -5 <= rel @ direction <= length + 5:
            ax.plot(rel @ direction, p["z"], "D" if p["name"] == HIDDEN else "o", color=RED if p["name"] == HIDDEN else "black", ms=5)
    ax.set(xlabel=f"along {section['name']} (m)", ylabel="top of Egem (m TAW)", title="Step 4: one wrong pick widens the band everywhere")
    ax.legend(fontsize=8, loc="lower right")
    fig.tight_layout()
    fig.savefig(OUT / "04-bands.png", dpi=150)
    plt.close(fig)


def main() -> None:
    """Write all four figures."""
    OUT.mkdir(parents=True, exist_ok=True)
    picks, section = _load()
    figure_votes_and_guess(picks)
    figure_variogram(picks)
    figure_bands(picks, section)
    print(f"[pick-check figures] wrote 4 PNGs to {OUT}")


if __name__ == "__main__":
    main()
```

Run it; open the four PNGs and check by eye: S16 ≈ 96 % of the vote; guess ≈ −4.1, pick −2.45; the red B16+S16 dot far above the green curve; the red band wider than the green.

- [ ] **Step 3: Manual section.** Append to `docs/manual/chapters/03-methods.rst`:

```rst
Pick consistency check
----------------------

StrixGeo checks every pick of the geological model against its neighbours, always
and in the background. A pick that does not fit gets a flag in the Stratigraphy
stage: "⚠ 1 pick to check". The check never changes a pick; you decide.

**Why it matters.** A wrong pick bends the model at its test, and it makes the
model look less certain everywhere: every uncertainty estimate learns "how much do
picks scatter?" from all picks together. On the worked example, one wrong pick
makes the band of the top of Egem on Cross-section 1 about 40 % wider along the
whole section (figure 4).

The method in plain steps
~~~~~~~~~~~~~~~~~~~~~~~~~

The example is the top of Egem in the worked example, test GEO-02/146-B16.

1. **Cover up one test.** Pretend B16 was never drilled.
2. **Guess its pick from the neighbours.** Every neighbour gets a vote; a close
   neighbour gets a big vote. S16 stands 0.4 m from B16 and gets 96 % of the vote.

   .. image:: ../_static/figures/pick-check/01-votes.png
      :width: 90%

3. **Compare.** The neighbours guess about −4.1 m TAW, give or take 0.3 m. B16
   says −2.45 m: 1.7 m off, more than five times further than normal.

   .. image:: ../_static/figures/pick-check/02-guess.png
      :width: 90%

4. **Flag** when a pick is more than 3 times further off than normal. By chance
   alone that happens about once in 370 picks.

Repeat for every test of every formation.

What is "normal"?
~~~~~~~~~~~~~~~~~

Every dot below is one pair of tests: how far apart they are, and how much their
top of Egem differs. Close tests differ little; far tests differ more. The green
curve is the normal difference, fitted to your picks. B16 and S16 stand almost on
top of each other, yet differ by 1.7 m: the red dot, far above the curve.

.. image:: ../_static/figures/pick-check/03-variogram.png
   :width: 90%

The math
~~~~~~~~

The top of a formation is treated as a smooth random surface plus pick noise
(ordinary kriging, a Gaussian process):

.. math::

   z(x) = \mu + Y(x) + \varepsilon,\qquad
   C(h) = s\,\bigl(1 + \sqrt{3}\,h/r\bigr)\,e^{-\sqrt{3}\,h/r},\qquad
   \tau_i^2 = f_i^2 + n

* :math:`\mu` is an unknown constant level, *s* (sill) the variation between far-apart
  tests, *r* (range) the distance over which tests stop being related, *n* the extra
  pick noise, :math:`f_i` the floor of the pick's source: 0.25 m for a borehole log,
  0.10 m for a CPT. A pick is never treated as more accurate than its floor.
* The green curve is the expected difference of two picks *h* apart,
  :math:`\sqrt{2\gamma(h) + f_a^2 + f_b^2}\,\sqrt{2/\pi}` with
  :math:`\gamma(h) = n + s - C(h)`.
* *s*, *r* and *n* are fitted by restricted maximum likelihood: the values under
  which your picks are the most probable outcome.
* The votes *w* and the "give or take" σ follow from the covariances:

.. math::

   w = K^{-1}k + K^{-1}\mathbf{1}\,\frac{u}{\mathbf{1}^\top K^{-1}\mathbf{1}},\quad
   u = 1 - \mathbf{1}^\top K^{-1}k,\quad
   \sigma^2 = s - k^\top K^{-1}k + \frac{u^2}{\mathbf{1}^\top K^{-1}\mathbf{1}} + \tau_i^2

* The flag: :math:`z = (\text{pick} - \text{guess})/\sigma`, flagged when
  :math:`|z| > 3`.

The math in easy terms
~~~~~~~~~~~~~~~~~~~~~~

* **Votes are not inverse-distance weights.** Inverse distance gives votes by
  distance alone and no σ. Kriging takes the votes from the fitted curve, makes two
  neighbours that stand together share one vote, and says how sure the guess is.
* **Where "give or take 0.3 m" comes from.** The guess for B16 is almost only S16.
  S16's pick has noise of about 0.2 m and so has B16's; over 0.4 m the ground hardly
  changes. Two independent errors of 0.2 m together give
  :math:`\sqrt{0.2^2 + 0.2^2} \approx 0.3` m.
* **Why each test is judged by a model fitted without it.** If B16 stays in while
  the curve is fitted, the computer learns from B16 itself that two tests at one spot
  can differ by more than a metre, and B16 then looks normal. Fitted without it, B16
  stands out clearly.

Why it matters for the uncertainty bands
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. image:: ../_static/figures/pick-check/04-bands.png
   :width: 90%

The bands of the model's uncertainty take their width from the same curve. With
B16's wrong pick in, the band is wider along the whole section, not only at B16.
Check the picks first, then trust the bands.

Limits
~~~~~~

* Geological models only; litho and geotech models are not checked yet.
* A formation needs at least 6 picks.
* Absences and tests that stop above a contact are not used yet.
* A flag cannot be dismissed yet; it disappears when the pick changes.
* A flag is evidence, not a verdict: on the worked example, test 2025-01415 S4 on
  the 13 m high ground is flagged (z ≈ 3.3). Whether that is a wrong pick or real
  structure is the engineer's call.

References: Rasmussen, C. E. & Williams, C. K. I. (2006), *Gaussian Processes for
Machine Learning*, MIT Press, §2 and §4.2; Chilès, J.-P. & Delfiner, P. (2012),
*Geostatistics: Modeling Spatial Uncertainty*, 2nd ed., Wiley, ch. 3.
```

If `docs/manual/chapters/04-references.rst` lists references in a fixed format, add the two references there in that format as well.

- [ ] **Step 4: api.md.** Next to the `validate/crossings` line in `docs/api.md`, add:
`GET    /models/{model_id}/contact-consistency — Always-on pick consistency check: per formation, leave-one-out flags (|z| > 3), fit and coverage; status computing|ready.`

- [ ] **Step 5: Build the manual** — `.\scripts\build-manual.ps1` must pass with `-W` (no warnings). Open the page and check the four figures render.
- [ ] **Step 6: Commit** — one per file (pyproject, uv.lock, script, each PNG, the rst, api.md).

---

### Task 18: Final gates (session main)

- [ ] `uv run pytest tests/unit -q` — all green; read the count.
- [ ] `uv run mypy --platform linux src` — clean (CI runs mypy on Linux).
- [ ] `uv run ruff check src tests` and `uv run ruff format --check src tests` — clean.
- [ ] `cd desktop && npx vitest run` — 0 failed; `npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` — clean.
- [ ] `.\scripts\run-integration-tests.ps1` — green; read the skipped count.
- [ ] Dogfeed check by the owner on the worked example: the banner shows B16 and S16 (until the B16 pick is corrected), S4, and "Show" opens a section through B16 and S16.

## Self-review notes

- Spec coverage: §2 scope (Tasks 7, 10 non-geological skip), §4 math (Tasks 2–7), §4.5 easy terms (Task 17), §5 architecture (Tasks 8–16), §6 errors (Tasks 5, 7, 8), §7 tests (Tasks 1–11, 14–16), §8 budget (Task 12), §9 docs (Task 17), §10 open item (no task, by design).
- Names used across tasks: `check_formation_picks`, `FormationPickCheck`, `PickFlag.z_score`, `ContactConsistencyCache.lookup_or_schedule`, `getContactConsistency`, `useContactConsistency`, `PickCheckBanner`, `openSectionForContacts` — consistent.
