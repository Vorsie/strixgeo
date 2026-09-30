"""Raw-reading cross-checks shared by the two oedometer parsers.

Both the oedometer control listing and the newer oedometer module's raw dump
produce an :class:`OedometerListingResult`; the per-reading checks do not care
which export the readings came from, so they live here once. Pure functions:
the logger is a parameter (helper hygiene), the result is mutated in place
(findings appended, ``rezero_indices`` filled).
"""

from __future__ import annotations

from collections import Counter

from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_constants import (
    OED_REZERO_MAX_SETTLEMENT_CHANGE_MM,
    OED_REZERO_MIN_JUMP_MM,
    OED_STEP_BACK_INFO_MAX_MM,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_stage import OedometerStage
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def check_oedometer_readings(
    result: OedometerListingResult, *, dial_to_mm: float, logger: GroundModelLogger
) -> None:
    """Flag empty stages, time running backwards, re-zeros and end step-backs.

    Parameters
    ----------
    result : OedometerListingResult
        The parsed test; findings are appended to ``result.issues`` and each
        stage's ``rezero_indices`` is filled.
    dial_to_mm : float
        Magnitude of one dial unit in mm (the listing's gauge coefficient;
        1.0 for an export that already writes the dial in mm).
    logger : GroundModelLogger
        The calling parser's logger (re-zeros are logged at WARNING).
    """
    for stage in result.stages:
        if not stage.elapsed_min:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "EMPTY_STAGE",
                    f"stage {stage.stage_number} lists no readings",
                )
            )
            continue
        _check_elapsed(stage, result)
        _check_duplicate_timestamps(stage, result, dial_to_mm, logger)
        _check_end_step_back(stage, result)


def check_stage_counts(result: OedometerListingResult) -> None:
    """Report a stage with fewer readings than the file's usual count.

    The usual count is the most common readings-per-stage in the file (the
    control listing keeps ~50 per stage). A shorter stage is not wrong — the
    lab may have moved on early — but the engineer should know it is thinner.

    Parameters
    ----------
    result : OedometerListingResult
        The parsed test; an INFO ``STAGE_SHORT`` is appended per short stage.
    """
    counts = [len(s.elapsed_min) for s in result.stages if s.elapsed_min]
    if len(counts) < 2:
        return
    usual, frequency = Counter(counts).most_common(1)[0]
    if frequency < 2:
        return  # no count repeats: there is no "usual" to compare against
    for stage in result.stages:
        n = len(stage.elapsed_min)
        if 0 < n < usual:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "STAGE_SHORT",
                    f"stage {stage.stage_number}: {n} readings where this file usually "
                    f"lists {usual} per stage",
                )
            )


def _check_elapsed(stage: OedometerStage, result: OedometerListingResult) -> None:
    """Flag an elapsed time that steps back inside the stage."""
    for i in range(1, len(stage.elapsed_min)):
        t0, t1 = stage.elapsed_min[i - 1], stage.elapsed_min[i]
        if t0 is not None and t1 is not None and t1 < t0:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "ELAPSED_TIME_NOT_MONOTONIC",
                    f"stage {stage.stage_number}: elapsed time steps back "
                    f"{t0} → {t1} min at reading {i + 1}",
                    rows=[i + 1],
                )
            )


def _check_duplicate_timestamps(
    stage: OedometerStage,
    result: OedometerListingResult,
    dial_to_mm: float,
    logger: GroundModelLogger,
) -> None:
    """Classify each repeated timestamp as a gauge re-zero or a plain duplicate.

    A re-zero is a repeated timestamp where the dial jumps while the
    settlement does not move: the lab re-set the gauge and the settlement
    column bridges it. The second reading of the pair is kept (the raw record
    stays whole) and its index is marked in ``stage.rezero_indices``.
    """
    for i in range(1, len(stage.timestamps)):
        if stage.timestamps[i] != stage.timestamps[i - 1]:
            continue
        d0, d1 = stage.dial_readings[i - 1], stage.dial_readings[i]
        s0, s1 = stage.settlement_mm[i - 1], stage.settlement_mm[i]
        jump = abs(d1 - d0) * dial_to_mm if d0 is not None and d1 is not None else 0.0
        moved = abs(s1 - s0) if s0 is not None and s1 is not None else 0.0
        stamp = stage.timestamps[i].strftime("%d/%m/%Y %H:%M:%S")
        if jump > OED_REZERO_MIN_JUMP_MM and moved < OED_REZERO_MAX_SETTLEMENT_CHANGE_MM:
            stage.rezero_indices.append(i)
            logger.warning(
                "oedometer %s stage %d: dial re-zero %.3f mm at %s (reading %d marked)",
                result.source_name,
                stage.stage_number,
                jump,
                stamp,
                i + 1,
            )
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "DIAL_REZERO",
                    f"stage {stage.stage_number}: dial reading jumps {jump:.3f} mm at the "
                    f"repeated timestamp {stamp} while the settlement does not change "
                    "(gauge re-zeroed); the settlement column is the continuous series. "
                    f"Reading {i + 1} repeats that moment: it is kept as read and marked "
                    "as a re-zero duplicate, so plots and counts skip it",
                    rows=[i + 1],
                )
            )
        else:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "DUPLICATE_TIMESTAMP",
                    f"stage {stage.stage_number}: two readings share timestamp {stamp}",
                    rows=[i + 1],
                )
            )


def _check_end_step_back(stage: OedometerStage, result: OedometerListingResult) -> None:
    """Report a stage whose last reading sits back from the stage's own peak.

    The stage's direction is read from its net movement (last minus first
    settlement), so the rule works for loading, unloading and an export with
    no direction token. One or two print steps back is rounding (INFO); more
    is a real reversal (WARNING).
    """
    values = [v for v in stage.settlement_mm if v is not None]
    if len(values) < 2:
        return
    net = values[-1] - values[0]
    if net == 0:
        return
    sign = 1.0 if net > 0 else -1.0
    peak = max(v * sign for v in values) * sign
    back = (peak - values[-1]) * sign
    if back <= 1e-9:
        return
    level = ValidationLevel.INFO if back <= OED_STEP_BACK_INFO_MAX_MM else ValidationLevel.WARNING
    result.issues.append(
        ValidationIssue(
            level,
            "SETTLEMENT_STEPS_BACK",
            f"stage {stage.stage_number}: the last reading ({values[-1]:.3f} mm) is "
            f"{back:.3f} mm back from the stage's peak settlement ({peak:.3f} mm)"
            + (" — print rounding" if level == ValidationLevel.INFO else ""),
            rows=[len(stage.settlement_mm)],
        )
    )
