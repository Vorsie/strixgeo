"""The section-wide qc full scale — the renderer's rule, ported for the exporters.

``cptChannels.pickQcFullScaleMpa`` picks the smallest scale step such that no
CPT in the section has ``QC_CONSECUTIVE_THRESHOLD`` consecutive samples above
the MIDPOINT to the next step (a 20-sample run at 41-45 MPa fits the 40 MPa
range; dogfeed 2026-05-31). One rule, two homes, kept in step by the tests.
"""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.exporters.cpt_trace_scale_constants import (
    QC_CONSECUTIVE_THRESHOLD,
    QC_FULL_SCALE_STEP_BEYOND_MPA,
    QC_FULL_SCALE_STEPS_MPA,
)


def longest_consecutive_above(values: Sequence[float | None], threshold: float) -> int:
    """Length of the longest run of consecutive samples strictly above ``threshold``.

    Parameters
    ----------
    values : Sequence[float | None]
        One channel; ``None`` (a gap) breaks a run.
    threshold : float
        The value a sample must exceed to count.

    Returns
    -------
    int
        The longest run length, 0 when nothing exceeds the threshold.
    """
    longest = 0
    run = 0
    for value in values:
        if value is not None and value > threshold:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return longest


def qc_full_scale_mpa(
    traces: Sequence[Sequence[float | None]],
    consecutive_threshold: int = QC_CONSECUTIVE_THRESHOLD,
) -> float:
    """Pick the section-wide qc full scale for a set of CPT qc channels.

    Parameters
    ----------
    traces : Sequence[Sequence[float | None]]
        One qc channel per CPT on the section.
    consecutive_threshold : int
        How many consecutive samples above a step's trigger bump the scale.

    Returns
    -------
    float
        The full scale in MPa: 40 for an empty section or one that fits.
    """

    def triggers_at(trigger: float) -> bool:
        return any(
            longest_consecutive_above(trace, trigger) >= consecutive_threshold for trace in traces
        )

    steps = QC_FULL_SCALE_STEPS_MPA
    for index, step in enumerate(steps):
        nxt = steps[index + 1] if index + 1 < len(steps) else step + QC_FULL_SCALE_STEP_BEYOND_MPA
        if not triggers_at((step + nxt) / 2.0):
            return step
    step = steps[-1] + QC_FULL_SCALE_STEP_BEYOND_MPA
    while triggers_at(step + QC_FULL_SCALE_STEP_BEYOND_MPA / 2.0):
        step += QC_FULL_SCALE_STEP_BEYOND_MPA
    return step
