"""The CI workflow carries the five required jobs of the open-source design."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]


def _workflow() -> dict:
    """Load ``.github/workflows/ci.yml`` as a mapping."""
    return yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))


def test_ci_has_the_five_required_jobs() -> None:
    """lint-types, python-unit, desktop, integration and dco exist as jobs with the agreed names."""
    jobs = _workflow()["jobs"]
    assert set(jobs) >= {"lint-types", "python-unit", "desktop", "integration", "dco"}
    assert jobs["lint-types"]["name"] == "Ruff + mypy"
    assert jobs["python-unit"]["name"] == "Python unit tests"
    assert jobs["desktop"]["name"] == "Desktop eslint-reason + tsc + tests"
    assert jobs["integration"]["name"] == "Integration tests (PostGIS service)"
    assert jobs["dco"]["name"] == "DCO sign-off"


def test_integration_job_uses_a_postgis_service() -> None:
    """The integration job runs against a PostGIS service container, not the dev DB."""
    job = _workflow()["jobs"]["integration"]
    assert "postgis/postgis:16-3.4" in job["services"]["db"]["image"]
    assert job["env"]["DATABASE_URL"].endswith("/groundmodel_integration")


def test_mypy_blocks_the_lint_job() -> None:
    """mypy is clean, so a new type error fails the lint job: the step has no continue-on-error."""
    steps = _workflow()["jobs"]["lint-types"]["steps"]
    mypy = [s for s in steps if "mypy" in str(s.get("run", ""))]
    assert len(mypy) == 1
    assert mypy[0].get("name") == "mypy"
    assert "continue-on-error" not in mypy[0]


def test_dco_check_skips_dependabot_pull_requests() -> None:
    """Dependabot cannot sign the DCO, so the dco job does not run on a Dependabot pull request."""
    condition = _workflow()["jobs"]["dco"]["if"]
    assert "github.event_name == 'pull_request'" in condition
    # The inequality pins the direction: the job skips Dependabot, it does not run only for it.
    assert "!= 'dependabot[bot]'" in condition


def test_integration_job_has_room_for_the_full_suite() -> None:
    """The integration job may run at least 60 minutes; the local gate takes 40 to 60 under load."""
    assert _workflow()["jobs"]["integration"]["timeout-minutes"] >= 60


def _version_tuple(text: str) -> tuple[int, ...]:
    """Parse ``"0.13.1"`` or ``"0.13"`` into a tuple of ints."""
    return tuple(int(part) for part in text.split("."))


def test_every_setup_uv_step_pins_one_uv_that_reads_the_local_lockfile() -> None:
    """Every setup-uv step pins the same uv version, no older than the local uv's major.minor.

    The lockfile is written by the local uv; an older uv in CI cannot read a newer lock revision.
    """
    pins = [
        step["with"]["version"]
        for job in _workflow()["jobs"].values()
        for step in job.get("steps", [])
        if "astral-sh/setup-uv" in str(step.get("uses", ""))
    ]
    assert pins, "no setup-uv step found"
    assert len(set(pins)) == 1, f"setup-uv steps pin different uv versions: {pins}"
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv is not on PATH")
    out = subprocess.run([uv, "--version"], capture_output=True, text=True, check=True).stdout
    match = re.search(r"(\d+)\.(\d+)", out)
    assert match is not None, out
    local = (int(match.group(1)), int(match.group(2)))
    assert _version_tuple(str(pins[0]))[:2] >= local, (
        f"CI uv {pins[0]} is older than local uv {out.strip()}"
    )
