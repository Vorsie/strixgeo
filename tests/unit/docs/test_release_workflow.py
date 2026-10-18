"""The hosted installer workflow (debt #288) keeps the shape the design fixed.

A tag push builds the Windows installer on a pinned Windows runner and
attaches it to a draft release with the repository token; a manual dispatch
only builds. Every action is SHA-pinned (#219), the job has a timeout, and the
local-only escape hatch STRIX_ALLOW_DIRTY_DIST is never set in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
POSTGRES_STAGING = ROOT / "scripts" / "build-embedded-postgres.ps1"
SHA_PINNED = re.compile(r"^[^@\s]+@[0-9a-f]{40}\b")


def _workflow() -> dict:
    """Parse the workflow file."""
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_release_workflow_triggers_on_version_tags_and_dispatch() -> None:
    """A v* tag push and a manual dispatch are the only triggers."""
    on = _workflow()[True] if True in _workflow() else _workflow()["on"]
    assert set(on) == {"push", "workflow_dispatch"}
    assert on["push"] == {"tags": ["v*"]}


def test_release_workflow_runs_on_a_pinned_windows_runner_with_a_timeout() -> None:
    """One job on windows-2022 (never windows-latest) with a timeout."""
    jobs = _workflow()["jobs"]
    assert list(jobs) == ["installer"]
    job = jobs["installer"]
    assert job["runs-on"] == "windows-2022"
    assert isinstance(job["timeout-minutes"], int)


def test_release_workflow_publishes_with_the_repository_token_only() -> None:
    """contents: write and GH_TOKEN from secrets.GITHUB_TOKEN; no personal token."""
    wf = _workflow()
    assert wf["permissions"] == {"contents": "write"}
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}" in text
    assert "STRIX_ALLOW_DIRTY_DIST" not in text


def test_release_workflow_pins_every_action_by_sha() -> None:
    """Every uses: carries a 40-hex ref (#219)."""
    steps = _workflow()["jobs"]["installer"]["steps"]
    uses = [step["uses"] for step in steps if "uses" in step]
    assert uses, "the workflow uses no actions at all?"
    unpinned = [u for u in uses if not SHA_PINNED.match(u)]
    assert unpinned == [], unpinned


def test_release_workflow_runs_the_guards_before_staging() -> None:
    """Tag guard and release notes run before the dependency installs."""
    steps = _workflow()["jobs"]["installer"]["steps"]
    names = [step.get("name", "") for step in steps]
    tag_guard = next(
        i for i, n in enumerate(names) if "tag" in n.lower() and "version" in n.lower()
    )
    notes = next(i for i, n in enumerate(names) if "release notes" in n.lower())
    first_install = next(
        i for i, n in enumerate(names) if "install" in n.lower() or "set up" in n.lower()
    )
    assert tag_guard < first_install
    assert notes < first_install


def _step_running(command: str) -> dict:
    """Return the one installer step whose run: line runs ``command``."""
    steps = _workflow()["jobs"]["installer"]["steps"]
    matches = [step for step in steps if command in str(step.get("run", ""))]
    assert len(matches) == 1, (command, matches)
    return matches[0]


def test_release_workflow_publishes_only_on_a_tag_push() -> None:
    """npm run release runs on a tag push only; a dispatch runs npm run dist and never publishes."""
    assert _step_running("npm run release")["if"] == "github.event_name == 'push'"
    assert _step_running("npm run dist")["if"] == "github.event_name == 'workflow_dispatch'"


def test_release_workflow_never_cancels_a_running_build() -> None:
    """A second tag never cancels a build in progress."""
    assert _workflow()["concurrency"]["cancel-in-progress"] is False


def test_release_workflow_caches_the_postgres_download_directory() -> None:
    """The cache path is the $DownloadDir default of the PostgreSQL staging script."""
    script = POSTGRES_STAGING.read_text(encoding="utf-8")
    match = re.search(r"\$DownloadDir = Join-Path \$PSScriptRoot '([^']+)'", script)
    assert match, "the $DownloadDir default line of build-embedded-postgres.ps1 moved"
    # The script lives in scripts/, so its relative default resolves against it.
    expected = (POSTGRES_STAGING.parent / match.group(1).replace("\\", "/")).resolve()
    expected_rel = expected.relative_to(ROOT).as_posix()
    steps = _workflow()["jobs"]["installer"]["steps"]
    cache = next(step for step in steps if step.get("uses", "").startswith("actions/cache@"))
    assert cache["with"]["path"] == expected_rel


def test_release_workflow_reattaches_the_blockmap_after_the_publish() -> None:
    """A step after the publish uploads the blockmap with --clobber.

    The v0.2.1 tag build (run 39122801511) lost the blockmap: electron-builder
    starts the installer and blockmap uploads together, both saw no release
    and both tried to create it, and the loser's upload vanished (the local
    chain never raced). The step is idempotent and runs only on a tag push.
    """
    steps = _workflow()["jobs"]["installer"]["steps"]
    names = [step.get("name", "") for step in steps]
    publish = next(i for i, s in enumerate(steps) if "npm run release" in str(s.get("run", "")))
    reattach = next(i for i, s in enumerate(steps) if ".blockmap" in str(s.get("run", "")))
    assert reattach > publish
    assert "--clobber" in steps[reattach]["run"]
    assert steps[reattach].get("if") == "github.event_name == 'push'", names[reattach]
