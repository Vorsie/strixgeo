"""Tests for ``groundmodel.shared.timing``.

Three behavioural invariants:

1. A clean ``phase_timer`` block logs exactly one INFO line containing the
   label and an elapsed ``[…s]`` token, with no "FAILED" marker.
2. An exception raised inside the block PROPAGATES and exactly one WARNING line
   carries a "FAILED" marker together with the label and the elapsed token.
3. ``ms_since`` returns a non-negative integer.
"""

from __future__ import annotations

import time

import pytest

from groundmodel.shared.timing import ms_since, phase_timer


class _CapturingLogger:
    """Minimal fake logger that records (level, message) pairs.

    Satisfies the ``_InfoLogger`` protocol used by ``phase_timer``.
    """

    def __init__(self) -> None:
        self.lines: list[tuple[str, str]] = []

    def info(self, msg: str) -> None:
        """Capture an INFO message."""
        self.lines.append(("info", msg))

    def warning(self, msg: str) -> None:
        """Capture a WARNING message."""
        self.lines.append(("warning", msg))


class TestPhaseTimerCleanExit:
    """Clean block exit logs one INFO line with label + elapsed, no FAILED marker."""

    def test_logs_one_info_line_with_label_and_elapsed(self) -> None:
        """A successful block emits exactly one INFO with the label and ``[…s]``."""
        logger = _CapturingLogger()

        with phase_timer(logger, "my-phase"):
            pass

        assert len(logger.lines) == 1, f"expected 1 log line, got: {logger.lines}"
        level, msg = logger.lines[0]
        assert level == "info", f"clean exit must log at INFO level, got {level!r}"
        assert "my-phase" in msg, f"label missing from log line: {msg!r}"
        assert "s]" in msg, f"elapsed token '[…s]' missing from log line: {msg!r}"
        assert "FAILED" not in msg, f"FAILED must not appear on clean exit: {msg!r}"


class TestPhaseTimerExceptionExit:
    """Exception propagates AND a WARNING line with FAILED + label + elapsed is logged."""

    def test_exception_propagates_and_warning_carries_failed_marker(self) -> None:
        """The exception re-raises and the warning line includes the FAILED token."""
        logger = _CapturingLogger()

        with pytest.raises(ValueError, match="boom"):
            with phase_timer(logger, "failing-phase"):
                raise ValueError("boom")

        # Exception propagated — reaching here confirms it.
        warning_lines = [(lvl, msg) for lvl, msg in logger.lines if lvl == "warning"]
        assert len(warning_lines) == 1, (
            f"expected exactly one WARNING on exception, got: {logger.lines}"
        )
        _lvl, msg = warning_lines[0]
        assert "FAILED" in msg, f"FAILED marker missing from warning line: {msg!r}"
        assert "failing-phase" in msg, f"label missing from warning line: {msg!r}"
        assert "s]" in msg, f"elapsed token '[…s]' missing from warning line: {msg!r}"

    def test_no_info_line_on_exception(self) -> None:
        """No INFO line is emitted when the block raises — only the WARNING."""
        logger = _CapturingLogger()

        with pytest.raises(RuntimeError):
            with phase_timer(logger, "err-phase"):
                raise RuntimeError("oops")

        info_lines = [msg for lvl, msg in logger.lines if lvl == "info"]
        assert not info_lines, f"INFO must not be logged on exception, got: {info_lines}"


class TestMsSince:
    """``ms_since`` returns a non-negative integer."""

    def test_returns_non_negative_int(self) -> None:
        """Elapsed milliseconds since a recent ``perf_counter`` snapshot is ≥ 0."""
        start = time.perf_counter()
        result = ms_since(start)
        assert isinstance(result, int), f"ms_since must return int, got {type(result)}"
        assert result >= 0, f"ms_since must be non-negative, got {result}"
