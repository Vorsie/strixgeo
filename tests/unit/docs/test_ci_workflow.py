"""The CI workflow carries the five required jobs of the open-source design."""

from __future__ import annotations

from pathlib import Path

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
