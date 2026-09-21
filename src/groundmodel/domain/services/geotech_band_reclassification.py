"""Hand split/merge of NAD packing sub-bands — pure reclassification + hard bounds.

Owner spec 2026-08-01: "build both properly, the user needs to be able to
manually overrule everything, but of course if the qc is lower or higher then it
gets a warning that it will pull down or up the avg qc of the layer it is in."

Four rulings are encoded here, and nothing else:

1. **The class is derived, not carried.** After a split or a merge, each
   resulting interval is reclassified from the CPT qc over that interval.
2. **The statistic is the MODEL'S CHOICE, single-sourced.** The owner said
   "avg qc"; the statistic actually used is the model's
   ``representative_statistic`` (ruling 7 — median by default, chosen as
   "robust to spikes"), read through the one shared
   ``representative_statistic.representative_qc`` the subdivision classifier
   also reads. A warning computed with any OTHER statistic would sometimes
   promise a reclassification the build never performs, and miss one it does —
   so the preview and the commit both take ``statistic`` from the model, and
   the UI copy must say "representative qc", not "average qc".
3. **The litho unit is the hard wall — and the only one.** A packing boundary
   moves freely inside its litho body and clamps at the edge; it can never move
   or cross a lithostratigraphic contact. Violations raise
   :class:`GeotechBandEditError` — the owner overrules the CLASS, not the
   hierarchy. A GEOLOGICAL contact is not a wall (owner, 2026-08-26: *"just
   drop the wall everywhere, user wil have to manually do it"*); the geological
   parent is carried as a derived label and refuses nothing.
4. **Manual override always wins.** Everything else — a band below the minimum
   thickness, a boundary the qc does not support — is a WARNING, never a block.

"Cannot answer" is a first-class outcome: ``classify_nad`` rejects a missing,
NaN, infinite or negative qc by design (owner rule 2026-07-25), so an interval
whose qc coverage is too thin comes back with ``nad_class=None`` and a reason
rather than a plausible-looking class. This module never calls ``classify_nad``
with a value it has not already validated.

Pure by construction — no session, no I/O — so the preview use case and the
commit use cases share one implementation and it is testable without a database.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.geotech_subdivision import (
    QC_REVIEW_MAX_GAP_M,
    QC_REVIEW_MISSING_FRACTION,
    _is_valid_qc,
    _missing_qc_coverage,
)
from groundmodel.domain.services.nad_classifier import classify_nad
from groundmodel.domain.services.representative_statistic import (
    DEFAULT_STATISTIC,
    representative_qc,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS
from groundmodel.shared.constants.litho_constants import BaseLithology

# Two bands are "contiguous" when their shared boundary agrees to within 1 cm —
# the same tolerance the DB contiguity guard uses
# (``trg_litho_column_contiguous``), so this walk never disagrees with the
# invariant the database enforces.
_ADJACENCY_EPS_M = 0.01

# Depth comparisons that must be strict (a split must land strictly inside its
# band, not on its own edge).
_DEPTH_EPS_M = 1e-6

# Warning codes. The UI switches on these; the message carries the prose.
WARNING_QC_PULL_DOWN = "qc_pull_down"
WARNING_QC_PULL_UP = "qc_pull_up"
WARNING_QC_UNAVAILABLE = "qc_unavailable"
WARNING_BELOW_MINIMUM_THICKNESS = "below_minimum_thickness"
WARNING_CLASS_CHANGED = "class_changed"
"""The class moves although the representative qc did not.

A split does not change the qc a band contains; it changes which qc it contains. So the
median can land on the same value while the class still moves, and the engineer has to be
told — the class is the thing that ships.
"""

# Plan kinds.
KIND_SPLIT = "split"
KIND_MERGE = "merge"
KIND_MOVE = "move"


class GeotechBandEditError(ValueError):
    """Raised when a hand edit would breach the three-level hierarchy.

    The owner may overrule the derived CLASS; he may not move or cross a
    lithostratigraphic contact from the geotech axis. Routers map this to a 422.
    """


@dataclass(frozen=True)
class GeotechBand:
    """One materialised packing band on a single investigation column.

    Attributes
    ----------
    band_id : str
        Stable identity of the band (the ``litho_layer`` row id, stringified).
    depth_top_m, depth_base_m : float
        Band bounds in metres, positive down.
    nad_class : int | None
        The NAD packing class the band carries TODAY, or ``None`` for a band
        flagged "needs review" (no class could be derived).
    source_litho_formation_id : str
        The lithostratigraphic formation this band subdivides — the hard wall.
    source_geo_formation_id : str | None
        The geological formation the band sits within (``None`` = the open
        shallow band). A DERIVED LABEL, never a wall (owner, 2026-08-26) — it
        is carried for provenance and for the formation's identity, and no edit
        is refused or clamped by it.
    """

    band_id: str
    depth_top_m: float
    depth_base_m: float
    nad_class: int | None
    source_litho_formation_id: str
    source_geo_formation_id: str | None


@dataclass(frozen=True)
class ProposedInterval:
    """One interval a hand edit would produce, and the band(s) it is carved from.

    Attributes
    ----------
    depth_top_m, depth_base_m : float
        The proposed interval bounds (metres, positive down).
    sources : tuple[GeotechBand, ...]
        The existing band(s) whose material ends up in this interval. A split
        half has exactly one source (the band being split); a merge result has
        one per merged band.
    """

    depth_top_m: float
    depth_base_m: float
    sources: tuple[GeotechBand, ...]


@dataclass(frozen=True)
class SourceContribution:
    """What one existing band contributes to a proposed interval.

    Attributes
    ----------
    band_id : str
        The contributing band.
    previous_nad_class : int | None
        The class that band carries today.
    previous_median_qc_mpa : float | None
        That band's representative (median) qc over its OWN extent — the number
        the warning says is pulled up or down. ``None`` when the band's own qc
        cannot answer.
    overlap_thickness_m : float
        How much of the proposed interval this band supplies (metres).
    """

    band_id: str
    previous_nad_class: int | None
    previous_median_qc_mpa: float | None
    overlap_thickness_m: float


@dataclass(frozen=True)
class IntervalOutcome:
    """The re-derived answer for one proposed interval.

    Attributes
    ----------
    depth_top_m, depth_base_m : float
        Interval bounds (metres, positive down).
    median_qc_mpa : float | None
        Representative qc over the interval — the MEDIAN, matching the statistic
        the build classifies on. ``None`` when the qc cannot answer.
    nad_class : int | None
        The re-derived NAD packing class, or ``None`` when the qc cannot answer
        (the interval is then a "needs review" band, exactly as the build's
        thin-coverage path produces).
    previous_nad_class : int | None
        The class the interval's material carries today. When the interval draws
        from several bands this is the class of the THICKNESS-DOMINANT source —
        the same tie-break the body aggregator already uses for an inconsistent
        group ("thickness-dominant single class").
    class_changed : bool
        ``True`` when ``nad_class`` differs from ``previous_nad_class``.
    unclassifiable_reason : str | None
        Why no class could be derived; ``None`` on the happy path.
    sources : tuple[SourceContribution, ...]
        Per contributing band, what it carried before this edit.
    """

    depth_top_m: float
    depth_base_m: float
    median_qc_mpa: float | None
    nad_class: int | None
    previous_nad_class: int | None
    class_changed: bool
    unclassifiable_reason: str | None
    sources: tuple[SourceContribution, ...]


@dataclass(frozen=True)
class BandEditWarning:
    """One advisory consequence of the edit. Advisory — never blocking.

    Attributes
    ----------
    code : str
        One of the ``WARNING_*`` constants in this module.
    message : str
        Plain-language consequence, ready to show.
    depth_top_m, depth_base_m : float
        The interval the warning is about.
    band_id : str | None
        The existing band the warning is about, when it names one.
    """

    code: str
    message: str
    depth_top_m: float
    depth_base_m: float
    band_id: str | None


@dataclass(frozen=True)
class BandEditPlan:
    """What a proposed split or merge would produce, and what it would cost.

    Attributes
    ----------
    kind : str
        ``"split"`` or ``"merge"``.
    parent_top_m, parent_base_m : float
        The hard walls the edit is confined to — the litho body the edited
        band(s) belong to.
    intervals : tuple[IntervalOutcome, ...]
        The resulting intervals, top to bottom, each with its re-derived class.
    warnings : tuple[BandEditWarning, ...]
        Advisory consequences. A non-empty list never means "refused".
    statistic : str
        The representative-qc statistic every interval in this plan was derived
        with (ruling 7) — the MODEL'S choice, so the consequence sheet can name
        it and can never quote a number the classifier would not produce
        (ruling 6).
    absorbs : str | None
        Which side of the pair a merge swallows — ``"lower"`` for the downward
        landing (the unit above grows), ``"upper"`` for the upward one (the
        reverse), ``None`` for anything that is not a merge. Direction decides
        who swallows whom (owner, §4c), and the WRITER needs the answer: the two
        merges keep different rows alive and classify the survivor under
        different units' soils, so inferring the direction from depths at write
        time would be a second copy of this rule.
    """

    kind: str
    parent_top_m: float
    parent_base_m: float
    intervals: tuple[IntervalOutcome, ...]
    warnings: tuple[BandEditWarning, ...]
    statistic: str = DEFAULT_STATISTIC
    absorbs: str | None = None


# ---------------------------------------------------------------------------
# Hard bounds
# ---------------------------------------------------------------------------


def enclosing_litho_bounds(bands: Sequence[GeotechBand], index: int) -> tuple[float, float]:
    """The hard walls for a hand edit on ``bands[index]``.

    A packing band is materialised inside one litho unit, so the unit is
    recovered as the contiguous run of bands sharing the target's
    ``source_litho_formation_id``. The run ends where that parent changes — at a
    lithostratigraphic contact, which is where a packing boundary must clamp.

    The geological parent is deliberately NOT part of the test (owner,
    2026-08-26: *"just drop the wall everywhere"*). It used to be, which ended
    the editable run mid-unit at a geological line and made the server clamp
    tighter than the section editor's own (``geotechBandEdit.ts`` has always
    clamped to the litho layer alone). The two now agree.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the column, ordered top to bottom.
    index : int
        Position of the band being edited.

    Returns
    -------
    tuple[float, float]
        ``(top_m, base_m)`` of the enclosing litho unit.
    """
    target = bands[index]
    top_i = index
    while top_i > 0:
        above = bands[top_i - 1]
        if above.source_litho_formation_id != target.source_litho_formation_id:
            break
        if abs(above.depth_base_m - bands[top_i].depth_top_m) > _ADJACENCY_EPS_M:
            break  # a real hole in the column ends the run
        top_i -= 1
    base_i = index
    while base_i < len(bands) - 1:
        below = bands[base_i + 1]
        if below.source_litho_formation_id != target.source_litho_formation_id:
            break
        if abs(bands[base_i].depth_base_m - below.depth_top_m) > _ADJACENCY_EPS_M:
            break
        base_i += 1
    return (bands[top_i].depth_top_m, bands[base_i].depth_base_m)


def _index_of(bands: Sequence[GeotechBand], band_id: str) -> int:
    """Position of ``band_id`` in ``bands``; raises when it is not on the column."""
    for i, b in enumerate(bands):
        if b.band_id == band_id:
            return i
    raise GeotechBandEditError(f"Band {band_id} is not on this column.")


def _assert_same_litho_body(
    upper: GeotechBand,
    lower: GeotechBand,
    *,
    verb: str = "Merge",
) -> None:
    """Refuse an edit that would swallow a lithostratigraphic contact.

    A geological contact is NOT a wall (owner, 2026-08-26: *"just drop the wall
    everywhere, user wil have to manually do it"*). The engineer crosses a
    geological line himself and re-divides by hand where he wants the division,
    so this function judges the litho parent and nothing else.

    Parameters
    ----------
    upper, lower : GeotechBand
        The two bands the gesture spans.
    verb : str
        The gesture being refused (``"Merge"`` / ``"Move"``). Named by the
        caller because this wall is shared: telling an engineer who dragged a
        boundary that a MERGE was rejected describes a gesture he did not make,
        and reads as a bug in the app rather than a rule about the ground
        (dogfeed 2026-08-09).

    Raises
    ------
    GeotechBandEditError
        When the two bands sit in different litho units.
    """
    if upper.source_litho_formation_id != lower.source_litho_formation_id:
        raise GeotechBandEditError(
            f"{verb} rejected: the two packing bands sit in different "
            "lithostratigraphic units, and a packing band never crosses a "
            "lithostratigraphic contact. Edit the contact on the litho axis, "
            "then re-run 'Packing pipeline → 1 · Subdivide CPTs' so the packing "
            "bands are rebuilt against it."
        )


# ---------------------------------------------------------------------------
# The pure reclassification core
# ---------------------------------------------------------------------------


def _representative_qc_over(
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    top_m: float,
    base_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> tuple[float | None, str | None]:
    """Representative qc over ``[top_m, base_m)``, or why there is none.

    Half-open sampling matches ``geotech_subdivision._class_over`` (``top <= d <
    base``) so this number is the one the build would classify on. Coverage is judged by
    the SAME thresholds the build uses to flag a unit "needs review", so preview
    and build never disagree about whether an interval can be answered. The
    statistic is the MODEL'S choice (ruling 7), read through the one shared
    :func:`representative_qc` — median by default.

    Parameters
    ----------
    depth_m : Sequence[float]
        Full CPT depth series (metres, positive down).
    qc_mpa : Sequence[float | None]
        Cone resistance per depth (MPa); ``None`` models a void reading.
    top_m, base_m : float
        Interval bounds (metres).
    statistic : str
        One of ``REPRESENTATIVE_STATISTICS`` (ruling 7).

    Returns
    -------
    tuple[float | None, str | None]
        ``(representative_qc_mpa, reason)`` — exactly one is ``None``.
    """
    # The build's window, VERBATIM (``top <= d < base`` — _class_over). This was
    # epsilon-shifted for years under a docstring claiming exact parity; the
    # 1 µm sliver never bit on real depth grids, but the trap armed itself the
    # day anyone widened _DEPTH_EPS_M toward the 1 cm adjacency epsilon four
    # lines above it (audit F17).
    in_range: list[tuple[float, float | None]] = [
        (d, q) for d, q in zip(depth_m, qc_mpa) if top_m <= d < base_m
    ]
    if not in_range:
        # Deliberately NOT the build's borehole fallback (no samples → qc 0.0 →
        # loosest class). That fallback exists to give a borehole SOME band at
        # build time; here the owner asked for a class RE-DERIVED from the qc,
        # and there is no qc to re-derive it from. Say so.
        return None, (
            "No cone-resistance samples between "
            f"{top_m:.2f} m and {base_m:.2f} m — the class cannot be re-derived here."
        )
    missing_fraction, max_gap_m = _missing_qc_coverage(in_range, top_m, base_m)
    if missing_fraction > QC_REVIEW_MISSING_FRACTION or max_gap_m >= QC_REVIEW_MAX_GAP_M:
        return None, (
            f"Cone resistance is missing or invalid over {missing_fraction * 100:.0f}% of "
            f"{top_m:.2f}–{base_m:.2f} m (longest gap {max_gap_m:.2f} m) — "
            "the class cannot be re-derived here; the band is flagged for review."
        )
    valid = [q for _d, q in in_range if _is_valid_qc(q) and q is not None]
    if not valid:
        return None, (
            f"No usable cone resistance between {top_m:.2f} m and {base_m:.2f} m — "
            "the class cannot be re-derived here."
        )
    return float(representative_qc(valid, statistic)), None


def _classify_or_reason(
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    median_qc_mpa: float,
) -> tuple[int | None, str | None]:
    """Classify a validated median qc, turning a rejection into a readable reason.

    ``classify_nad`` REJECTS input it cannot classify rather than mapping it to a
    plausible class (owner rule 2026-07-25) — an unknown/absent soil raises. The
    preview must surface that as a real answer, so the rejection becomes a
    "cannot answer" reason instead of a crash. This mirrors the build, which
    materialises a ``nad_class=None`` skeleton band when the parent unit has no
    usable soil code.

    Parameters
    ----------
    soil : BaseLithology | None
        Main soil type of the parent litho unit; ``None`` when the unit carries
        no soil code.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures.
    median_qc_mpa : float
        Already-validated representative qc (MPa).

    Returns
    -------
    tuple[int | None, str | None]
        ``(nad_class, reason)`` — exactly one is ``None``.
    """
    if soil is None:
        return None, (
            "The parent lithostratigraphic unit carries no soil type, so no NAD "
            "packing class can be derived; the band is flagged for review."
        )
    try:
        return classify_nad(soil, admixtures, median_qc_mpa), None
    except ValueError as exc:
        return None, f"No NAD packing class could be derived: {exc}"


def reclassify_intervals(
    *,
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    intervals: Sequence[ProposedInterval],
    statistic: str = DEFAULT_STATISTIC,
) -> tuple[IntervalOutcome, ...]:
    """Re-derive the NAD class of each proposed interval from the column's qc.

    This is the single implementation behind both the preview and the commit, so
    what the owner is shown before pressing the button is what the button does.

    Parameters
    ----------
    soil : BaseLithology | None
        Main soil type of the parent litho unit (fixes the NAD column).
        ``None`` when the unit carries no soil code — every interval then comes
        back "cannot answer", matching the build's skeleton-band path.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures (clean vs secondary NAD variant).
    depth_m : Sequence[float]
        Full CPT depth series (metres, positive down).
    qc_mpa : Sequence[float | None]
        Cone resistance per depth (MPa); ``None`` models a void reading.
    intervals : Sequence[ProposedInterval]
        The intervals the edit would produce, each with its source band(s).
    statistic : str
        The model's representative-qc statistic (ruling 7); the warning is
        computed with the SAME statistic the classifier reads (ruling 6).

    Returns
    -------
    tuple[IntervalOutcome, ...]
        One outcome per interval, in the order given: its representative qc,
        its re-derived class, the class it carries today, and whether they
        differ. An interval whose qc cannot answer comes back with
        ``nad_class=None`` and a reason — never a guessed class.
    """
    # A band's own representative qc is quoted in the warning for every interval
    # it feeds, so compute it once per band rather than per (band, interval).
    previous_median: dict[str, float | None] = {}
    for interval in intervals:
        for band in interval.sources:
            if band.band_id not in previous_median:
                value, _reason = _representative_qc_over(
                    depth_m, qc_mpa, band.depth_top_m, band.depth_base_m, statistic
                )
                previous_median[band.band_id] = value

    outcomes: list[IntervalOutcome] = []
    for interval in intervals:
        median_qc, reason = _representative_qc_over(
            depth_m, qc_mpa, interval.depth_top_m, interval.depth_base_m, statistic
        )
        nad_class: int | None = None
        if median_qc is not None:
            nad_class, reason = _classify_or_reason(soil, admixtures, median_qc)
        contributions = tuple(
            SourceContribution(
                band_id=band.band_id,
                previous_nad_class=band.nad_class,
                previous_median_qc_mpa=previous_median.get(band.band_id),
                overlap_thickness_m=max(
                    0.0,
                    min(interval.depth_base_m, band.depth_base_m)
                    - max(interval.depth_top_m, band.depth_top_m),
                ),
            )
            for band in interval.sources
        )
        # "What the interval carries today" when several bands feed it: the
        # thickness-dominant source, the tie-break the body aggregator already
        # uses for an inconsistent group.
        dominant = (
            max(contributions, key=lambda c: c.overlap_thickness_m) if contributions else None
        )
        previous_class = dominant.previous_nad_class if dominant is not None else None
        outcomes.append(
            IntervalOutcome(
                depth_top_m=interval.depth_top_m,
                depth_base_m=interval.depth_base_m,
                median_qc_mpa=median_qc,
                nad_class=nad_class,
                previous_nad_class=previous_class,
                class_changed=nad_class != previous_class,
                unclassifiable_reason=reason,
                sources=contributions,
            )
        )
    return tuple(outcomes)


# ---------------------------------------------------------------------------
# Warnings — what the move costs, in the owner's terms
# ---------------------------------------------------------------------------


def _class_phrase(previous: int | None, new: int | None) -> str:
    """Render the class transition clause of a warning."""
    if previous == new:
        return f"class {previous} is unchanged" if previous is not None else "no class either way"
    if new is None:
        return f"class {previous} becomes 'needs review'"
    if previous is None:
        return f"'needs review' becomes class {new}"
    return f"class {previous} becomes {new}"


def _build_warnings(
    outcomes: Sequence[IntervalOutcome],
    min_thickness_m: float,
) -> tuple[BandEditWarning, ...]:
    """Advisory consequences of an edit — never a reason to refuse it.

    Two families, both from the owner's spec:

    * **qc pull** — for every band feeding a resulting interval, whether that
      band's representative qc is pulled DOWN or UP by the material it now
      shares a layer with, and what the resulting class becomes.
    * **below minimum thickness** — a resulting band thinner than the configured
      packing minimum. The owner overrules the minimum; he is told, not stopped.

    Parameters
    ----------
    outcomes : Sequence[IntervalOutcome]
        The re-derived intervals.
    min_thickness_m : float
        The configured minimum packing-band thickness (view-state knob).

    Returns
    -------
    tuple[BandEditWarning, ...]
        Advisory warnings, in interval order.
    """
    warnings: list[BandEditWarning] = []
    for outcome in outcomes:
        thickness = outcome.depth_base_m - outcome.depth_top_m
        if thickness < min_thickness_m - _DEPTH_EPS_M:
            warnings.append(
                BandEditWarning(
                    code=WARNING_BELOW_MINIMUM_THICKNESS,
                    message=(
                        f"The resulting band is {thickness:.2f} m thick, below the "
                        f"{min_thickness_m:.2f} m minimum for a packing band. Kept anyway "
                        "— a manual edit overrules the minimum."
                    ),
                    depth_top_m=outcome.depth_top_m,
                    depth_base_m=outcome.depth_base_m,
                    band_id=None,
                )
            )
        for source in outcome.sources:
            old = source.previous_median_qc_mpa
            new = outcome.median_qc_mpa
            if old is None or new is None:
                warnings.append(
                    BandEditWarning(
                        code=WARNING_QC_UNAVAILABLE,
                        message=(
                            outcome.unclassifiable_reason
                            or "Cone resistance cannot answer for this band, so the "
                            "consequence of the move cannot be predicted."
                        ),
                        depth_top_m=outcome.depth_top_m,
                        depth_base_m=outcome.depth_base_m,
                        band_id=source.band_id,
                    )
                )
                continue
            # The class is what ships, so it decides whether there is anything to say.
            # Reporting only qc movement let a real reclassification through silently: on
            # a ZAND band of 12 / 9 / 3 MPa the build persists class 6, a hand split at
            # 0.04 m commits class 7, and the only warning read "class 6 is unchanged".
            # Never skip a class change, whatever the medians did.
            class_changed = outcome.nad_class != source.previous_nad_class
            moved = round(new, 1) != round(old, 1)
            if not moved and not class_changed:
                continue
            if new == old:
                # Same representative qc, different class — the band's own qc did not
                # move, its EXTENT did. There is no direction to report, only the class.
                warnings.append(
                    BandEditWarning(
                        code=WARNING_CLASS_CHANGED,
                        message=(
                            f"The representative qc stays at {new:.1f} MPa, but "
                            f"{_class_phrase(source.previous_nad_class, outcome.nad_class)}."
                        ),
                        depth_top_m=outcome.depth_top_m,
                        depth_base_m=outcome.depth_base_m,
                        band_id=source.band_id,
                    )
                )
                continue
            direction = "DOWN" if new < old else "UP"
            warnings.append(
                BandEditWarning(
                    code=WARNING_QC_PULL_DOWN if new < old else WARNING_QC_PULL_UP,
                    message=(
                        f"Pulls the representative qc of this layer {direction} from "
                        f"{old:.1f} to {new:.1f} MPa, "
                        f"{_class_phrase(source.previous_nad_class, outcome.nad_class)}."
                    ),
                    depth_top_m=outcome.depth_top_m,
                    depth_base_m=outcome.depth_base_m,
                    band_id=source.band_id,
                )
            )
    return tuple(warnings)


# ---------------------------------------------------------------------------
# Planners — one per gesture
# ---------------------------------------------------------------------------


def plan_split(
    *,
    bands: Sequence[GeotechBand],
    band_id: str,
    split_depth_m: float,
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    min_thickness_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> BandEditPlan:
    """Plan a hand split of one packing band, with both halves reclassified.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the edited column, ordered top to bottom.
    band_id : str
        The band being split.
    split_depth_m : float
        Proposed boundary depth (metres, positive down).
    soil : BaseLithology | None
        Main soil type of the parent litho unit; ``None`` when the unit carries
        no soil code (every interval then comes back "cannot answer").
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures.
    depth_m, qc_mpa : Sequence
        The column's CPT series.
    min_thickness_m : float
        Configured minimum packing-band thickness (advisory only).
    statistic : str
        The model's representative-qc statistic (ruling 7).

    Returns
    -------
    BandEditPlan
        Two intervals with their re-derived classes, plus advisory warnings.

    Raises
    ------
    GeotechBandEditError
        When the depth falls outside the band's own litho body (a hard wall), or
        outside the band being split.
    """
    index = _index_of(bands, band_id)
    target = bands[index]
    parent_top, parent_base = enclosing_litho_bounds(bands, index)
    # Rounded FIRST, like plan_move and plan_restated_contact_move: the commit
    # writes round(depth, 3), so validating or classifying at the raw depth
    # previews a split the disk never gets — and a raw depth strictly inside the
    # band can round ONTO its edge, which used to reach the database as a
    # zero-width row and a constraint error mid-transaction (audit F15).
    split_depth_m = round(split_depth_m, LITHO_LAYER_DEPTH_DECIMALS)
    if not (parent_top + _DEPTH_EPS_M < split_depth_m < parent_base - _DEPTH_EPS_M):
        raise GeotechBandEditError(
            f"Split rejected: {split_depth_m:.2f} m falls outside the band's own litho "
            f"body ({parent_top:.2f}–{parent_base:.2f} m). A packing boundary moves "
            "freely inside its litho body and clamps at the edge — it never moves or "
            "crosses a lithostratigraphic contact."
        )
    if not (target.depth_top_m + _DEPTH_EPS_M < split_depth_m < target.depth_base_m - _DEPTH_EPS_M):
        raise GeotechBandEditError(
            f"Split rejected: {split_depth_m:.2f} m is not inside the band being split "
            f"({target.depth_top_m:.2f}–{target.depth_base_m:.2f} m). Split the band "
            "that contains the depth."
        )
    proposed = [
        ProposedInterval(target.depth_top_m, split_depth_m, (target,)),
        ProposedInterval(split_depth_m, target.depth_base_m, (target,)),
    ]
    outcomes = reclassify_intervals(
        soil=soil,
        admixtures=admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        intervals=proposed,
        statistic=statistic,
    )
    return BandEditPlan(
        kind=KIND_SPLIT,
        parent_top_m=parent_top,
        parent_base_m=parent_base,
        intervals=outcomes,
        warnings=_build_warnings(outcomes, min_thickness_m),
        statistic=statistic,
    )


def plan_merge(
    *,
    bands: Sequence[GeotechBand],
    upper_band_id: str,
    lower_band_id: str,
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    min_thickness_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> BandEditPlan:
    """Plan a hand merge of two adjacent packing bands, reclassified as one.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the edited column, ordered top to bottom.
    upper_band_id, lower_band_id : str
        The adjacent pair to merge (upper is the shallower one).
    soil : BaseLithology | None
        Main soil type of the parent litho unit; ``None`` when the unit carries
        no soil code (every interval then comes back "cannot answer").
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures.
    depth_m, qc_mpa : Sequence
        The column's CPT series.
    min_thickness_m : float
        Configured minimum packing-band thickness (advisory only).
    statistic : str
        The model's representative-qc statistic (ruling 7).

    Returns
    -------
    BandEditPlan
        One interval spanning the union, with its re-derived class, plus the
        advisory warnings that say what each input band's representative qc does.

    Raises
    ------
    GeotechBandEditError
        When the two bands are not adjacent, or do not share both parents (a
        merge never swallows a litho or geological contact).
    """
    # The pair is the N=2 case of the run planner — one union path, one set of
    # refusal rules (extract-on-second-copy: the small-lens absorb is caller
    # two of the same union).
    return plan_merge_run(
        bands=bands,
        band_ids=[upper_band_id, lower_band_id],
        soil=soil,
        admixtures=admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        min_thickness_m=min_thickness_m,
        statistic=statistic,
    )


def plan_merge_run(
    *,
    bands: Sequence[GeotechBand],
    band_ids: Sequence[str],
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    min_thickness_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> BandEditPlan:
    """Plan a merge of an N-band CONTIGUOUS run into one reclassified band.

    The generalisation the small-lens absorb needs (host + lens + host in ONE
    atomic plan: one honest preview, one undo step — two sequential pair
    merges would show an intermediate class that never exists). N=2 is the
    ordinary pair merge and :func:`plan_merge` delegates here.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the edited column, ordered top to bottom.
    band_ids : Sequence[str]
        The run to merge, 2..N bands, any order (normalised by depth).
    soil : BaseLithology | None
        Main soil type of the parent litho unit.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures.
    depth_m, qc_mpa : Sequence
        The column's CPT series.
    min_thickness_m : float
        Configured minimum packing-band thickness (advisory only).
    statistic : str
        The model's representative-qc statistic (ruling 7).

    Returns
    -------
    BandEditPlan
        One interval spanning the union, re-derived, plus advisory warnings.

    Raises
    ------
    GeotechBandEditError
        When the run has fewer than two distinct bands, is not consecutive,
        has a hole, or crosses a litho / geological contact (ruling 2 — a
        union never swallows a contact).
    """
    indices = sorted({_index_of(bands, str(band_id)) for band_id in band_ids})
    if len(indices) < 2:
        raise GeotechBandEditError("Merge rejected: a merge needs at least two distinct bands.")
    run = [bands[i] for i in indices]
    for prev_index, next_index in zip(indices, indices[1:]):
        upper, lower = bands[prev_index], bands[next_index]
        if next_index - prev_index != 1:
            raise GeotechBandEditError(
                "Merge rejected: only ADJACENT packing bands can be merged "
                f"(bands {upper.band_id} and {lower.band_id} are not neighbours)."
            )
        if abs(upper.depth_base_m - lower.depth_top_m) > _ADJACENCY_EPS_M:
            raise GeotechBandEditError(
                "Merge rejected: the two bands do not share a boundary "
                f"(upper base {upper.depth_base_m:.3f} m, lower top {lower.depth_top_m:.3f} m)."
            )
        _assert_same_litho_body(upper, lower)
    parent_top, parent_base = enclosing_litho_bounds(bands, indices[0])
    proposed = [ProposedInterval(run[0].depth_top_m, run[-1].depth_base_m, tuple(run))]
    outcomes = reclassify_intervals(
        soil=soil,
        admixtures=admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        intervals=proposed,
        statistic=statistic,
    )
    return BandEditPlan(
        kind=KIND_MERGE,
        parent_top_m=parent_top,
        parent_base_m=parent_base,
        intervals=outcomes,
        warnings=_build_warnings(outcomes, min_thickness_m),
        statistic=statistic,
    )


def plan_move(
    *,
    bands: Sequence[GeotechBand],
    upper_band_id: str,
    lower_band_id: str,
    new_depth_m: float,
    soil: BaseLithology | None,
    admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    min_thickness_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> BandEditPlan:
    """Plan dragging the shared boundary of two adjacent bands, both reclassified.

    Ruling 3 applied to the drag: "you recalculate after drag merge, the qc" —
    BOTH resulting intervals re-derive from the qc over their new extents. The
    pair's own envelope is the hard wall: drag is only offered on a
    same-parentage pair (that boundary is the owner's packing subdivision, not
    a contact), so the pair's outer edges cannot exceed the litho body and the
    strictly-inside test subsumes ruling 2's walls. The squeeze-to-collapse
    case (a survivor thinner than the mm grain) is refused here because the
    ABSORB gesture is the honest verb for it — the FE converts a past-threshold
    release into a merge.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the edited column, ordered top to bottom.
    upper_band_id, lower_band_id : str
        The adjacent pair whose shared boundary moves (order normalised).
    new_depth_m : float
        The proposed boundary depth (metres, positive down).
    soil : BaseLithology | None
        Main soil type of the parent litho unit.
    admixtures : tuple[Admixture, ...]
        Parent unit admixtures.
    depth_m, qc_mpa : Sequence
        The column's CPT series.
    min_thickness_m : float
        Configured minimum packing-band thickness — ADVISORY (ruling 5: a
        thin survivor warns, never blocks).
    statistic : str
        The model's representative-qc statistic (ruling 7).

    Returns
    -------
    BandEditPlan
        Two intervals with their re-derived classes, plus advisory warnings.

    Raises
    ------
    GeotechBandEditError
        When the bands are not an adjacent same-parentage pair, or the depth
        is not strictly inside the pair (incl. a survivor thinner than the
        millimetre grain the DB stores).
    """
    upper_index = _index_of(bands, upper_band_id)
    lower_index = _index_of(bands, lower_band_id)
    if upper_index > lower_index:
        upper_index, lower_index = lower_index, upper_index
    upper, lower = bands[upper_index], bands[lower_index]
    if lower_index - upper_index != 1:
        raise GeotechBandEditError(
            "Move rejected: only the shared boundary of two ADJACENT packing "
            f"bands can be dragged (bands {upper.band_id} and {lower.band_id} "
            "are not neighbours)."
        )
    if abs(upper.depth_base_m - lower.depth_top_m) > _ADJACENCY_EPS_M:
        raise GeotechBandEditError(
            "Move rejected: the two bands do not share a boundary "
            f"(upper base {upper.depth_base_m:.3f} m, lower top {lower.depth_top_m:.3f} m)."
        )
    _assert_same_litho_body(upper, lower, verb="Move")
    rounded = round(new_depth_m, LITHO_LAYER_DEPTH_DECIMALS)
    # Strictly inside the pair, with both survivors at least the millimetre
    # grain the no-overlap exclusion stores. Not the min-thickness pref — that
    # is advisory (ruling 5); this is the structural floor below which a row
    # cannot exist.
    if not (upper.depth_top_m + _DEPTH_EPS_M < rounded < lower.depth_base_m - _DEPTH_EPS_M):
        raise GeotechBandEditError(
            f"Move rejected: {new_depth_m:.2f} m falls outside the pair "
            f"({upper.depth_top_m:.2f}–{lower.depth_base_m:.2f} m). To collapse a "
            "band entirely, drag past it — the squeeze becomes a merge."
        )
    parent_top, parent_base = enclosing_litho_bounds(bands, upper_index)
    proposed = [
        ProposedInterval(upper.depth_top_m, rounded, (upper,)),
        ProposedInterval(rounded, lower.depth_base_m, (lower,)),
    ]
    outcomes = reclassify_intervals(
        soil=soil,
        admixtures=admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        intervals=proposed,
        statistic=statistic,
    )
    return BandEditPlan(
        kind=KIND_MOVE,
        parent_top_m=parent_top,
        parent_base_m=parent_base,
        intervals=outcomes,
        warnings=_build_warnings(outcomes, min_thickness_m),
        statistic=statistic,
    )


def plan_restated_contact_move(
    *,
    bands: Sequence[GeotechBand],
    upper_band_id: str,
    lower_band_id: str,
    new_depth_m: float,
    upper_soil: BaseLithology | None,
    upper_admixtures: tuple[Admixture, ...],
    lower_soil: BaseLithology | None,
    lower_admixtures: tuple[Admixture, ...],
    depth_m: Sequence[float],
    qc_mpa: Sequence[float | None],
    min_thickness_m: float,
    statistic: str = DEFAULT_STATISTIC,
) -> BandEditPlan:
    """Plan dragging the boundary that RESTATES a lithostratigraphic contact.

    The sibling of :func:`plan_move`, for the other kind of boundary. A pair
    inside one litho unit is the engineer's own packing subdivision and
    ``plan_move`` owns it; a pair spanning two units is a litho contact recorded
    once per model, and moving it moves all three levels together (owner ruling,
    2026-08-09: *"we're refining from geo-litho-geotech, so if we want to refine
    in the geotech then the rest should move too"*).

    Why this cannot be a flag on ``plan_move``: the two bands subdivide DIFFERENT
    litho units, so they have different soil types. The chain is soil type → qc →
    NAD parameters, so each side must re-derive under its OWN soil. Passing one
    soil for both would classify the sand with the clay's NAD column.

    The classes DO re-derive (ruling 3). Moving the boundary changes both
    intervals, so it changes the qc each one spans, so it changes what the ground
    is called there.

    Parameters
    ----------
    bands : Sequence[GeotechBand]
        Every packing band on the edited column, ordered top to bottom.
    upper_band_id, lower_band_id : str
        The adjacent pair the contact separates (order normalised by depth).
    new_depth_m : float
        Where the contact lands, in metres below the collar.
    upper_soil, lower_soil : BaseLithology | None
        Main soil of each band's own litho unit. ``None`` yields "cannot answer"
        for that side, matching the build's skeleton-band path.
    upper_admixtures, lower_admixtures : tuple[Admixture, ...]
        Each unit's admixtures (clean vs secondary NAD variant).
    depth_m, qc_mpa : Sequence
        The column's full cone-resistance series.
    min_thickness_m : float
        The model's advisory thinnest-band preference (drives warnings only).
    statistic : str
        Which representative qc the classifier reads (rulings 6-8).

    Returns
    -------
    BandEditPlan
        Both re-derived intervals, upper first, with the pair envelope as bounds.

    Raises
    ------
    GeotechBandEditError
        When the bands are not adjacent, do not share a boundary, sit in the SAME
        litho unit (that is the packing drag), or the depth is not strictly
        inside the pair.
    """
    upper_index = _index_of(bands, upper_band_id)
    lower_index = _index_of(bands, lower_band_id)
    if upper_index > lower_index:
        upper_index, lower_index = lower_index, upper_index
    upper, lower = bands[upper_index], bands[lower_index]
    if lower_index - upper_index != 1:
        raise GeotechBandEditError(
            "Contact move rejected: only the shared boundary of two ADJACENT "
            f"bands can be dragged (bands {upper.band_id} and {lower.band_id} "
            "are not neighbours)."
        )
    if abs(upper.depth_base_m - lower.depth_top_m) > _ADJACENCY_EPS_M:
        raise GeotechBandEditError(
            "Contact move rejected: the two bands do not share a boundary "
            f"(upper base {upper.depth_base_m:.3f} m, lower top {lower.depth_top_m:.3f} m)."
        )
    # The positive form of ruling 2. ``plan_move`` refuses a cross-unit pair; this
    # refuses a same-unit one, so every boundary has exactly one verb and the two
    # can never disagree about which consequence a drag carries.
    if upper.source_litho_formation_id == lower.source_litho_formation_id:
        raise GeotechBandEditError(
            "Contact move rejected: these two bands subdivide the SAME "
            "lithostratigraphic unit, so their boundary is a packing boundary — "
            "drag it with the packing verb, which re-derives the classes without "
            "touching the litho model."
        )
    rounded = round(new_depth_m, LITHO_LAYER_DEPTH_DECIMALS)
    # LANDING ON THE LOWER BAND'S BASE IS A MERGE, not a refusal.
    #
    # The owner named this gesture himself — *"can't skip a boundary right, drag
    # merge, first, then drag merge second"*. Dragging the contact down to the next
    # packing boundary means the litho unit ABOVE now owns the ground down to it, so
    # the band that sat between the two collapses into the band above.
    #
    # It is the headline case, not an edge one: the clamp lands every such drag
    # exactly ON a boundary, so a strictly-inside rule refuses the only landing this
    # gesture can produce. ``plan_move`` is right to demand strictly-inside — a
    # PACKING boundary may not swallow its neighbour — and inheriting that rule here
    # is what broke the snap.
    if abs(rounded - lower.depth_base_m) <= _DEPTH_EPS_M:
        # A merge absorbs the lower band, so the contact lands on that band's BASE.
        # That is a legal refinement while the lower unit keeps band below it — the
        # unit simply starts deeper. It is a deletion when the absorbed band is the
        # unit's last one, because then the contact lands on the NEXT contact and the
        # unit between them ceases to exist.
        #
        # Refused here rather than left to the database. The write is one transaction
        # across three models, so the litho contiguity rule does stop it — but as an
        # unhandled error, which reaches the engineer as a bare failure with no reason
        # attached (the owner met it as "this happens when i try to move a solid on
        # another solid"). A drag on this axis refines a boundary; removing a unit is
        # the litho axis's job, and the message says so.
        below = bands[lower_index + 1] if lower_index + 1 < len(bands) else None
        if below is None or below.source_litho_formation_id != lower.source_litho_formation_id:
            raise GeotechBandEditError(
                "Contact move rejected: landing here would absorb the last packing "
                "band of the lithostratigraphic unit below, which would delete the "
                "unit itself. Stop short of that boundary, subdivide the unit below "
                "first, or remove the unit on the lithology axis."
            )
        # NO geo wall here — REVERSED (owner, 2026-08-12). The audit-F03 wall
        # refused a landing ON a geological contact; the owner hit it on
        # GEO-10/170-S6 where the swallowed interval stayed inside one formation
        # and ruled: "yes allow it and couple them, this is unnecessary
        # friction." The landing does not move or cross the geo contact — the
        # WRITER couples the litho contact to it, and refuses the one dangerous
        # case: carrying a DIFFERENT geological contact onto this one.
        (survivor,) = reclassify_intervals(
            soil=upper_soil,
            admixtures=upper_admixtures,
            depth_m=depth_m,
            qc_mpa=qc_mpa,
            # The union takes the UPPER unit's soil, because that is the unit the
            # ground now belongs to. Both bands contribute their previous class, so
            # the consequence sheet can say what each side carried before.
            intervals=[ProposedInterval(upper.depth_top_m, lower.depth_base_m, (upper, lower))],
            statistic=statistic,
        )
        return BandEditPlan(
            kind=KIND_MERGE,
            parent_top_m=upper.depth_top_m,
            parent_base_m=lower.depth_base_m,
            intervals=(survivor,),
            warnings=_build_warnings((survivor,), min_thickness_m),
            statistic=statistic,
            absorbs="lower",
        )
    # LANDING ON THE PAIR'S TOP IS THE UPWARD MERGE — the mirror, not a variation.
    #
    # Direction decides who swallows whom (owner, §4c): "Down = the layer above grows;
    # up = the reverse." Dragging the contact UP onto the previous packing boundary
    # means the litho unit BELOW now owns the ground up to it, so the upper band
    # collapses into the band below and the survivor is classified under the LOWER
    # unit's soil. Until this branch existed the renderer clamped every upward drag
    # onto exactly this landing, telegraphed "release to merge", opened the
    # consequence dialog — and the confirm was answered with the strictly-inside
    # refusal (audit F02, found by three lenses independently).
    if abs(rounded - upper.depth_top_m) <= _DEPTH_EPS_M:
        # The RC7 mirror: absorbing the upper unit's LAST band deletes the unit
        # above. The renderer's contact-wall clamp stops an upward drag short of
        # this landing, so reaching it means the clamp failed — this refusal is the
        # second line of defence, exactly as the downward guard is.
        above = bands[upper_index - 1] if upper_index > 0 else None
        if above is None or above.source_litho_formation_id != upper.source_litho_formation_id:
            raise GeotechBandEditError(
                "Contact move rejected: landing here would absorb the last packing "
                "band of the lithostratigraphic unit above, which would delete the "
                "unit itself. Stop short of that boundary, subdivide the unit above "
                "first, or remove the unit on the lithology axis."
            )
        # NO geo wall here either — the same 2026-08-12 reversal as the downward
        # branch: landing ON a geological contact couples, in the writer.
        (survivor,) = reclassify_intervals(
            soil=lower_soil,
            admixtures=lower_admixtures,
            depth_m=depth_m,
            qc_mpa=qc_mpa,
            # The union takes the LOWER unit's soil — the ground up there now
            # belongs to the unit below.
            intervals=[ProposedInterval(upper.depth_top_m, lower.depth_base_m, (upper, lower))],
            statistic=statistic,
        )
        return BandEditPlan(
            kind=KIND_MERGE,
            parent_top_m=upper.depth_top_m,
            parent_base_m=lower.depth_base_m,
            intervals=(survivor,),
            warnings=_build_warnings((survivor,), min_thickness_m),
            statistic=statistic,
            absorbs="upper",
        )
    # Anywhere else: strictly inside the pair, both survivors at least the millimetre
    # grain the no-overlap exclusion stores.
    if not (upper.depth_top_m + _DEPTH_EPS_M < rounded < lower.depth_base_m - _DEPTH_EPS_M):
        raise GeotechBandEditError(
            f"Contact move rejected: {new_depth_m:.2f} m falls outside the pair "
            f"({upper.depth_top_m:.2f}-{lower.depth_base_m:.2f} m)."
        )
    # One call per side, because one call cannot carry two soils.
    (upper_outcome,) = reclassify_intervals(
        soil=upper_soil,
        admixtures=upper_admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        intervals=[ProposedInterval(upper.depth_top_m, rounded, (upper,))],
        statistic=statistic,
    )
    (lower_outcome,) = reclassify_intervals(
        soil=lower_soil,
        admixtures=lower_admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        intervals=[ProposedInterval(rounded, lower.depth_base_m, (lower,))],
        statistic=statistic,
    )
    outcomes = (upper_outcome, lower_outcome)
    return BandEditPlan(
        kind=KIND_MOVE,
        # The pair's own outer edges. The usual "parent" bounds are one litho
        # unit's, and this pair straddles two, so there is no single parent to
        # report — the envelope is what the gesture is actually bounded by.
        parent_top_m=upper.depth_top_m,
        parent_base_m=lower.depth_base_m,
        intervals=outcomes,
        warnings=_build_warnings(outcomes, min_thickness_m),
        statistic=statistic,
    )
