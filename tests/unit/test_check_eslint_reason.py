"""Unit tests for scripts/check_eslint_reason.py (debt #42).

Pins the four cases that matter for the rule:

1. Disable site with a ``// reason: ...`` comment immediately above —
   passes.
2. Disable site with an explanatory comment block that DOESN'T
   contain ``reason:`` — fails (the convention requires the literal
   token, so a future grep can find every reason).
3. Disable site with the reason separated by a blank line — still
   passes (the script tolerates whitespace between the reason
   block and the directive).
4. Disable site at the top of a file with no comment above — fails.

Also covers the file-walk: test files are excluded (tests are
allowed to suppress freely), node_modules / dist are skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Path-hack: the script lives under ``scripts/`` which isn't a Python
# package. Add it to sys.path so the test can import the module
# without restructuring the repo.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import check_eslint_reason as cer  # noqa: E402


def _write(tmp_path: Path, name: str, content: str) -> Path:
    """Write a .tsx file with the given content under ``tmp_path``."""
    target = tmp_path / name
    target.write_text(content, encoding="utf-8")
    return target


def test_passes_when_reason_comment_directly_above(tmp_path: Path) -> None:
    f = _write(
        tmp_path,
        "ok.tsx",
        """\
function Comp() {
  useEffect(() => {
    // reason: stale-read of viewport is intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
""",
    )
    assert cer.find_violations([f]) == []


def test_fails_when_explanatory_comment_lacks_reason_token(tmp_path: Path) -> None:
    """The convention requires the literal ``reason:`` token, not
    just any explanatory text. Without the token, future greps for
    documented suppressions miss the site."""
    f = _write(
        tmp_path,
        "bad.tsx",
        """\
function Comp() {
  useEffect(() => {
    // The deps are intentionally omitted because of a closure thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
""",
    )
    violations = cer.find_violations([f])
    assert len(violations) == 1
    assert violations[0][1] == 4  # 1-indexed line number of the directive


def test_passes_when_reason_separated_by_blank_line(tmp_path: Path) -> None:
    """A blank line between the reason block and the directive is
    fine — the script walks past whitespace."""
    f = _write(
        tmp_path,
        "blank.tsx",
        """\
function Comp() {
  useEffect(() => {
    // reason: keep the closure stable across renders

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
""",
    )
    assert cer.find_violations([f]) == []


def test_fails_when_no_comment_above(tmp_path: Path) -> None:
    """A directive with no comment block above is the worst case —
    no documentation at all."""
    f = _write(
        tmp_path,
        "naked.tsx",
        """\
function Comp() {
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
""",
    )
    violations = cer.find_violations([f])
    assert len(violations) == 1


def test_fails_when_non_comment_line_separates_reason(tmp_path: Path) -> None:
    """A non-comment, non-blank line between the reason and the
    directive breaks the association — the reason must be in the
    immediately-adjacent comment block."""
    f = _write(
        tmp_path,
        "broken.tsx",
        """\
function Comp() {
  useEffect(() => {
    // reason: this reason is now disconnected
    const x = 42  // non-comment line breaks the chain
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
""",
    )
    assert len(cer.find_violations([f])) == 1


def test_other_disable_directives_are_ignored(tmp_path: Path) -> None:
    """Only ``react-hooks/exhaustive-deps`` is governed by this rule.
    Other eslint-disable variants (typescript-eslint, no-unused-vars)
    are not checked here."""
    f = _write(
        tmp_path,
        "other.tsx",
        """\
function Comp() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x: any = 42
  // eslint-disable-next-line no-unused-vars
  const y = 1
}
""",
    )
    assert cer.find_violations([f]) == []


def test_expand_paths_skips_node_modules_and_tests(tmp_path: Path) -> None:
    """The default file walk excludes node_modules, dist, out, and
    .test./.spec. files."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "node_modules").mkdir()
    (tmp_path / "src" / "node_modules" / "a.ts").write_text("x")
    (tmp_path / "src" / "good.tsx").write_text("x")
    (tmp_path / "src" / "good.test.tsx").write_text("x")
    (tmp_path / "src" / "good.spec.ts").write_text("x")
    (tmp_path / "src" / "dist").mkdir()
    (tmp_path / "src" / "dist" / "compiled.ts").write_text("x")

    paths = cer.expand_paths([tmp_path / "src"])
    names = sorted(p.name for p in paths)
    assert names == ["good.tsx"]


def test_main_returns_zero_on_clean_codebase(tmp_path: Path) -> None:
    f = _write(
        tmp_path,
        "clean.tsx",
        """\
function Comp() {
  return null
}
""",
    )
    assert cer.main([str(f)]) == 0


def test_main_returns_one_on_violation(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    f = _write(
        tmp_path,
        "dirty.tsx",
        """\
function Comp() {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {}, [])
}
""",
    )
    rc = cer.main([str(f)])
    captured = capsys.readouterr()
    assert rc == 1
    assert "dirty.tsx" in captured.out
    assert "Missing `// reason:`" in captured.out
