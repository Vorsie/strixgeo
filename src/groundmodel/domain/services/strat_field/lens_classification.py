"""Shared enclosure classifier: split stratigraphic bodies into matrix vs lens.

This module is purely functional — no I/O, no logging, no framework dependencies.
It consumes the SAME per-investigation columns Stage 1 consumes
(:class:`~groundmodel.domain.services.strat_field.stratigraphic_order.OrderInputUnit`
sequences, each ordered top → bottom) and produces a
:class:`~groundmodel.domain.services.strat_field.lens_types.LensPartition`.

Why this exists
---------------
On real data (``test.strix``) the body resolver over-merges a recurring lithology
into ONE body that one borehole records both ABOVE and BELOW the same minority
unit (KLEI / SILT / KLEI under a single shared ``instance_key``).  A single global
iso-order needs ONE monotone position per body, so that self-enclosure is a
directed cycle: Stage 1's topo-sort correctly raises ``NonConformableError`` and
nothing builds.  The fix is to recognise the enclosed minority as a LENS, order
only the conformable MATRIX backbone, and carve the lens back in afterwards.

The enclosure criterion (the over-merge identity)
-------------------------------------------------
A unit ``mid`` is enclosed when, in some column, the unit directly above it and
the unit directly below it are the SAME body (``above.instance_key ==
below.instance_key != mid.instance_key``).  The criterion is resolver-body
IDENTITY, not lithology — that is what makes it different from the 2-D
render-side helper ``plan_enclosed_lens_merges`` (which brackets by lithology
soil code with an extra neighbour-absence guard).  See the module-level note in
``plan_enclosed_lens_merges.py``; the two criteria genuinely differ, so no shared
predicate is extracted (CLAUDE.md "extract on the second copy" — these are not
the same copy).

Why this is NOT the true-reversal case
--------------------------------------
A genuine A-over-B / B-over-A interfingering reversal across two different columns
has NO host-minority-host sandwich in either column, so it is never classified as
a lens.  The reversal stays in the matrix; Stage 1 still surfaces it as a cycle.
That is deliberate — the v1 builder cannot model true interfingering, and silently
classifying it as a lens would hide a modelling decision the engineer must make.
"""

from __future__ import annotations

import graphlib
from collections.abc import Sequence

from groundmodel.domain.services.strat_field.lens_types import Lens, LensPartition
from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit


class LensClassificationError(Exception):
    """Raised when removing the classified lenses still leaves a cyclic matrix.

    A correct classification must leave a conformable (acyclic) matrix backbone:
    every directed cycle in the column precedence graph is the signature of an
    enclosed lens, so once all lenses are carved out the remaining matrix must
    topo-sort.  A residual cycle means the cycle came from a case the enclosure
    criterion does NOT cover — a TRUE interfingering reversal (A-over-B in one
    column, B-over-A in another, with no host-minority-host sandwich).  This is
    surfaced rather than silently forced: the v1 single-field builder cannot
    model true interfingering, so the engineer must resolve it in the source
    data.  The message names the offending ``instance_key`` values.
    """


def _scan_brackets(
    columns: Sequence[Sequence[OrderInputUnit]],
    is_lens: set[str],
) -> dict[str, list[str]]:
    """Scan one pass, returning ``mid_key -> [bracketing_host_key, ...]``.

    A unit ``mid`` is enclosed when the units directly above and below it share
    one ``instance_key`` that differs from ``mid``'s
    (``above.instance_key == below.instance_key != mid.instance_key``).  Bodies
    already classified as lenses are COLLAPSED OUT of each column first, so the
    next pass scans the INNERMOST remaining minorities: once the inner lens
    vanishes, the two occurrences of its host become adjacent to the deeper
    minority and the bracket reads against that host.  This is what makes the
    fixpoint discover enclosures from the inside out.
    """
    brackets: dict[str, list[str]] = {}
    for column in columns:
        # Drop already-classified lenses, then collapse any runs of the same
        # body that this leaves adjacent.  Dropping an inner lens makes its two
        # host occurrences neighbours (e.g. KLEI/SILT/ZAND/SILT/KLEI with ZAND
        # removed → KLEI/SILT/SILT/KLEI); deduping the consecutive SILTs yields
        # KLEI/SILT/KLEI so the next-level enclosure (SILT inside KLEI) becomes
        # a detectable triple.  We carry the raw key (instance_key) only.
        keys: list[str] = []
        for unit in column:
            if unit.instance_key in is_lens:
                continue
            if keys and keys[-1] == unit.instance_key:
                continue
            keys.append(unit.instance_key)
        for a, m, b in zip(keys, keys[1:], keys[2:], strict=False):
            if a == b != m:
                brackets.setdefault(m, []).append(a)
    return brackets


def classify_lenses(columns: Sequence[Sequence[OrderInputUnit]]) -> LensPartition:
    """Split all bodies into a conformable matrix backbone plus enclosed lenses.

    A body is an enclosed LENS when, in some column, it is bracketed directly
    above AND below by the SAME other body (the host).  Classification iterates
    to a fixpoint so a lens nested inside a lens is found one level deeper than
    its host.  Everything not classified as a lens is the matrix backbone.

    Parameters
    ----------
    columns : Sequence of Sequence of OrderInputUnit
        One inner sequence per investigation, each ordered top (index 0) to
        bottom (last index) — the SAME input Stage 1 consumes.

    Returns
    -------
    LensPartition
        ``matrix_body_ids`` is every body NOT classified as a lens;
        ``lenses`` is each enclosed lens (deterministic order: ascending
        nesting depth, then ascending ``body_id``).

    Raises
    ------
    LensClassificationError
        If at least one lens was classified yet the matrix backbone STILL
        contains a directed cycle — the classification failed to break every
        cycle, which should not happen for an enclosed-lens case.  When NO lens
        is found, a residual cycle is a true interfingering reversal that this
        criterion does not cover: the function returns cleanly (``lenses == ()``)
        and leaves the cycle for Stage 1 to surface as a
        :class:`~groundmodel.domain.services.strat_field.stratigraphic_order.\
NonConformableError`.
    """
    all_keys: set[str] = {u.instance_key for column in columns for u in column}

    # ------------------------------------------------------------------
    # Fixpoint, discovering enclosures FROM THE INSIDE OUT.
    #
    # Each pass scans the columns with the already-found lenses collapsed out,
    # so the innermost remaining minority is found first.  In a nested stack
    # KLEI/SILT/ZAND/SILT/KLEI the first pass sees only (SILT,ZAND,SILT) →
    # ZAND's immediate host is SILT; collapsing ZAND makes the two SILTs flank
    # the KLEIs, so the next pass sees (KLEI,SILT,KLEI) → SILT's host is KLEI.
    # We record each lens's IMMEDIATE host here; nesting_depth is derived from
    # the host chain afterwards (a lens whose host is matrix = depth 1; a lens
    # whose host is a depth-d lens = depth d+1).
    #
    # The loop terminates because each pass that finds anything adds ≥1 body to
    # the finite ``is_lens`` set (strictly shrinking the unclassified set); a
    # pass that finds nothing breaks.
    # ------------------------------------------------------------------
    is_lens: set[str] = set()
    host_of_lens: dict[str, str] = {}

    while True:
        new_brackets = {
            k: v for k, v in _scan_brackets(columns, is_lens).items() if k not in is_lens
        }
        if not new_brackets:
            break
        for lens_key, hosts in sorted(new_brackets.items()):
            # Tie rule (deterministic for checksum / bundle replay): pick the
            # most frequent bracketing host; on a count tie, the lexicographically
            # smallest host_body_id.  The (-count, host) key gives "highest count
            # first, then smallest id" in one stable ordering.
            host = min(set(hosts), key=lambda h: (-hosts.count(h), h))
            is_lens.add(lens_key)
            host_of_lens[lens_key] = host

    matrix_body_ids = frozenset(all_keys - is_lens)

    # nesting_depth: walk each lens's immediate-host chain until a matrix body.
    # A lens directly inside a matrix body is depth 1; a lens inside a depth-d
    # lens is depth d+1.  The chain is finite and acyclic (each step moves to a
    # body found on an earlier pass), so the walk terminates.
    depth_of_lens: dict[str, int] = {}

    def _depth(key: str) -> int:
        # Walk the immediate-host chain iteratively, guarding against a cyclic
        # chain (mutually-enclosing bodies from a malformed input) with a visited
        # set.  A valid chain is acyclic and ends at a matrix body; a cycle would
        # otherwise recurse forever → RecursionError.  Surfacing it as a
        # LensClassificationError that names the offending bodies is the
        # actionable failure.
        chain: list[str] = []
        seen: set[str] = set()
        cur = key
        while cur not in matrix_body_ids:
            if cur in depth_of_lens:
                break
            if cur in seen:
                raise LensClassificationError(
                    "cyclic host chain among lens instance_keys "
                    f"{sorted(seen | {cur})!r} — a body's enclosing-host chain "
                    "loops back on itself (mutually-enclosing bodies), which is a "
                    "malformed classification that cannot be assigned a finite "
                    "nesting depth"
                )
            seen.add(cur)
            chain.append(cur)
            cur = host_of_lens[cur]
        # ``cur`` is now either a matrix body (depth-0 anchor) or a lens whose
        # depth is already memoised; unwind the visited chain deepest-host first.
        base = depth_of_lens[cur] if cur in depth_of_lens else 0
        for offset, link in enumerate(reversed(chain), start=1):
            depth_of_lens[link] = base + offset
        return depth_of_lens[key]

    for key in is_lens:
        _depth(key)

    # ------------------------------------------------------------------
    # Cross-check: once the lenses are carved out, the matrix backbone MUST be
    # acyclic.  If lenses WERE found yet a cycle remains, the classification is
    # wrong (it didn't break every cycle) → raise.  If NO lens was found, a
    # residual cycle is a TRUE interfingering reversal that this criterion does
    # not cover — return cleanly (lenses == ()) and let Stage 1 surface it as a
    # NonConformableError.  Uses graphlib (same as Stage 1) for consistency.
    # ------------------------------------------------------------------
    predecessors: dict[str, set[str]] = {key: set() for key in matrix_body_ids}
    for column in columns:
        matrix_units = [u for u in column if u.instance_key in matrix_body_ids]
        for above, below in zip(matrix_units, matrix_units[1:], strict=False):
            if above.instance_key != below.instance_key:
                predecessors[below.instance_key].add(above.instance_key)
    sorter = graphlib.TopologicalSorter(predecessors)
    try:
        sorter.prepare()
    except graphlib.CycleError as exc:
        if is_lens:
            cycle_nodes = list(exc.args[1]) if len(exc.args) > 1 else []
            raise LensClassificationError(
                "matrix backbone still cyclic after carving "
                f"{len(is_lens)} lens(es); cycle involves instance_keys "
                f"{cycle_nodes!r} — the enclosure criterion did not break every "
                "cycle, which should not happen for an enclosed-lens case"
            ) from exc
        # No lens found: the cycle is genuine non-conformability — leave it for
        # Stage 1.  Fall through to return an all-matrix, no-lens partition.

    lenses = tuple(
        Lens(
            body_id=key,
            host_body_id=host_of_lens[key],
            nesting_depth=depth_of_lens[key],
        )
        for key in sorted(is_lens, key=lambda k: (depth_of_lens[k], k))
    )
    return LensPartition(matrix_body_ids=matrix_body_ids, lenses=lenses)
