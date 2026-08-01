"""READ-ONLY: where the blend cuts a body into more pieces than a section shows (#261).

``_layout`` lays out every placement spec in one order, sorted by reference elevation.
A body that one section carries as several intervals contributes several specs, and the
one-sided units of the other section carry references that fall BETWEEN them — so the
laid-out column alternates body, intruder, body, intruder, where the facing section shows
one unbroken unit.

This script sweeps the stored generation's own grid, finds every column where that
happens, and writes the worst cases to ``blend_viewer/fragment.json`` with the two
sections that made them and THREE renderings of the same column:

* ``today``   — the blend exactly as shipped (``_blend_stacks`` → ``_layout``);
* ``thin``    — the intruding unit thins to nothing inside the host, which stays whole
                and takes the ground the intruder gives up;
* ``outside`` — the intruding unit keeps its thickness but is moved wholly above or
                below the host, which stays whole.

**None of the three is endorsed and none is implemented anywhere but here.**  ``thin``
and ``outside`` are computed in this file for comparison only; ``label_voxels`` is not
touched.  Which of them is right is a claim about how a thin unit dies into a thick one,
and that is the owner's ruling.

Nothing is written to the database.  Guarded to the dev DB like every other voxel
diagnostic.

Usage
-----
    uv run python scripts/dump_fragmentation_cases.py
    uv run python scripts/dump_fragmentation_cases.py --stride 2 --cases 12
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _blend_stacks,
    _blended_top,
    _Entry,
    _honored_cells,
    _layout,
    _mid,
    _pair_occurrences,
    _project_to_section_fence,
    _section_stack_at,
    _th,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

#: The position the debt entry measured.  Always emitted, whatever the sweep ranks.
_NAMED_POINT: tuple[float, float] = (88022.0, 164359.0)

#: Two emitted cases must be at least this far apart, so eight cases are eight PLACES.
#: Neighbouring grid columns produce near-identical stacks; without this the whole
#: listing collapses onto one locality and the owner sees one case eight times.
_MIN_CASE_SEPARATION_M: float = 25.0

#: Thickness below which a laid-out interval is treated as absent (mirrors ``_EPS``).
_EPS: float = 1e-9

#: A placement spec: the production ``(ref_elev, body_id, formation_id, thickness)``
#: tuple plus a flag for "only one of the two sections carries this body".
_Spec = tuple[float, str | None, str, float, bool]


# ---------------------------------------------------------------------------
# Body identity as the VOXEL GRID sees it
# ---------------------------------------------------------------------------


def _key(body_id: str | None, formation_id: str) -> str:
    """Body identity as ``_column_labels`` resolves it.

    A never-correlated minority carries ``body_id is None`` and is labelled with a
    synthetic per-formation id, so two adjacent ``None`` intervals of one formation are
    ONE body in the grid.  Counting them as two would invent fragmentation the model
    does not show.

    Parameters
    ----------
    body_id : str or None
        The resolver-stamped body identity, or ``None`` for a minority.
    formation_id : str
        The interval's lithology.

    Returns
    -------
    str
        The identity the label grid uses.
    """
    return body_id if body_id is not None else f"__none__:{formation_id}"


def _runs(entries: list[_Entry]) -> dict[str, int]:
    """Count each body's MAXIMAL runs in a stack.

    Two entries of one body that touch are one interval of that body — the grid cannot
    tell them apart, and neither can the owner looking at the model.  Only a run broken
    by another body counts as a second interval.

    Parameters
    ----------
    entries : list of _Entry
        A stack ordered shallow → deep.

    Returns
    -------
    dict of str to int
        Body key → number of maximal runs.
    """
    counts: dict[str, int] = defaultdict(int)
    previous: str | None = None
    for entry in entries:
        current = _key(entry.body_id, entry.formation_id)
        if current != previous:
            counts[current] += 1
        previous = current
    return dict(counts)


# ---------------------------------------------------------------------------
# The production spec list, rebuilt so the candidates can re-order it
# ---------------------------------------------------------------------------


def _specs(stack1: list[_Entry], stack2: list[_Entry], w1: float) -> list[_Spec]:
    """Rebuild the placement specs ``_blend_stacks`` hands to ``_layout``.

    A verbatim re-derivation of the spec construction in
    :func:`~groundmodel.domain.services.voxel_litho.label_voxels._blend_stacks` under the
    settings the production build runs at (``reach_to_evidence=True``, no measured pinch
    factors), because the candidate rules need the specs and ``_blend_stacks`` returns
    only the laid-out result.  Every case this script emits is checked against the real
    ``_blend_stacks`` output before it is written, so a drift between the two is caught
    rather than published.

    Each spec carries one extra field the production tuple does not: whether it came from
    a ONE-SIDED body — a body the facing section does not carry, whose thickness the
    blend scales by its own weight.  That flag is what tells the candidate rules which
    units are the intruders #261 is about; a unit BOTH sections carry is not one.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The nearest and second-nearest sections' stacks, shallow → deep.
    w1 : float
        The inverse-distance weight on ``stack1``.

    Returns
    -------
    list of _Spec
        ``(ref_elev, body_id, formation_id, thickness, one_sided)`` sorted shallow → deep,
        in exactly the order ``_blend_stacks`` sorts its own tuples.
    """
    w2 = 1.0 - w1
    g1: dict[str, list[_Entry]] = defaultdict(list)
    g2: dict[str, list[_Entry]] = defaultdict(list)
    for entry in stack1:
        if entry.body_id is not None:
            g1[entry.body_id].append(entry)
    for entry in stack2:
        if entry.body_id is not None:
            g2[entry.body_id].append(entry)
    matched = set(g1) & set(g2)

    specs: list[_Spec] = []
    for body in sorted(matched):
        for e1, e2 in _pair_occurrences(g1[body], g2[body]):
            if e1 is not None and e2 is not None:
                specs.append(
                    (
                        w1 * _mid(e1) + w2 * _mid(e2),
                        body,
                        e1.formation_id,
                        w1 * _th(e1) + w2 * _th(e2),
                        False,
                    )
                )
            elif e1 is not None:
                specs.append((_mid(e1), body, e1.formation_id, _th(e1) * w1, False))
            elif e2 is not None:
                specs.append((_mid(e2), body, e2.formation_id, _th(e2) * w2, False))
    for entry in stack1:
        if entry.body_id is None or entry.body_id not in matched:
            specs.append((_mid(entry), entry.body_id, entry.formation_id, _th(entry) * w1, True))
    for entry in stack2:
        if entry.body_id is None or entry.body_id not in matched:
            specs.append((_mid(entry), entry.body_id, entry.formation_id, _th(entry) * w2, True))
    specs.sort(key=lambda s: (-s[0], str(s[1])))
    return specs


def _lay_out(specs: list[_Spec], top: float | None) -> list[_Entry]:
    """Lay specs out with the production ``_layout``, dropping the one-sided flag."""
    return _layout(
        [(ref, body, formation, thickness) for ref, body, formation, thickness, _o in specs], top
    )


# ---------------------------------------------------------------------------
# The two candidate rules — comparison only, nothing here ships
# ---------------------------------------------------------------------------


def _intruded_host(specs: list[_Spec], done: set[str]) -> tuple[int, int, str] | None:
    """The widest body group in ``specs`` that a ONE-SIDED spec sits inside.

    A group is intruded when the span of its own indices holds a spec of another body
    that only ONE of the two sections carries — the exact shape #261 describes.  A group
    interrupted only by a body BOTH sections carry is left alone: that ordering is the
    interpolation of two agreed bodies, and neither candidate rule says anything about
    it.  (An early version of this script did not make the distinction, and ``thin`` then
    absorbed a 2.3 m clay both sections draw.)

    Parameters
    ----------
    specs : list of _Spec
        The placement specs, in layout order.
    done : set of str
        Body keys already rewritten once; skipped so a rewrite that moves a unit into
        another group cannot ping-pong forever.

    Returns
    -------
    tuple of (int, int, str) or None
        ``(first_index, last_index, body_key)`` of the widest intruded group, or ``None``
        when none is left.
    """
    positions: dict[str, list[int]] = defaultdict(list)
    for index, spec in enumerate(specs):
        positions[_key(spec[1], spec[2])].append(index)
    hosts = []
    for key, idx in positions.items():
        if key in done or len(idx) < 2:
            continue
        own = set(idx)
        inside = [specs[i] for i in range(idx[0], idx[-1] + 1) if i not in own]
        if any(spec[4] for spec in inside):
            hosts.append((idx[-1] - idx[0], -idx[0], idx[0], idx[-1], key))
    if not hosts:
        return None
    # Widest first, so a group enclosing another is resolved before the one inside it;
    # the index tie-break keeps the choice deterministic.
    _width, _negative_first, first, last, key = max(hosts)
    return first, last, key


def _candidate_specs(specs: list[_Spec], absorb: bool) -> tuple[list[_Spec], bool]:
    """Apply one candidate rule to the spec list.

    Both rules keep the HOST whole: its pieces coalesce where the intruding one-sided
    units leave.  They differ in what becomes of the intruder:

    * ``absorb=True`` (**thin**) — the intruder's thickness goes to zero and the host
      piece above it takes that ground, so the unit dies inside the unit it intruded on.
    * ``absorb=False`` (**outside**) — the intruder keeps every centimetre and moves
      wholly above the host if its own reference elevation is above the host's midpoint,
      else wholly below it.

    Only ONE-SIDED intruders are touched (see :func:`_intruded_host`).  A host that is
    also interrupted by a body both sections carry therefore stays split at that point,
    under both rules — which the caller reports rather than hides.

    Groups are resolved widest-first and re-detected after each step, so a group nested
    inside another is handled too; a group already rewritten is not revisited, which
    bounds the loop.

    The thickness sum is preserved exactly in both arms — ``thin`` moves thickness from
    the intruder to the host, ``outside`` moves no thickness at all — and both are laid
    out from the same blended top, which is what makes the three renderings comparable
    depth for depth.

    Parameters
    ----------
    specs : list of _Spec
        The production placement specs, in layout order.
    absorb : bool
        ``True`` for the **thin** rule, ``False`` for **outside**.

    Returns
    -------
    tuple of (list of _Spec, bool)
        The rewritten specs, and whether the rewrite reached a fixed point.
    """
    work = list(specs)
    done: set[str] = set()
    for _ in range(len(specs) + 2):
        host = _intruded_host(work, done)
        if host is None:
            return work, True
        first, last, key = host
        done.add(key)
        block = work[first : last + 1]
        moved = [s for s in block if _key(s[1], s[2]) != key and s[4]]
        kept = [s for s in block if _key(s[1], s[2]) == key or not s[4]]

        new_block: list[_Spec] = []
        if absorb:
            # Walk the block in place so each intruder's ground goes to the nearest HOST
            # piece above it — the piece it dies into. A block always starts with the
            # host, so there is always such a piece; and it must be the HOST, not merely
            # whatever sits above, or an intruder that happens to lie under a body both
            # sections carry would feed its ground to that body instead.
            last_host = -1
            for spec in block:
                is_host = _key(spec[1], spec[2]) == key
                if not is_host and spec[4]:
                    previous = new_block[last_host]
                    new_block[last_host] = (*previous[:3], previous[3] + spec[3], previous[4])
                    continue
                if is_host and last_host >= 0 and last_host == len(new_block) - 1:
                    previous = new_block[last_host]
                    new_block[last_host] = (*previous[:3], previous[3] + spec[3], previous[4])
                    continue
                if is_host:
                    last_host = len(new_block)
                new_block.append(spec)
        else:
            refs = [s[0] for s in block if _key(s[1], s[2]) == key]
            middle = 0.5 * (max(refs) + min(refs))
            above = [s for s in moved if s[0] > middle]
            below = [s for s in moved if s[0] <= middle]
            middle_block: list[_Spec] = []
            for spec in kept:
                if middle_block and _key(middle_block[-1][1], middle_block[-1][2]) == _key(
                    spec[1], spec[2]
                ):
                    previous = middle_block[-1]
                    middle_block[-1] = (*previous[:3], previous[3] + spec[3], previous[4])
                    continue
                middle_block.append(spec)
            new_block = [*above, *middle_block, *below]
        work = work[:first] + new_block + work[last + 1 :]
    return work, False


# ---------------------------------------------------------------------------
# The blend at one column, opened up
# ---------------------------------------------------------------------------


def _blend_at(sections: list[SectionPartitionInput], x: float, y: float) -> dict[str, Any] | None:
    """Reproduce ``_stack_at``'s between-sections branch at ``(x, y)``.

    Mirrors the production path the build runs (geology-independent, so
    ``_stack_at`` and not the band-scoped assembly; ``reach_to_evidence=True`` and no
    measured pinch factors, which are ``label_voxels``' own defaults).  Returns ``None``
    where no blend happens at all: fewer than two sections, the beyond rule (the column
    is not between its two nearest), or one of the two stacks empty — in each of those
    the column is one section's stack verbatim and nothing can be fragmented.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The generation's SEATED sections.
    x, y : float
        The map-plane column position.

    Returns
    -------
    dict or None
        The two section indices, their distances and stacks, ``w1``, the specs and the
        blended stack; ``None`` when the column takes no blend.
    """
    if not sections:
        return None
    projections = [(i, s, *_project_to_section_fence(s, x, y)) for i, s in enumerate(sections)]
    projections.sort(key=lambda p: p[4])
    if len(projections) < 2:
        return None
    i1, s1, gap1, frac1, d1, px1, py1 = projections[0]
    i2, s2, gap2, frac2, d2, px2, py2 = projections[1]
    dx, dy = px2 - px1, py2 - py1
    axis2 = dx * dx + dy * dy
    t = 0.0 if axis2 < _EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
    if not -_EPS <= t <= 1.0 + _EPS:
        return None  # beyond rule — the nearest section's stack, extended sideways
    stack1 = _section_stack_at(s1, gap1, frac1)
    stack2 = _section_stack_at(s2, gap2, frac2)
    if not stack1 or not stack2:
        return None  # an empty stack is no information; the build defers to the other
    denominator = d1 + d2
    w1 = 0.5 if denominator < _EPS else d2 / denominator
    specs = _specs(stack1, stack2, w1)
    top = _blended_top(stack1, stack2, w1)
    return {
        "i1": i1,
        "i2": i2,
        "d1": d1,
        "d2": d2,
        "w1": w1,
        "stack1": stack1,
        "stack2": stack2,
        "specs": specs,
        "top": top,
        "today": _lay_out(specs, top),
    }


def _fragments(blend: dict[str, Any]) -> list[tuple[str, int, int]]:
    """Bodies the blended column cuts into more pieces than a contributing section does.

    The test is on the laid-out INTERVALS, not on the spec list: a spec that lays out
    thinner than nothing is dropped and its neighbours join, so counting specs would
    report splits the model never shows.

    ``on_section`` is the FEWEST intervals any section carrying the body shows.  That is
    the comparison the debt entry states — one thick unit on one section against several
    in the blend — and it is deliberately the loose end of the two possible readings; the
    strict one (more pieces than EITHER section shows) is reported separately by the
    caller and is provably always zero.

    Parameters
    ----------
    blend : dict
        A :func:`_blend_at` result.

    Returns
    -------
    list of (str, int, int)
        ``(body_key, on_section, in_blend)`` for each fragmented body, worst first.
    """
    in_blend = _runs(blend["today"])
    on_a = _runs(blend["stack1"])
    on_b = _runs(blend["stack2"])
    out: list[tuple[str, int, int]] = []
    for key, count in in_blend.items():
        carried = [c for c in (on_a.get(key), on_b.get(key)) if c]
        if not carried:
            continue  # nothing carries it — cannot be in the blend, but do not assume
        fewest = min(carried)
        if count > fewest:
            out.append((key, fewest, count))
    out.sort(key=lambda f: (f[1] - f[2], -f[2]))
    return out


def _strictly_invented(blend: dict[str, Any]) -> list[tuple[str, int, int]]:
    """Bodies cut into more pieces than the MOST either section shows.

    The strict reading of "the blend fragments a body neither section fragments".  Kept
    as its own function because it is the honest control on the loose test above: a
    matched body contributes ``max(runs_a, runs_b)`` specs and ``_layout`` never splits a
    spec, so this can only ever return an empty list — and the sweep asserting that on
    real data is what turns the argument into a measurement.

    Parameters
    ----------
    blend : dict
        A :func:`_blend_at` result.

    Returns
    -------
    list of (str, int, int)
        ``(body_key, most_on_a_section, in_blend)``; empty on every column measured so
        far.
    """
    in_blend = _runs(blend["today"])
    on_a = _runs(blend["stack1"])
    on_b = _runs(blend["stack2"])
    out: list[tuple[str, int, int]] = []
    for key, count in in_blend.items():
        carried = [c for c in (on_a.get(key), on_b.get(key)) if c]
        if carried and count > max(carried):
            out.append((key, max(carried), count))
    return out


def _intruders(blend: dict[str, Any], voxel_m: float = 0.0) -> tuple[list[str], float, float]:
    """The ONE-SIDED units laid out inside another body, and what they amount to.

    This is #261's own mechanism, counted exactly rather than through the debt entry's
    order-of-first-occurrence proxy, and it is the only ground the candidate rules move:
    everything else in the column is identical under all three renderings.

    The third return value is what makes the count honest.  The build samples the column
    on a fixed vertical grid, so an intrusion thinner than one voxel — or one that leaves
    less than a voxel of host above or below it — cannot appear in the model at all.
    Counting those would inflate the number with ground nobody can see.

    Parameters
    ----------
    blend : dict
        A :func:`_blend_at` result.
    voxel_m : float, default 0.0
        The build's vertical voxel size in metres.  ``0.0`` makes every intrusion count
        as visible, which is the right answer when the grid is unknown.

    Returns
    -------
    tuple of (list of str, float, float)
        The host body keys a one-sided unit sits inside, the summed thickness of those
        intruding units, and the thickness of the thickest intrusion that the voxel grid
        can actually resolve (``0.0`` when none can).
    """
    specs = blend["specs"]
    positions: dict[str, list[int]] = defaultdict(list)
    for index, spec in enumerate(specs):
        positions[_key(spec[1], spec[2])].append(index)
    hosts: list[str] = []
    total = 0.0
    visible = 0.0
    for key, idx in positions.items():
        if len(idx) < 2:
            continue
        own = set(idx)
        span = range(idx[0], idx[-1] + 1)
        if not any(i not in own and specs[i][4] for i in span):
            continue
        hosts.append(key)
        above = 0.0
        for i in span:
            if i in own:
                above += specs[i][3]
                continue
            if not specs[i][4]:
                continue
            total += specs[i][3]
            below = sum(specs[j][3] for j in span if j > i and j in own)
            if min(specs[i][3], above, below) >= voxel_m:
                visible = max(visible, specs[i][3])
    return hosts, total, visible


# ---------------------------------------------------------------------------
# Emission
# ---------------------------------------------------------------------------


def _entries_json(entries: list[_Entry], names: dict[str, str]) -> list[dict[str, Any]]:
    """Render a stack as the JSON entry shape the viewer reads."""
    return [
        {
            "body": e.body_id or _key(e.body_id, e.formation_id),
            "formation": names.get(e.formation_id, e.formation_id),
            "top": round(e.top_elev, 4),
            "base": round(e.base_elev, 4),
        }
        for e in entries
    ]


def _section_json(
    index: int, distance: float, stack: list[_Entry], names: dict[str, str], labels: dict[int, str]
) -> dict[str, Any]:
    """Render one contributing section for the JSON."""
    return {
        "name": labels.get(index, f"section {index}"),
        "index": index,
        "distance_m": round(distance, 3),
        "entries": _entries_json(stack, names),
    }


def _case_json(
    x: float,
    y: float,
    blend: dict[str, Any],
    names: dict[str, str],
    labels: dict[int, str],
    *,
    named: bool,
    honored: bool,
    in_footprint: bool,
) -> dict[str, Any]:
    """Build one case: the two sections, the shipped blend, and the two candidates.

    Parameters
    ----------
    x, y : float
        The column position.
    blend : dict
        A :func:`_blend_at` result.
    names : dict of str to str
        formation_id → display name.
    labels : dict of int to str
        Section index → the name the owner drew it under.
    named : bool
        Whether this is the position the debt entry measured.
    honored : bool
        Whether an investigation's own log overrides part of this column in the build.
    in_footprint : bool
        Whether the build labels this column at all.

    Returns
    -------
    dict
        The case, ready to serialise.
    """
    fragmented = _fragments(blend)
    thin_specs, thin_ok = _candidate_specs(blend["specs"], absorb=True)
    outside_specs, outside_ok = _candidate_specs(blend["specs"], absorb=False)
    thin = _lay_out(thin_specs, blend["top"])
    outside = _lay_out(outside_specs, blend["top"])
    return {
        "x": round(x, 3),
        "y": round(y, 3),
        "named": named,
        "honored": honored,
        "inFootprint": in_footprint,
        "sectionA": _section_json(blend["i1"], blend["d1"], blend["stack1"], names, labels),
        "sectionB": _section_json(blend["i2"], blend["d2"], blend["stack2"], names, labels),
        "w1": round(blend["w1"], 5),
        "today": _entries_json(blend["today"], names),
        "fragmented": [
            {"body": key, "onSection": on_section, "inBlend": in_blend}
            for key, on_section, in_blend in fragmented
        ],
        "candidates": {
            "thin": _entries_json(thin, names),
            "outside": _entries_json(outside, names),
        },
        # The same two stacks again at the case root, and the measured split as an
        # object.  ``blend_viewer/fragment.html`` reads the five columns as role keys on
        # the case and takes ``worst_split`` in preference to counting them itself; the
        # nested ``candidates`` above is the shape this dump is specified in.  Two
        # spellings of the same list costs nothing in a diagnostic and means the page and
        # the contract both get what they ask for.
        "thin": _entries_json(thin, names),
        "outside": _entries_json(outside, names),
        "worst_split": (
            {
                "body": fragmented[0][0],
                "on_section": fragmented[0][1],
                "in_blend": fragmented[0][2],
            }
            if fragmented
            else None
        ),
        "preserved": _preservation(blend, thin, outside),
        "converged": {"thin": thin_ok, "outside": outside_ok},
        "notes": (
            []
            if in_footprint
            else [
                "this column is OUTSIDE the built footprint — the arithmetic is real but "
                "the model labels no ground here"
            ]
        )
        + _notes(blend, thin, outside, names),
    }


def _notes(
    blend: dict[str, Any], thin: list[_Entry], outside: list[_Entry], names: dict[str, str]
) -> list[str]:
    """What each candidate does at this column that the owner should see before ruling.

    The failure modes, not the happy path.  A rule that reads well in the abstract can
    delete a unit a section draws, or put a lithology at the ground surface that neither
    section has there, and the only place that shows is a real column.

    Parameters
    ----------
    blend : dict
        A :func:`_blend_at` result.
    thin, outside : list of _Entry
        The two candidate stacks.
    names : dict of str to str
        formation_id → display name.

    Returns
    -------
    list of str
        One line per observation; empty when neither candidate does anything notable.
    """

    def _label(entry: _Entry) -> str:
        """Display name of an interval's lithology."""
        return names.get(entry.formation_id, entry.formation_id[:6])

    out: list[str] = []

    # Both sections' own counts, spelled out. "1 interval as drawn, 4 in the blend" is
    # the debt entry's framing and it is only half true: the FACING section draws one
    # thick unit, but the nearer section draws four, and the blend is following the
    # nearer one. Anyone reading this file should see both numbers without counting the
    # entry lists themselves.
    on_a = _runs(blend["stack1"])
    on_b = _runs(blend["stack2"])
    in_blend = _runs(blend["today"])
    for key, count in sorted(in_blend.items(), key=lambda kv: -kv[1]):
        carried = [c for c in (on_a.get(key), on_b.get(key)) if c]
        if not carried or count <= min(carried):
            continue
        text = next(
            (_label(e) for e in blend["today"] if _key(e.body_id, e.formation_id) == key), "?"
        )
        out.append(
            f"{text} {key[:13]}: {on_a.get(key, 0)} interval(s) on section A, "
            f"{on_b.get(key, 0)} on section B, {count} in the blend"
        )

    today_keys = {_key(e.body_id, e.formation_id) for e in blend["today"]}
    for label, entries in (("thin", thin), ("outside", outside)):
        lost = today_keys - {_key(e.body_id, e.formation_id) for e in entries}
        if lost:
            gone = sorted(
                {_label(e) for e in blend["today"] if _key(e.body_id, e.formation_id) in lost}
            )
            out.append(f"{label} removes {len(lost)} unit(s) from the column: {', '.join(gone)}")
    a_top = _label(blend["stack1"][0])
    b_top = _label(blend["stack2"][0])
    for label, entries in (("today", blend["today"]), ("thin", thin), ("outside", outside)):
        if entries and a_top == b_top and _label(entries[0]) != a_top:
            out.append(
                f"{label} puts {_label(entries[0])} at the column top; both sections "
                f"start with {a_top}"
            )
    hosts, _thickness, _visible = _intruders(blend)
    for label, entries in (("thin", thin), ("outside", outside)):
        still = [k for k, count in _runs(entries).items() if k in hosts and count > 1]
        if still:
            out.append(
                f"{label} leaves {len(still)} host(s) still split — by a body BOTH "
                "sections carry, which neither rule moves"
            )

    def _spans(entries: list[_Entry]) -> dict[str, tuple[float, float, str]]:
        """Each body's union span in a stack, as ``(top, base, label)``."""
        spans: dict[str, tuple[float, float, str]] = {}
        for entry in entries:
            key = _key(entry.body_id, entry.formation_id)
            top, base, _ = spans.get(key, (entry.top_elev, entry.base_elev, ""))
            spans[key] = (
                max(top, entry.top_elev),
                min(base, entry.base_elev),
                _label(entry),
            )
        return spans

    today_spans = _spans(blend["today"])
    for label, entries in (("thin", thin), ("outside", outside)):
        shifts = []
        for key, (top, base, text) in _spans(entries).items():
            if key not in today_spans:
                continue
            was_top, was_base, _ = today_spans[key]
            shifts.append((0.5 * ((top + base) - (was_top + was_base)), text))
        if not shifts:
            continue
        shift, text = max(shifts, key=lambda s: abs(s[0]))
        if abs(shift) >= 1.0:
            out.append(
                f"{label} moves {text} {'up' if shift > 0 else 'down'} by "
                f"{abs(shift):.2f} m — the largest displacement in this column"
            )
    return out


def _preservation(
    blend: dict[str, Any], thin: list[_Entry], outside: list[_Entry]
) -> dict[str, Any]:
    """Check both candidates kept the column's top and total thickness.

    Both are laid out by ``_layout`` from the SAME blended top, so the top is identical
    by construction; the total is identical iff the rewritten spec list sums to the same
    thickness.  This measures both rather than asserting them.

    Parameters
    ----------
    blend : dict
        A :func:`_blend_at` result.
    thin, outside : list of _Entry
        The two candidate stacks.

    Returns
    -------
    dict
        Per-arm top error and thickness error in metres.
    """

    def _extent(entries: list[_Entry]) -> tuple[float, float]:
        """Top elevation and summed thickness of a laid-out stack."""
        if not entries:
            return (float("nan"), 0.0)
        return (entries[0].top_elev, sum(_th(e) for e in entries))

    top0, sum0 = _extent(blend["today"])
    out = {}
    for label, entries in (("thin", thin), ("outside", outside)):
        top, total = _extent(entries)
        out[label] = {
            "topError_m": round(abs(top - top0), 9),
            "thicknessError_m": round(abs(total - sum0), 9),
        }
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    """Sweep the generation's grid, count the fragmentation, and write the cases."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stride", type=int, default=1, help="sweep every Nth grid column")
    parser.add_argument("--cases", type=int, default=8, help="how many worst cases to emit")
    parser.add_argument(
        "--out",
        type=Path,
        default=_REPO_ROOT / "blend_viewer" / "fragment.json",
        help="where to write the JSON",
    )
    args = parser.parse_args()

    print("\n=== FRAGMENTATION CASES — the blend vs the sections (#261, READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        generation = (
            (
                await session.execute(
                    select(LithoBuildGenerationOrm).order_by(
                        LithoBuildGenerationOrm.created_at.desc()
                    )
                )
            )
            .scalars()
            .first()
        )
        if generation is None:
            raise SystemExit("ABORT: no stored build generation — click Build once.")
        picks = await LithoLayerRepository(session).load_body_picks(generation.model_id)
        model = await session.get(GeologicalModelOrm, generation.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {generation.model_id} not found.")
        formation_rows = (
            await session.execute(
                select(
                    GeologicalFormationOrm.id,
                    GeologicalFormationOrm.name,
                    GeologicalFormationOrm.color,
                ).where(GeologicalFormationOrm.app_project_id == model.app_project_id)
            )
        ).all()
        section_rows = (
            await session.execute(
                select(
                    CrossSectionOrm.name,
                    CrossSectionOrm.start_x,
                    CrossSectionOrm.start_y,
                    CrossSectionOrm.end_x,
                    CrossSectionOrm.end_y,
                ).where(CrossSectionOrm.app_project_id == model.app_project_id)
            )
        ).all()

    names = {str(r.id): r.name for r in formation_rows}
    colours = {r.name: r.color for r in formation_rows if r.color}

    aliases = dict(generation.body_aliases or {})
    as_drawn = apply_body_aliases(_sections_from_payload(generation.payload), aliases)
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    sections, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)

    # Section names are not in the payload, so match each payload section to the section
    # the owner drew by its endpoints — the one field both sides carry unchanged.
    by_ends = {
        (round(r.start_x, 2), round(r.start_y, 2), round(r.end_x, 2), round(r.end_y, 2)): r.name
        for r in section_rows
    }
    labels: dict[int, str] = {}
    for index, section in enumerate(as_drawn):
        ends = (
            round(section.start_x, 2),
            round(section.start_y, 2),
            round(section.end_x, 2),
            round(section.end_y, 2),
        )
        if ends in by_ends:
            labels[index] = by_ends[ends]

    h = float(generation.horizontal_spacing_m)
    honor = float(generation.honor_radius_m)
    gx = np.arange(generation.grid_origin_x, generation.grid_origin_x + generation.grid_nx * h, h)[
        : generation.grid_nx
    ]
    gy = np.arange(generation.grid_origin_y, generation.grid_origin_y + generation.grid_ny * h, h)[
        : generation.grid_ny
    ]
    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )
    footprint_tol = 0.5 * h * math.sqrt(2.0)
    honored_cells = set()
    for inv in inv_columns:
        if inv.intervals:
            honored_cells.update(_honored_cells(gx, gy, inv.world_x, inv.world_y, honor))

    print(f"  generation {generation.id}  ({generation.created_at:%Y-%m-%d %H:%M})")
    print(
        f"  grid {generation.grid_nx}x{generation.grid_ny} at {h} m | honour {honor} m | "
        f"{len(sections)} sections | named {len(labels)}"
    )
    print(f"  sweeping every {args.stride} column(s)\n")

    started = time.perf_counter()
    swept = 0
    blended_columns = 0
    fragmenting = 0
    fragmenting_honored = 0
    strict_hits = 0
    intruded_columns = 0
    visible_columns = 0
    bodies_seen: set[str] = set()
    intruded_bodies: set[str] = set()
    worst_split = 0
    split_histogram: dict[tuple[int, int], int] = defaultdict(int)
    visible_histogram: dict[str, int] = defaultdict(int)
    thickness_total = 0.0
    candidates: list[tuple[float, float, float, float]] = []
    voxel_m = float(generation.vertical_spacing_m or generation.horizontal_spacing_m)

    for i in range(0, len(gx), args.stride):
        x = float(gx[i])
        for j in range(0, len(gy), args.stride):
            y = float(gy[j])
            if not domain.contains(x, y, tol=footprint_tol):
                continue
            swept += 1
            blend = _blend_at(sections, x, y)
            if blend is None:
                continue
            blended_columns += 1
            fragmented = _fragments(blend)
            hosts, moved, visible = _intruders(blend, voxel_m)
            if hosts:
                intruded_columns += 1
                intruded_bodies.update(hosts)
                thickness_total += moved
            if visible > 0.0:
                visible_columns += 1
                bucket = (
                    "0.25-0.5 m"
                    if visible < 0.5
                    else "0.5-1 m"
                    if visible < 1.0
                    else "1-2 m"
                    if visible < 2.0
                    else "over 2 m"
                )
                visible_histogram[bucket] += 1
            if not fragmented:
                continue
            fragmenting += 1
            if (i, j) in honored_cells:
                fragmenting_honored += 1
            strict_hits += len(_strictly_invented(blend))
            for key, on_section, in_blend in fragmented:
                bodies_seen.add(key)
                worst_split = max(worst_split, in_blend)
                split_histogram[(on_section, in_blend)] += 1
            severity = max(f[2] - f[1] for f in fragmented)
            candidates.append((float(severity), visible, x, y))

    elapsed = time.perf_counter() - started
    print(f"  swept {swept:,} in-footprint columns in {elapsed:.1f}s")
    print(f"    columns that take a blend at all      : {blended_columns:,}")
    print(
        f"    columns where the blend fragments     : {fragmenting:,}  "
        f"({100.0 * fragmenting / max(blended_columns, 1):.1f} % of blended)"
    )
    print(
        f"    of those, a log overrides part of it  : {fragmenting_honored:,} "
        "(honoured cells — the blend still shows above and below the log)"
    )
    print(f"    distinct bodies ever fragmented       : {len(bodies_seen)}")
    print(f"    worst split (intervals in the blend)  : {worst_split}")
    print(
        f"    columns with #261's own mechanism     : {intruded_columns:,}  "
        f"({100.0 * intruded_columns / max(blended_columns, 1):.1f} % of blended) — "
        "a ONE-SIDED unit laid out inside another body"
    )
    print(f"    bodies a one-sided unit sits inside   : {len(intruded_bodies)}")
    print(f"    thickness those intruding units carry : {thickness_total:,.0f} m (summed)")
    print(
        f"    ... of which the {voxel_m} m grid can RESOLVE: {visible_columns:,} columns  "
        f"({100.0 * visible_columns / max(blended_columns, 1):.1f} % of blended) — "
        "intruder and host both at least one voxel"
    )
    print(
        f"    STRICT test — more pieces than EITHER section shows: {strict_hits} "
        "(see the module docstring: it cannot happen, and does not)"
    )
    print("\n    on the section that shows fewest  ->  in the blend      columns")
    for (on_section, in_blend), count in sorted(split_histogram.items()):
        print(f"      {on_section:>3}  ->  {in_blend:<3}                              {count:,}")
    print("\n    thickest RESOLVABLE intrusion in the column        columns")
    for bucket in ("0.25-0.5 m", "0.5-1 m", "1-2 m", "over 2 m"):
        if visible_histogram.get(bucket):
            print(f"      {bucket:<20}                          {visible_histogram[bucket]:,}")

    # The named position, snapped to the grid node the sweep would have visited.
    named_x = float(gx[int(np.argmin(np.abs(gx - _NAMED_POINT[0])))])
    named_y = float(gy[int(np.argmin(np.abs(gy - _NAMED_POINT[1])))])

    # Pick the worst cases, spread out: neighbouring grid columns give near-identical
    # stacks, so without a separation rule eight cases would be one place eight times.
    # The named position seeds the list, so nothing lands on top of it either.
    candidates.sort(key=lambda c: (-c[0], -c[1]))
    picked: list[tuple[float, float]] = [(named_x, named_y)]
    for _severity, _moved, x, y in candidates:
        if all(math.hypot(x - px, y - py) >= _MIN_CASE_SEPARATION_M for px, py in picked):
            picked.append((x, y))
        if len(picked) > args.cases:
            break
    ordered = picked

    cases: list[dict[str, Any]] = []
    for x, y in ordered:
        blend = _blend_at(sections, x, y)
        if blend is None:
            print(f"\n  ! no blend at ({x:.0f}, {y:.0f}) — skipped")
            continue
        # Self-check: the rebuilt specs must lay out to the shipped blend exactly, or
        # every candidate below is being compared against the wrong baseline.
        shipped = _blend_stacks(
            blend["stack1"], blend["stack2"], blend["w1"], reach_to_evidence=True
        )
        if [(_key(e.body_id, e.formation_id), round(e.top_elev, 6)) for e in shipped] != [
            (_key(e.body_id, e.formation_id), round(e.top_elev, 6)) for e in blend["today"]
        ]:
            raise SystemExit(
                f"ABORT: the rebuilt spec list does not reproduce _blend_stacks at "
                f"({x:.1f}, {y:.1f}) — the harness is wrong, stop."
            )
        ci = int(np.argmin(np.abs(gx - x)))
        cj = int(np.argmin(np.abs(gy - y)))
        cases.append(
            _case_json(
                x,
                y,
                blend,
                names,
                labels,
                named=(x, y) == (named_x, named_y),
                honored=(ci, cj) in honored_cells,
                in_footprint=domain.contains(x, y, tol=footprint_tol),
            )
        )

    # Only the lithologies the cases actually draw.  The formation table is project-wide
    # (it holds the geological and geotechnical models too), and a legend listing
    # formations no case shows would invite the reader to look for them.
    shown = {
        entry["formation"]
        for case in cases
        for stack in (case["today"], case["thin"], case["outside"])
        for entry in stack
    }
    shown.update(
        entry["formation"]
        for case in cases
        for side in ("sectionA", "sectionB")
        for entry in case[side]["entries"]
    )

    payload = {
        "cases": cases,
        "stats": {
            "columnsSwept": swept,
            "columnsBlended": blended_columns,
            "columnsFragmenting": fragmenting,
            "columnsFragmentingHonored": fragmenting_honored,
            "columnsOneSidedIntrusion": intruded_columns,
            "columnsResolvableAtVoxel": visible_columns,
            "voxelHeight_m": voxel_m,
            "bodiesEverFragmented": len(bodies_seen),
            "bodiesOneSidedIntruded": len(intruded_bodies),
            "worstSplit": worst_split,
            "strictlyInvented": strict_hits,
            "intrudingThickness_m": round(thickness_total, 3),
            "stride": args.stride,
            "gridSpacing_m": h,
            "generation": str(generation.id),
        },
        "formationColours": {k: v for k, v in colours.items() if k in shown},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"\n  wrote {len(cases)} case(s) to {args.out}")

    # The named case, printed, so the run itself carries the evidence.
    for case in cases:
        if not case["named"]:
            continue
        print(
            f"\n  --- the named position ({case['x']:.0f}, {case['y']:.0f}) --- "
            f"w1={case['w1']:.3f} on {case['sectionA']['name']} "
            f"({case['sectionA']['distance_m']} m) vs {case['sectionB']['name']} "
            f"({case['sectionB']['distance_m']} m)"
        )
        for label, key in (
            ("section A", "sectionA"),
            ("section B", "sectionB"),
        ):
            print(f"    {label} — {len(case[key]['entries'])} entries")
            for e in case[key]["entries"]:
                print(f"        {e['formation']:<6} {e['top']:>8.3f} / {e['base']:<8.3f}")
        for label in ("today", "thin", "outside"):
            entries = case["today"] if label == "today" else case["candidates"][label]
            print(f"    {label} — {len(entries)} entries")
            for e in entries:
                print(f"        {e['formation']:<6} {e['top']:>8.3f} / {e['base']:<8.3f}")
        for f in case["fragmented"]:
            print(
                f"    fragmented {f['body'][:13]}: {f['onSection']} interval(s) on a "
                f"section, {f['inBlend']} in the blend"
            )
        print(f"    preserved: {case['preserved']}")
        for note in case["notes"]:
            print(f"    ! {note}")

    # Every case's failure modes, so the run itself carries what the owner must weigh.
    print("\n  --- what the candidates do, case by case ---")
    for case in cases:
        tag = " (named)" if case["named"] else ""
        print(f"    ({case['x']:.0f}, {case['y']:.0f}){tag}")
        print(
            f"        {case['sectionA']['name']} ({case['sectionA']['distance_m']} m, "
            f"w={case['w1']:.2f}) vs {case['sectionB']['name']} "
            f"({case['sectionB']['distance_m']} m)"
        )
        print(
            f"        entries  A {len(case['sectionA']['entries'])} / "
            f"B {len(case['sectionB']['entries'])}  ->  today {len(case['today'])}, "
            f"thin {len(case['candidates']['thin'])}, "
            f"outside {len(case['candidates']['outside'])}"
        )
        for f in case["fragmented"]:
            print(f"        {f['body'][:13]}  {f['onSection']} -> {f['inBlend']}")
        for note in case["notes"]:
            print(f"        ! {note}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
