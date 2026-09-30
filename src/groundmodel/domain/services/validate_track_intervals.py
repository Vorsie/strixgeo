"""Validate the intervals of a hand-edited borehole track (owner 2026-09-29).

The rules, as the session main set them for the track editor:

* every interval has its top above its base (a zero-thickness row is refused);
* depths live on the 1 mm grain, like litho layers
  (``LITHO_LAYER_DEPTH_DECIMALS``) - the grain is applied BEFORE the other
  checks so the stored shape is the judged shape;
* no two intervals of one track overlap - BLOCK;
* gaps between intervals are allowed - WARN;
* an interval deeper than the borehole's total depth - WARN, never block (the
  owner's boreholes sometimes carry descriptions deeper than ``diepte_tot``);
* each row carries the content its kind needs: a field-log value, a main soil
  code on a coded-lithology row, text on a description / stratigraphy row;
* a coded row carries at most ``MAX_ADMIXTURES_PER_INTERVAL`` (3) admixtures
  (owner 2026-09-30) - BLOCK.

Pure function: no I/O, no logging. The API turns ``errors`` into a 422 whose
``loc`` fields are the dotted key paths of the request body.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from groundmodel.domain.services.borehole_track_constants import (
    CODED_TRACK_KINDS,
    FIELD_LOG_TRACK_KINDS,
    MAX_ADMIXTURES_PER_INTERVAL,
    OBSERVATION_TRACK_KINDS,
)
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_issue import TrackIssue
from groundmodel.domain.value_objects.track_validation_result import TrackValidationResult
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS


def validate_track_intervals(
    kind: str,
    intervals: Sequence[TrackInterval],
    *,
    total_depth_m: float | None,
) -> TrackValidationResult:
    """Judge one track's intervals against the track-editor rules.

    Parameters
    ----------
    kind : str
        Track kind: an ``ObservationType`` value or a ``FieldLogKind`` value.
    intervals : Sequence[TrackInterval]
        The intervals as the engineer typed them, in any order.
    total_depth_m : float | None
        The borehole's drilled depth (``diepte_tot``); ``None`` skips the
        depth warning.

    Returns
    -------
    TrackValidationResult
        The intervals snapped to the grain, cleaned (text stripped, empty codes
        dropped) and sorted by top; blocking ``errors`` and non-blocking
        ``warnings``, each carrying the dotted key path of the offending field.
    """
    if kind not in OBSERVATION_TRACK_KINDS and kind not in FIELD_LOG_TRACK_KINDS:
        issue = TrackIssue("kind", "unknown_kind", f"Unknown track kind {kind!r}")
        return TrackValidationResult(intervals=(), errors=(issue,), warnings=())
    if not intervals:
        issue = TrackIssue("intervals", "no_intervals", "A track needs at least one interval")
        return TrackValidationResult(intervals=(), errors=(issue,), warnings=())

    errors: list[TrackIssue] = []
    cleaned: list[tuple[int, TrackInterval]] = []
    well_formed: list[tuple[int, TrackInterval]] = []
    for index, raw in enumerate(intervals):
        interval = _clean(raw)
        cleaned.append((index, interval))
        shape = _shape_issue(index, interval)
        if shape is not None:
            errors.append(shape)
        content = _content_issue(kind, index, interval)
        if content is not None:
            errors.append(content)
        if shape is None:
            well_formed.append((index, interval))

    ordered = sorted(well_formed, key=lambda pair: (pair[1].top_m, pair[1].base_m))
    neighbour_errors, warnings = _neighbour_issues(ordered)
    errors.extend(neighbour_errors)
    depth_warning = _depth_warning(ordered, total_depth_m)
    if depth_warning is not None:
        warnings.append(depth_warning)

    sorted_all = tuple(
        interval
        for _, interval in sorted(cleaned, key=lambda pair: (pair[1].top_m, pair[1].base_m))
    )
    return TrackValidationResult(
        intervals=sorted_all, errors=tuple(errors), warnings=tuple(warnings)
    )


def _clean(interval: TrackInterval) -> TrackInterval:
    """Snap the depths to the 1 mm grain and strip the text fields."""
    return replace(
        interval,
        top_m=round(interval.top_m, LITHO_LAYER_DEPTH_DECIMALS),
        base_m=round(interval.base_m, LITHO_LAYER_DEPTH_DECIMALS),
        value=_strip_or_none(interval.value),
        description=_strip_or_none(interval.description),
        color=_strip_or_none(interval.color),
        main_soil_codes=tuple(c.strip() for c in interval.main_soil_codes if c.strip()),
    )


def _strip_or_none(text: str | None) -> str | None:
    """Return the stripped text, or None when nothing is left."""
    if text is None:
        return None
    stripped = text.strip()
    return stripped or None


def _shape_issue(index: int, interval: TrackInterval) -> TrackIssue | None:
    """Return the depth-shape finding for one row (negative top, base not below top)."""
    if interval.top_m < 0:
        return TrackIssue(
            f"intervals.{index}.top_m",
            "negative_depth",
            f"Interval {index}: top {interval.top_m} m is above the collar",
        )
    if interval.base_m <= interval.top_m:
        return TrackIssue(
            f"intervals.{index}.base_m",
            "base_not_below_top",
            f"Interval {index}: base {interval.base_m} m is not below "
            f"top {interval.top_m} m (1 mm grain)",
        )
    return None


def _content_issue(kind: str, index: int, interval: TrackInterval) -> TrackIssue | None:
    """Return the missing-content finding for one row of ``kind``, or None."""
    if kind in FIELD_LOG_TRACK_KINDS:
        if interval.value is None:
            return TrackIssue(
                f"intervals.{index}.value", "missing_value", f"Interval {index} has no value"
            )
        return None
    if kind in CODED_TRACK_KINDS:
        if not interval.main_soil_codes:
            return TrackIssue(
                f"intervals.{index}.main_soil_codes",
                "missing_main_soil_code",
                f"Interval {index} has no main soil code",
            )
        if len(interval.admixtures) > MAX_ADMIXTURES_PER_INTERVAL:
            return TrackIssue(
                f"intervals.{index}.admixtures",
                "too_many_admixtures",
                f"Interval {index} has {len(interval.admixtures)} admixtures; "
                f"{MAX_ADMIXTURES_PER_INTERVAL} at most",
            )
        return None
    if interval.description is None:
        return TrackIssue(
            f"intervals.{index}.description",
            "missing_description",
            f"Interval {index} has no description",
        )
    return None


def _neighbour_issues(
    ordered: list[tuple[int, TrackInterval]],
) -> tuple[list[TrackIssue], list[TrackIssue]]:
    """Return (overlap errors, gap warnings) between depth-sorted neighbours."""
    errors: list[TrackIssue] = []
    warnings: list[TrackIssue] = []
    for (_, above), (below_index, below) in zip(ordered, ordered[1:], strict=False):
        if below.top_m < above.base_m:
            errors.append(
                TrackIssue(
                    f"intervals.{below_index}.top_m",
                    "intervals_overlap",
                    f"Interval {below_index} ({below.top_m}-{below.base_m} m) overlaps "
                    f"the interval above it ({above.top_m}-{above.base_m} m)",
                )
            )
        elif below.top_m > above.base_m:
            warnings.append(
                TrackIssue(
                    f"intervals.{below_index}.top_m",
                    "gap_between_intervals",
                    f"Gap {above.base_m}-{below.top_m} m above interval {below_index}",
                )
            )
    return errors, warnings


def _depth_warning(
    ordered: list[tuple[int, TrackInterval]], total_depth_m: float | None
) -> TrackIssue | None:
    """Return the deeper-than-drilled warning for the deepest row, or None."""
    if total_depth_m is None or not ordered:
        return None
    deepest_index, deepest = max(ordered, key=lambda pair: pair[1].base_m)
    if deepest.base_m <= round(total_depth_m, LITHO_LAYER_DEPTH_DECIMALS):
        return None
    return TrackIssue(
        f"intervals.{deepest_index}.base_m",
        "below_total_depth",
        f"Interval {deepest_index} reaches {deepest.base_m} m, deeper than "
        f"the borehole's total depth {total_depth_m} m",
    )
