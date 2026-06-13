"""Stage 1 of the implicit stratigraphic field builder: establish the global stratigraphic order.

This module is purely functional — no I/O, no logging, no framework dependencies.
It consumes per-investigation unit sequences (each ordered top → bottom) and derives
a single globally-consistent :class:`~groundmodel.domain.services.strat_field.strat_types.\
StratColumn` by topologically sorting a directed acyclic graph of ``instance_key``
precedence edges.

Why a topo-sort (graphlib)?
    Stratigraphic order is a partial order: within each borehole/CPT column, unit A lies
    above unit B, which implies A is geologically younger.  When the same bodies appear
    across multiple investigations they add edges to a shared DAG; the topo-sort finds a
    single consistent total order.  Any cycle in the DAG signals a non-conformable
    boundary (fault or unconformity) that the v1 solver cannot handle — it is reported as
    :class:`NonConformableError` so the engineer can fix the data rather than receiving
    a silently incorrect model.

Why iso_value = float(rank)?
    The implicit-field solver (Stage 3) needs strictly monotonically increasing scalar
    values to associate each horizon with a distinct iso-surface.  Even integer spacing
    is the simplest valid assignment; re-scaling to physical depth or curvature-adjusted
    values is a Stage 3 concern, not a Stage 1 concern.

Why walk the SORTED INSTANCE ORDER instead of the raw column edges when emitting horizons?
    The DAG may contain redundant edges (e.g. a direct ZAND→KLEI edge alongside a
    ZAND→SILT→KLEI chain).  Emitting one horizon per consecutive pair in the topo order
    (not one horizon per raw edge) gives exactly N+1 horizons for N instances, irrespective
    of how many edges link non-adjacent instances in the graph.
"""

from __future__ import annotations

import graphlib
from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.strat_field.strat_types import Horizon, StratColumn

# ---------------------------------------------------------------------------
# Public input contract
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OrderInputUnit:
    """A single stratigraphic unit from one investigation column.

    The ``instance_key`` is the body-resolver identity that ties the same
    physical unit across multiple investigations.  ``formation_id`` is the
    lithology (one formation per soil code in the current data model).
    ``contact_id`` is the ``formation_contact.id`` of the contact at the TOP
    of this unit — it becomes the constraint that controls the horizon above
    the unit in the output :class:`StratColumn`.

    Parameters
    ----------
    instance_key : str
        Resolver body identity — globally unique per stratigraphic instance.
        All occurrences of the same physical unit across different
        investigations share the same ``instance_key``.
    formation_id : str
        Lithology identifier (``GeologicalFormation.id`` or equivalent).
        All occurrences of a given ``instance_key`` MUST share the same
        ``formation_id``; a mismatch raises :class:`ValueError`.
    contact_id : str
        ``formation_contact.id`` of the contact at the TOP of this unit.
        Collected into the ``contact_ids`` field of the
        :class:`~groundmodel.domain.services.strat_field.strat_types.Horizon`
        that separates the unit above from this unit.
    """

    instance_key: str
    formation_id: str
    contact_id: str


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class NonConformableError(Exception):
    """Raised when the stratigraphic order across columns contains a directed cycle.

    A cycle means two or more columns place the same pair of stratigraphic
    instances in opposite order — the geological signature of a fault,
    unconformity, or misidentified body.  The v1 implicit-field builder
    cannot model non-conformable boundaries; the engineer must resolve the
    contradiction in the source data before building the model.

    The exception message names the offending formation_ids so the engineer
    can locate the problematic units without reading source code.

    Parameters
    ----------
    message : str
        Human-readable description that includes the formation_ids of every
        instance participating in the cycle.

    Examples
    --------
    >>> raise NonConformableError("Cycle detected between SAND and CLAY")
    NonConformableError: Cycle detected between SAND and CLAY
    """


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def build_stratigraphic_order(
    columns: Sequence[Sequence[OrderInputUnit]],
) -> StratColumn:
    """Derive the global stratigraphic column from per-investigation unit sequences.

    Each column is a sequence of :class:`OrderInputUnit` objects ordered
    top → bottom (youngest → oldest).  Consecutive units within a column
    contribute a directed edge ``unit[i].instance_key → unit[i+1].instance_key``
    to a shared DAG that encodes "above / below" precedence.  A topological sort
    of the DAG then gives a single globally-consistent instance order, from which
    N+1 :class:`~groundmodel.domain.services.strat_field.strat_types.Horizon`
    objects are emitted for N ordered instances.

    Parameters
    ----------
    columns : Sequence of Sequence of OrderInputUnit
        One inner sequence per investigation location, each ordered top (index 0)
        to bottom (last index).  A single-investigation, single-unit column is
        valid but produces no internal horizons.

    Returns
    -------
    StratColumn
        A :class:`~groundmodel.domain.services.strat_field.strat_types.StratColumn`
        whose ``horizons`` tuple is ordered top-down (ascending rank).  Horizons
        are indexed 0 (surface) through N (floor), where N equals the number of
        distinct stratigraphic instances.

    Raises
    ------
    ValueError
        If the same ``instance_key`` maps to two different ``formation_id`` values
        across the input columns.  The message contains the substring ``instance_key``
        so callers can identify this error class programmatically.
    NonConformableError
        If the aggregate DAG contains a directed cycle (a non-conformable boundary,
        fault, or unconformity).  The message names every ``formation_id`` involved
        in the cycle to help the engineer locate the conflicting data.
    """
    # ------------------------------------------------------------------
    # Step 1: collect formation_id and contact_ids per instance_key.
    #
    # Each instance_key must map to exactly ONE formation_id (invariant:
    # the same physical body cannot be two different lithologies).  We
    # accumulate contact_ids as a list so multiple investigations that
    # pick up the same body all contribute their top-contact id.
    # ------------------------------------------------------------------
    formation_by_key: dict[str, str] = {}
    contacts_by_key: dict[str, list[str]] = {}

    for column in columns:
        for unit in column:
            key = unit.instance_key
            if key in formation_by_key:
                if formation_by_key[key] != unit.formation_id:
                    raise ValueError(
                        f"instance_key {key!r} maps to two different formation_ids: "
                        f"{formation_by_key[key]!r} and {unit.formation_id!r}"
                    )
            else:
                formation_by_key[key] = unit.formation_id
                contacts_by_key[key] = []
            contacts_by_key[key].append(unit.contact_id)

    # ------------------------------------------------------------------
    # Step 2: build the precedence DAG.
    #
    # For each consecutive pair (unit[i], unit[i+1]) in a column we add
    # an edge unit[i].instance_key → unit[i+1].instance_key ("above →
    # below").  We track edges as a set to avoid double-counting repeated
    # observations of the same pair across columns.
    #
    # We feed predecessors to graphlib.TopologicalSorter in SORTED order
    # so that ties in the topological traversal are broken deterministically
    # (the stdlib traversal order is insertion-order for the predecessor
    # dict, so sorting at input time gives a reproducible static_order).
    # ------------------------------------------------------------------
    predecessors: dict[str, set[str]] = {key: set() for key in formation_by_key}

    for column in columns:
        for i in range(len(column) - 1):
            above_key = column[i].instance_key
            below_key = column[i + 1].instance_key
            predecessors[below_key].add(above_key)

    # Build sorter with predecessors in sorted order for determinism.
    sorter = graphlib.TopologicalSorter(
        {key: sorted(preds) for key, preds in sorted(predecessors.items())}
    )

    try:
        # static_order() returns an iterator over all nodes in a valid
        # topological order (does not require calling prepare() first).
        ordered_keys: list[str] = list(sorter.static_order())
    except graphlib.CycleError as exc:
        # exc.args[1] is the list of nodes that form the cycle.
        cycle_nodes: list[str] = list(exc.args[1]) if len(exc.args) > 1 else []
        cycle_formations = sorted(
            {formation_by_key[k] for k in cycle_nodes if k in formation_by_key}
        )
        raise NonConformableError(
            f"Non-conformable boundary detected: stratigraphic order forms a cycle "
            f"involving instance_keys {cycle_nodes!r} "
            f"(formations: {', '.join(cycle_formations)})"
        ) from exc

    # ------------------------------------------------------------------
    # Step 3: emit N+1 horizons from the N ordered instances.
    #
    # Horizons come from consecutive pairs in the sorted instance list —
    # NOT from the raw DAG edges — so we always get exactly N+1 horizons
    # regardless of how many redundant edges exist in the DAG (e.g. a
    # direct ZAND→KLEI edge alongside a ZAND→SILT→KLEI chain still
    # produces exactly 4 horizons for 3 instances).
    #
    # Horizon layout (N instances → N+1 horizons):
    #   rank 0       SURFACE  : above=None,           below=formation[0]
    #   rank 1..N-1  INTERNAL : above=formation[i-1], below=formation[i]
    #   rank N       FLOOR    : above=formation[N-1], below=None
    #
    # contact_ids for a horizon at rank r:
    #   r == 0 (surface): contact_ids of the topmost instance (its top contact).
    #   r == 1..N-1      : contact_ids of instance at ordered_keys[r] (the unit
    #                      whose top IS this interface).
    #   r == N (floor)   : empty tuple (no contact marks the open base).
    # ------------------------------------------------------------------
    n = len(ordered_keys)
    horizons: list[Horizon] = []

    for rank in range(n + 1):
        if rank == 0:
            # Surface: the top of the shallowest instance.
            above_formation = None
            below_formation = formation_by_key[ordered_keys[0]]
            # The top-contact of the shallowest instance constrains the surface.
            contact_ids = tuple(contacts_by_key[ordered_keys[0]])
        elif rank == n:
            # Floor: open base below the deepest instance.
            above_formation = formation_by_key[ordered_keys[-1]]
            below_formation = None
            contact_ids = ()
        else:
            # Internal horizon between instance at rank-1 (above) and rank (below).
            above_formation = formation_by_key[ordered_keys[rank - 1]]
            below_key = ordered_keys[rank]
            below_formation = formation_by_key[below_key]
            # The contact at the TOP of the "below" instance IS this interface.
            contact_ids = tuple(contacts_by_key[below_key])

        horizons.append(
            Horizon(
                rank=rank,
                iso_value=float(rank),
                above_formation=above_formation,
                below_formation=below_formation,
                contact_ids=contact_ids,
            )
        )

    return StratColumn(horizons=tuple(horizons))
