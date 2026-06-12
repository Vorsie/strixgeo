"""Section-partition fill — faithful Python port of ``partitionFill.ts``.

True-partition fill between adjacent litho columns: ``compute_section_fill``
resolves a whole section (columns left→right) into ``SectionRegion`` polygons
in (fraction, elevation) space, exactly mirroring the TypeScript
``computeSectionFill`` pipeline (the 2D section defines the 3D geological
model — any overlap or gap in 2D becomes one in 3D).

The pipeline (owner's contact-correlation model, 2026-06-09): a unit's shape
toward a neighbour is decided purely by how many of its TWO bounding contacts
are correlated to that neighbour — 2 → BAND, 1 → ONLAP, 0 → LENS.  Per gap,
fresh copies of the two columns are reduced (``_reduce_column`` pulls the
0-correlation lenses and merges the matrix around them), collapsed
(``_collapse_adjacent_same_formation``), then ``_emit_gap`` matches the
columns (``match_columns``), walks the matched-quad intervals, tiles the
pinches, appends the lens/onlap overlays, and carves them out of their matrix
(``_carve_overlays``) so the gap is a TRUE volumetric partition.

Parity is the contract: this module is a MECHANICAL function-by-function
transcription of ``desktop/src/renderer/src/utils/partitionFill.ts`` (TS names
snake_cased; TS-private helpers get a ``_`` prefix), pinned by the golden
fixtures in ``tests/unit/fixtures/partition_goldens/``.  Do not "improve"
logic, deduplicate near-identical left/right builders, or normalise outputs —
fix divergences in the port, never the fixtures.

``PartitionUnit``, ``PartitionRegion``, and ``_PinchUnit`` are intentionally
**mutable** (not frozen) because the pipeline deep-copies its inputs and then
mutates the copies in place — the same pattern as the TS pipeline.  The other
dataclasses are frozen (value types).

Pure module — no I/O, no logging, no SQLAlchemy, no numpy.  Domain layer only.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Literal

__all__ = [
    "EPS",
    "FRAC_EPS",
    "INTERIOR_PINCH_FRACTION",
    "LENS_PINCH_FRACTION",
    "SPAN_EPS",
    "ContactTermination",
    "Correlated",
    "CorrelationEdge",
    "LensApexOverride",
    "MatchUnit",
    "OverlayTier",
    "PartitionColumn",
    "PartitionPoint",
    "PartitionRegion",
    "PartitionUnit",
    "RegionKind",
    "SectionRegion",
    "classify_termination",
    "compute_section_fill",
    "lens_apex_override_key",
    "match_columns",
]

# Floating-point epsilon used for overlap comparisons — mirrors ``const EPS = 1e-9``
# in partitionFill.ts.  A pair of elevations whose difference is smaller than this
# is treated as non-overlapping (touching edges do not constitute overlap).
# Tolerance guide for consumers: use ``EPS`` for elevation/depth comparisons,
# ``FRAC_EPS`` for fraction-axis (0..1 gap-local) comparisons, and ``SPAN_EPS``
# for polygon span-containment checks (see the carve pipeline) — the same split
# the TS file uses.
EPS: float = 1e-9


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class PartitionUnit:
    """One accepted litho layer on a column, in depth-below-surface metres.

    Intentionally **mutable** (not frozen): ``compute_section_fill`` deep-copies
    the input columns, then ``reduce_column`` and ``collapse_adjacent_same_formation``
    mutate those copies in place — the same pattern as the TypeScript pipeline.

    Parameters
    ----------
    top_depth_m : float
        Depth below surface of the unit's top contact (metres, positive down).
    base_depth_m : float
        Depth below surface of the unit's base contact (metres, positive down).
    formation_id : str
        Drives the fill colour (lithology).
    body_id : str | None
        Resolver-stamped body — kept for region identity only; NOT used for
        matching because the resolver over-lumps body_id across lithologies/beds.
        Matching uses explicit correlation edges via ``layer_id``.
    layer_id : str
        The ``litho_layer.id`` — the stable identity a correlation edge references.
        Two units BAND iff an approved ``LithoContactCorrelationEdge`` connects
        their ``layer_id``s.
    """

    top_depth_m: float
    base_depth_m: float
    formation_id: str
    body_id: str | None
    layer_id: str


@dataclass(frozen=True)
class PartitionColumn:
    """One column's placement and its gap-free unit stack.

    Deliberately carries NO along-section position: the TS interface has none
    (regions live in gap-local fraction space), and parity with the TS shape is
    the contract.  The along ↔ fraction mapping the loft needs belongs to the
    ``SectionInput`` wrapper (loft_field), which pairs these columns with their
    along positions.

    Parameters
    ----------
    investigation_id : str
        The investigation this column belongs to.
    surface_elev_m : float
        Surface elevation (mTAW) — converts depth → absolute elevation.
    units : tuple[PartitionUnit, ...]
        Unit stack sorted shallow → deep (ascending ``top_depth_m``).
    """

    investigation_id: str
    surface_elev_m: float
    units: tuple[PartitionUnit, ...]


@dataclass(frozen=True)
class CorrelationEdge:
    """An approved correlation edge — a pair of ``litho_layer`` ids.

    Two units BAND across a gap iff an approved ``LithoContactCorrelationEdge``
    connects their ``layer_id``s.  This is the trustworthy band signal (vs the
    resolver's over-lumped ``body_id``).

    Parameters
    ----------
    a : str
        One ``litho_layer.id`` endpoint of the edge.
    b : str
        The other ``litho_layer.id`` endpoint of the edge.
    """

    a: str
    b: str


@dataclass(frozen=True)
class MatchUnit:
    """A unit prepared for cross-column matching, elevations pre-computed (mTAW).

    Parameters
    ----------
    formation_id : str
        Lithology — lithology must agree for any pairing to be considered.
    layer_id : str
        ``litho_layer.id`` — what correlation edges reference (the band signal).
    top_elev : float
        Higher elevation — the unit's top (mTAW, positive up).
    base_elev : float
        Lower elevation — the unit's base (mTAW, positive up).
    """

    formation_id: str
    layer_id: str
    top_elev: float
    base_elev: float


# Type alias mirrors the TS ``Correlated`` type.
Correlated = Callable[[str, str], bool]

# ContactTermination mirrors the TS union type; Literal lets mypy catch a
# misspelled termination string at the call site instead of at runtime.
ContactTermination = Literal["band", "onlap", "lens"]


# ---------------------------------------------------------------------------
# classify_termination
# ---------------------------------------------------------------------------


def classify_termination(
    units: list[PartitionUnit] | tuple[PartitionUnit, ...],
    index: int,
    neighbour_layer_ids: frozenset[str] | set[str],
    correlated: Correlated,
    correlated_to_neighbour: frozenset[str] | set[str] | None = None,
) -> ContactTermination:
    """Classify a unit's termination toward a single neighbour column.

    A unit is bounded by a TOP contact and a BASE contact.  A contact correlates
    to the neighbour iff an approved edge connects the relevant layer to any layer
    on that neighbour:

      - **top** contact  — an edge on THIS unit's ``layer_id`` (a layer's id keys
        the contact at its top, matching ``LithoContactCorrelationEdge``).
      - **base** contact — an edge on the layer immediately BELOW (its top contact
        IS this unit's base).  The deepest unit has no unit below, so its base
        cannot correlate (counts as uncorrelated).

    The count (0 / 1 / 2) maps directly: 0 → lens, 1 → onlap, 2 → band.
    This is per-SIDE: pass the facing neighbour's layer ids, so the same unit
    can band toward one neighbour and pinch toward the other.

    Parameters
    ----------
    units : list[PartitionUnit] | tuple[PartitionUnit, ...]
        The unit's column, sorted shallow → deep.
    index : int
        The unit's position in ``units``.
    neighbour_layer_ids : frozenset[str] | set[str]
        Every ``layer_id`` on the facing neighbour column.
    correlated : Correlated
        Approved-edge lookup between two ``layer_id``s.
    correlated_to_neighbour : frozenset[str] | set[str] | None, optional
        Pre-computed set of layer ids (on this column) that have at least one
        approved edge to any layer on the neighbour.  When provided this is a
        pure O(1) ``in`` check; when absent the function falls back to scanning
        ``neighbour_layer_ids`` via ``correlated``.  Both paths return the same
        result — this is a hot-loop optimisation used by ``reduce_column``.

    Returns
    -------
    ContactTermination
        ``'band'`` (2 contacts correlated), ``'onlap'`` (1), or ``'lens'`` (0).

    Raises
    ------
    IndexError
        If ``index`` is not a valid position in ``units``.
    """
    # When the caller pre-computed which layer ids are correlated to any neighbour
    # (a hot-loop optimisation — see reduce_column), this is a set lookup; else we
    # fall back to scanning neighbour_layer_ids.  Same result either way.
    if correlated_to_neighbour is not None:

        def contact_correlated(layer_id: str) -> bool:
            return layer_id in correlated_to_neighbour
    else:

        def contact_correlated(layer_id: str) -> bool:
            return any(correlated(layer_id, v) for v in neighbour_layer_ids)

    below = units[index + 1] if index + 1 < len(units) else None
    top_corr = contact_correlated(units[index].layer_id)
    # The deepest unit has no unit below — its base can never correlate.
    base_corr = below is not None and contact_correlated(below.layer_id)
    count = (1 if top_corr else 0) + (1 if base_corr else 0)
    if count == 2:
        return "band"
    if count == 1:
        return "onlap"
    return "lens"


# ---------------------------------------------------------------------------
# match_columns — private helper
# ---------------------------------------------------------------------------


def _pair_score(left: MatchUnit, right: MatchUnit, correlated: Correlated) -> int:
    """Score a candidate cross-column pairing — edges first, geometry as fallback.

    Lithology must agree (never pair across lithology).  An explicit correlation
    edge is the authoritative BAND signal — it connects layers at ANY elevation
    (a correlated bed that dips between columns, e.g. a peat layer).  Geometric
    overlap (no edge) is the last-resort fill tier for the matrix:

      same litho + edge + overlap  → 4  (explicit correlation, aligned)
      same litho + edge            → 3  (explicit correlation — dipping correlated bed)
      same litho + overlap (no edge) → 1  (geometry — matrix coverage fill only)
      otherwise                    → 0  (no match → pinches out)

    ``body_id`` is deliberately NOT used — it is the resolver's over-lumped
    transitive closure (one body spanning several lithologies/beds), which falsely
    banded uncorrelated beds.  Only the direct edges are trusted.

    Parameters
    ----------
    left : MatchUnit
        Unit from the left column.
    right : MatchUnit
        Unit from the right column.
    correlated : Correlated
        Approved-edge lookup between two ``layer_id``s.

    Returns
    -------
    int
        Pair score (0, 1, 3, or 4).
    """
    if left.formation_id != right.formation_id:
        return 0
    # Elevation overlap: strictly greater than EPS to exclude mere touching edges.
    overlap = left.top_elev > right.base_elev + EPS and right.top_elev > left.base_elev + EPS
    edge = correlated(left.layer_id, right.layer_id)
    if edge and overlap:
        return 4
    if edge:
        return 3
    if overlap:
        return 1
    return 0


# ---------------------------------------------------------------------------
# match_columns
# ---------------------------------------------------------------------------


def match_columns(
    left: list[MatchUnit],
    right: list[MatchUnit],
    correlated: Correlated,
) -> list[tuple[int, int]]:
    """Monotonic (order-preserving) cross-column matching.

    Edge-correlated pairs band, with geometric overlap as the fallback fill tier.
    A weighted longest-common-subsequence over ``_pair_score`` that maximises
    total confidence, so explicit correlations win and the uncorrelated matrix
    still connects by overlap; never pairs across lithology.

    Parameters
    ----------
    left : list[MatchUnit]
        Left column's units, sorted shallow → deep.
    right : list[MatchUnit]
        Right column's units, sorted shallow → deep.
    correlated : Correlated
        Edge lookup (approved correlation between two ``layer_id``s).

    Returns
    -------
    list[tuple[int, int]]
        Matched ``(left_index, right_index)`` pairs in ascending order.
    """
    n = len(left)
    m = len(right)
    # dp[i][j] = best total score matching left[:i] against right[:j].
    dp: list[list[int]] = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = _pair_score(left[i - 1], right[j - 1], correlated)
            best = max(dp[i - 1][j], dp[i][j - 1])
            if s > 0:
                best = max(best, dp[i - 1][j - 1] + s)
            dp[i][j] = best

    # Back-trace to recover the matched pairs (reverse order, then flip).
    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        s = _pair_score(left[i - 1], right[j - 1], correlated)
        if s > 0 and dp[i][j] == dp[i - 1][j - 1] + s:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


# ---------------------------------------------------------------------------
# Constants (ported verbatim from partitionFill.ts)
# ---------------------------------------------------------------------------

# How far across the gap (fraction of the total column spacing) an enclosed
# lens reaches before its pinch-out apex.  0.45 means the lens tapers to a
# point at 45 % of the way across; the engineer can adjust this later via a
# per-lens override.
LENS_PINCH_FRACTION: float = 0.45

# Fraction of the gap at which a lone interior pinch tapers to its tip
# (owner directive 2026-06-07). 0.5 = halfway on the interface dip — the unit
# thins to a point mid-gap and the enclosing matrix closes up beyond it,
# instead of running to the neighbour (the "drooping" pinch). Reshaped
# afterward via the freedraw apex handle.
INTERIOR_PINCH_FRACTION: float = 0.5

# Fraction tolerance for "this vertex sits on column edge 0 or 1".
FRAC_EPS: float = 1e-6

# Elevation tolerance when testing whether a matrix edge-span contains an overlay.
SPAN_EPS: float = 1e-6


# ---------------------------------------------------------------------------
# Output types
# ---------------------------------------------------------------------------

# Region kind / overlay tier unions mirror the TS literal types; Literal lets
# mypy catch a misspelled kind string at the call site instead of at runtime.
RegionKind = Literal["quad", "pinch", "lens"]
OverlayTier = Literal["onlap", "lens"]

# Internal side / bracket-edge unions (TS: 'left' | 'right', 'top' | 'base').
_Side = Literal["left", "right"]
_BracketEdge = Literal["top", "base"]


@dataclass(frozen=True)
class PartitionPoint:
    """A point in (fraction, elevation) space.

    Parameters
    ----------
    fraction : float
        0 = left column edge, 1 = right column edge.
    elevation : float
        Absolute elevation in mTAW.
    """

    fraction: float
    elevation: float


# ``eq=False`` keeps Python's default identity hash/equality: ``_carve_overlays``
# keys its notch map by region OBJECT (the TS ``Map`` keyed by reference), and a
# value-equality dataclass would be unhashable.  Mirrors the TS reference
# semantics exactly.  Mutable: ``_carve_overlays`` replaces ``polygon`` in place.
@dataclass(eq=False)
class PartitionRegion:
    """One filled region of the partition.

    ``polygon`` is a closed ring (no repeated last point) in
    (fraction, elevation) space.  The overlay maps it to screen coordinates.

    Parameters
    ----------
    formation_id : str
        Drives the fill colour (lithology).
    body_id : str | None
        Resolver-stamped body identity (overlay freedraw / context-menu /
        labels), or ``None`` for a never-correlated minority.
    kind : RegionKind
        ``quad``  = body present on both columns (four-corner trapezoid).
        ``pinch`` = body present on one column only; cut at the meeting
        fraction inside its interval (triangular when alone, trapezoidal when
        sharing the interval with an opposite pinch).
        ``lens``  = enclosed lens extracted in the pre-pass; horizontal
        pinch-out triangle that overlays its enclosing matrix quad.  Excluded
        from the tiling invariant (it deliberately overlaps its matrix).
    polygon : list[PartitionPoint]
        Closed polygon ring, no repeated last point.
    overlay_tier : OverlayTier | None
        For overlays (``kind: 'lens'``) only — which carve TIER the region
        belongs to.  ``onlap`` laps one bracket tie-line; ``lens`` is a
        fully-enclosed minority.  ``_carve_overlays`` carves onlaps out of the
        mains, then lenses out of the onlaps (an enclosed lens inside an
        onlapping clay) and finally the mains, so a lens sitting inside an
        onlap no longer overlaps it.  Mains leave it ``None``; the renderer
        ignores it (both tiers draw as overlays).
    """

    formation_id: str
    body_id: str | None
    kind: RegionKind
    polygon: list[PartitionPoint]
    overlay_tier: OverlayTier | None = None


@dataclass(eq=False)
class SectionRegion(PartitionRegion):
    """A partition region tagged with the gap (0-based, left-column index) it fills.

    Parameters
    ----------
    gap_index : int
        The gap the region fills — 0-based index of the gap's LEFT column.
    """

    gap_index: int = field(kw_only=True)


@dataclass(frozen=True)
class LensApexOverride:
    """A user override for a lens's pinch apex (shaping, dogfeed 2026-06-05).

    ``fraction`` is the apex's horizontal position 0 (left column) → 1 (right
    column); ``elevation`` is its mTAW elevation.  Replaces the auto default
    (``LENS_PINCH_FRACTION`` / ``1 − LENS_PINCH_FRACTION`` at the lens's
    mid-elevation) so the engineer can set how far a lens reaches + at what
    depth.

    Parameters
    ----------
    fraction : float
        Apex horizontal position, gap-local 0 → 1.
    elevation : float
        Apex elevation (mTAW).
    upper, lower : Sequence[PartitionPoint] | None
        Optional multi-node freedraw shape: ordered (gap-local fraction,
        elevation) points on the lens's upper and lower edges.  When present
        the lens is built from these instead of the single apex, so a freedraw
        lens is clipped to its matrix (rides the seam) and gets a matching
        notch in the DOMAIN — the overlay no longer rebuilds it un-clipped
        (which let a straddle lens cross the seam).
    """

    fraction: float
    elevation: float
    upper: Sequence[PartitionPoint] | None = None
    lower: Sequence[PartitionPoint] | None = None


def lens_apex_override_key(body_id: str, gap_index: int) -> str:
    """Key a lens apex override by body AND gap.

    A lens body that pinches into two gaps has an INDEPENDENT apex in each, so
    the override map is keyed per ``(body_id, gap_index)`` — a body_id-only key
    would let one gap's apex overwrite the other (last-write-wins), leaving one
    gap's matrix notch mismatched.

    Parameters
    ----------
    body_id : str
        The lens body's id.
    gap_index : int
        The gap (0-based, left-column index).

    Returns
    -------
    str
        The composite override-map key.
    """
    return f"{body_id}@{gap_index}"


# ---------------------------------------------------------------------------
# Internal types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Interface:
    """One horizontal interface line: left-depth ↔ right-depth."""

    left_depth: float
    right_depth: float


@dataclass
class _PinchUnit:
    """A pinch unit pending placement inside an interval.

    Mutable: ``_extract_interval_minorities`` grows the matrix unit's depth
    span in place when a minority is pulled (the TS pattern).
    """

    body_id: str | None
    formation_id: str
    side: _Side
    # Depth span on the unit's own column.
    own_top_depth: float
    own_base_depth: float


@dataclass(frozen=True)
class _ExtractedLens:
    """A lens pinched out of a column.

    Which gap-side it renders on is decided at emit time (a column's lens is a
    LEFT lens in the gap to its right and a RIGHT lens in the gap to its
    left), so no ``side`` is stored here.  ``body_id`` is ``None`` for a lens
    whose minority body was never correlated.
    """

    body_id: str | None
    formation_id: str
    depth_top_m: float
    depth_base_m: float


@dataclass(frozen=True)
class _ExtractedMinority:
    """A minority unit pulled from an interval, classified by its pinch-out kind.

    ``kind == 'lens'``  — enclosed by the matrix above AND below (0 correlated
    contacts); horizontal apex at its own elevation.
    ``kind == 'onlap'`` — touches exactly ONE bracket tie-line (1 correlated
    contact); laps against that bracket, tip on the bracket interface.
    ``edge`` — for an onlap: which bracket it laps against (``top`` → laps up).
    """

    unit: _PinchUnit
    kind: Literal["lens", "onlap"]
    edge: _BracketEdge | None = None


@dataclass(frozen=True)
class _OverlayNotch:
    """A notch to cut into a matrix's column edge.

    ``ob``/``ot`` are the lower/upper elevations where the notch meets the
    column edge; ``chain`` is the overlay's interior boundary between them
    (ordered low → high), which is a single apex for a fully-enclosed lens or
    a seam-riding chain for a straddle lens (owner's "rest on the clay" rule —
    the lens base follows the sloping body beneath it rather than crossing
    into it).
    """

    ob: float
    ot: float
    chain: list[PartitionPoint]


@dataclass(frozen=True)
class _MatrixRef:
    """The matrix quad ABOVE / BELOW an interval (TS: ``{ formationId, bodyId }``)."""

    formation_id: str
    body_id: str | None


@dataclass(frozen=True)
class _IntervalOnlap:
    """An onlap collected during the interval walk, with its interval interfaces.

    The interfaces are snapshotted because ``prev_quad_base`` is reused as the
    walk advances (TS: ``{ ...intervalTop }``).
    """

    unit: _PinchUnit
    edge: _BracketEdge
    top_iface: _Interface
    base_iface: _Interface


# ---------------------------------------------------------------------------
# Column preparation
# ---------------------------------------------------------------------------


def _close_column_gaps(units: list[PartitionUnit]) -> None:
    """Snap each unit's base to the next unit's top, in place, so the column is
    gap-free and overlap-free before tiling.

    The accepted litho layers feeding a column can carry a depth GAP (a
    rejected/collapsed segment whose ``depth_base`` no longer meets the next
    unit's ``depth_top``).  The litho bands hide this by rendering
    contact→next-contact; the partition fill must do the same or it shows a
    HOLE (dogfeed 2026-06-08).  Units must already be sorted by
    ``top_depth_m``.  The deepest unit keeps its own base — the column floor.
    """
    for i in range(len(units) - 1):
        units[i].base_depth_m = units[i + 1].top_depth_m


def _collapse_adjacent_same_formation(units: list[PartitionUnit]) -> None:
    """Merge runs of adjacent same-``formation_id`` units into one, in place.

    Lithology is the fill primitive — a stack of same-lithology beds is one
    matrix band, regardless of how the resolver split it into bodies.  Without
    this, when one column's matrix is one unit and the other's is split into N
    (different ``body_id``s, or exposed by removing an interbedded lens), the
    matcher orphans the surplus pieces into spurious pinches.  Keeps the
    shallowest unit's ``body_id`` as the run's representative.
    """
    for i in range(len(units) - 2, -1, -1):
        if units[i].formation_id == units[i + 1].formation_id:
            units[i].base_depth_m = units[i + 1].base_depth_m
            del units[i + 1]


def _reduce_column(
    units: list[PartitionUnit],
    neighbour_layer_ids: set[str] | frozenset[str],
    correlated: Correlated,
) -> list[_ExtractedLens]:
    """Per-gap column reduction: pull the LENS units, leaving bands + onlaps.

    Pulls the units with 0 correlated bounding contacts toward the facing
    neighbour — see ``classify_termination`` — leaving the bands + onlaps for
    ``_emit_gap`` to shape.

    Owner model (2026-06-09) — a unit's shape toward a neighbour is set purely
    by how many of its two bounding contacts are correlated to it (2 band /
    1 onlap / 0 lens).  Only the 0-contact lenses are removed here: pulling a
    lens lets the SAME-lithology matrix above + below it merge so it connects
    continuously across the gap via its OUTER correlated boundaries (the lens
    overlays it).  The matrix's INTERNAL boundary (the lens contact) is
    uncorrelated by construction; its outer boundaries carry the band.

    Called PER GAP against the SINGLE facing neighbour (its layer ids), so a
    unit can be a lens toward one neighbour and a band/onlap toward the other.

    Parameters
    ----------
    units : list[PartitionUnit]
        The column's units (mutated in place — lenses removed, matrix merged).
    neighbour_layer_ids : set[str] | frozenset[str]
        Every ``layer_id`` on the facing neighbour column (for the
        contact-correlation count).
    correlated : Correlated
        Edge lookup (approved correlation between two ``layer_id``s).

    Returns
    -------
    list[_ExtractedLens]
        The pinched-out lenses, in removal order.
    """
    lenses: list[_ExtractedLens] = []
    # A pulled lens records its ORIGINAL extent, not the live (possibly flood-
    # mutated) depths: when a thin interbed is pulled, the thicker neighbour
    # floods UP into its space (``below.top_depth_m = u.top_depth_m`` below);
    # if THAT neighbour is later pulled as a lens too, its live top is the
    # flooded value, so two lens triangles on the same column would overlap.
    # Snapshot the entry depths by layer_id and emit those.
    orig_top = {u.layer_id: u.top_depth_m for u in units}
    orig_base = {u.layer_id: u.base_depth_m for u in units}

    def thick(x: PartitionUnit) -> float:
        """Depth thickness of a unit (base − top)."""
        return x.base_depth_m - x.top_depth_m

    # Precompute "is this unit's contact correlated to ANY neighbour" once for
    # the column (perf): classify_termination then does a set lookup instead of
    # re-scanning neighbour_layer_ids on every while×for pass.  Splices only
    # remove units / mutate depths, never add new layer ids, so the set stays
    # valid.
    correlated_to_neighbour: set[str] = set()
    for u in units:
        for v in neighbour_layer_ids:
            if correlated(u.layer_id, v):
                correlated_to_neighbour.add(u.layer_id)
                break
    changed = True
    while changed:
        changed = False
        for i in range(1, len(units) - 1):
            # An INTERIOR unit pinches out as a LENS toward this neighbour iff
            # NEITHER of its two bounding contacts is correlated (the owner's
            # 0-contact rule).  Bands (2 contacts) and onlaps (1) are kept and
            # shaped by _emit_gap.  Pulling the lens lets the SAME-lithology
            # matrix above + below it merge and connect continuously (a silt
            # lens in sand → the sand stays one band via its OUTER correlated
            # boundaries, the silt overlays).  The matrix's INTERNAL boundary
            # (the lens contact) is uncorrelated; its outer boundaries carry
            # the band.
            if (
                classify_termination(
                    units, i, neighbour_layer_ids, correlated, correlated_to_neighbour
                )
                != "lens"
            ):
                continue
            u = units[i]
            above = units[i - 1]
            below = units[i + 1]
            lenses.append(
                _ExtractedLens(
                    body_id=u.body_id,
                    formation_id=u.formation_id,
                    depth_top_m=orig_top.get(u.layer_id, u.top_depth_m),
                    depth_base_m=orig_base.get(u.layer_id, u.base_depth_m),
                )
            )
            if above.formation_id == below.formation_id:
                # Same matrix both sides → merge so it connects continuously.
                above.base_depth_m = below.base_depth_m
                del units[i : i + 2]  # remove u + below (below folded into above)
            else:
                # Between two DIFFERENT bands → the thicker neighbour floods
                # over the vacated space (closes the gap); the bed pinches out
                # as a lens.
                if thick(above) >= thick(below):
                    above.base_depth_m = u.base_depth_m
                else:
                    below.top_depth_m = u.top_depth_m
                del units[i]
            changed = True
            break  # restart after a merge
    return lenses


def _extract_interval_minorities(
    left_stack: list[_PinchUnit],
    right_stack: list[_PinchUnit],
    above_lith: str | None,
    below_lith: str | None,
) -> list[_ExtractedMinority]:
    """Extract minority units from ONE interval's left + right unit stacks.

    Classifies each minority as a lens or an onlap, and reduces each column to
    its connecting matrix.

    Within an interval bracketed by matched bands, the "matrix" is the
    lithology present on BOTH columns' interval stacks.  A minority unit is:

      - a **lens** when, on its own column, the units immediately above AND
        below it share the SAME lithology M, M ≠ the unit's own lithology, and
        M is the matrix (present on the OTHER column's interval stack).
        0 correlated bounding contacts.
      - an **onlap** when it is the TOP unit of the stack (its top is the top
        bracket tie-line) and the unit BELOW it is the matrix M — or the
        mirror at the bottom.  1 correlated bounding contact (the bracket it
        touches).

    Each extracted unit is removed and the matrix it was embedded in is grown
    to fill its place, so the matrix reduces to one contiguous unit per column
    and then connects across as a band via ``_emit_interval``'s same-formation
    single-unit-per-side case.

    Keying the connectivity guard on the OTHER column's INTERVAL stack (not
    the whole column) is what distinguishes a lens-in-matrix (silt inside sand
    → extract) from a matrix-between-brackets (sand between two clay BANDS →
    the enclosing clay is a bracket, absent from the other column's interval,
    so the sand is NOT extracted and stays the matrix).  The same guard makes
    onlap extraction fire only when the matrix actually connects across — a
    one-sided interval (empty other column) keeps its existing boundary-pinch
    behaviour.

    Parameters
    ----------
    left_stack, right_stack : list[_PinchUnit]
        The interval's unmatched units per column, sorted shallow→deep.  Both
        are mutated in place (minorities removed, matrix grown).
    above_lith, below_lith : str | None
        The top / base bracket lithology (matched band above / below the
        interval), or ``None`` at the surface / floor (no bracket → no onlap).

    Returns
    -------
    list[_ExtractedMinority]
        The extracted minorities, in removal order.
    """
    out: list[_ExtractedMinority] = []
    sides: list[tuple[_Side, list[_PinchUnit], list[_PinchUnit]]] = [
        ("left", left_stack, right_stack),
        ("right", right_stack, left_stack),
    ]
    for side, stack, other in sides:
        # `other` is read-only within this side's loop (only `stack` is
        # spliced), so the formation set is invariant across while-iterations —
        # build it once per side instead of every pass (perf: hot-loop
        # allocation).
        other_formations = {u.formation_id for u in other}
        changed = True
        while changed:
            changed = False

            # (1) Interior lens — enclosed by the same matrix above AND below.
            for i in range(1, len(stack) - 1):
                u = stack[i]
                above = stack[i - 1]
                below = stack[i + 1]
                if above.formation_id != below.formation_id:
                    continue
                m = above.formation_id
                if m == u.formation_id:
                    continue
                if m not in other_formations:
                    continue
                out.append(_ExtractedMinority(unit=replace(u), kind="lens"))
                stack[i - 1 : i + 2] = [
                    _PinchUnit(
                        body_id=above.body_id,
                        formation_id=m,
                        side=side,
                        own_top_depth=above.own_top_depth,
                        own_base_depth=below.own_base_depth,
                    )
                ]
                changed = True
                break  # restart after a merge
            if changed:
                continue

            # (2) Onlap-top — the topmost unit touches the top bracket, matrix
            # below.
            if above_lith is not None and len(stack) >= 2:
                u = stack[0]
                below = stack[1]
                m = below.formation_id
                if m != u.formation_id and m in other_formations:
                    out.append(_ExtractedMinority(unit=replace(u), kind="onlap", edge="top"))
                    below.own_top_depth = u.own_top_depth  # matrix grows up to the bracket
                    del stack[0]
                    changed = True
                    continue

            # (3) Onlap-base — the bottommost unit touches the base bracket,
            # matrix above.
            if below_lith is not None and len(stack) >= 2:
                last = len(stack) - 1
                u = stack[last]
                above = stack[last - 1]
                m = above.formation_id
                if m != u.formation_id and m in other_formations:
                    out.append(_ExtractedMinority(unit=replace(u), kind="onlap", edge="base"))
                    above.own_base_depth = u.own_base_depth  # matrix grows down to the bracket
                    del stack[last]
                    changed = True
                    continue
    return out


# ---------------------------------------------------------------------------
# Interface helpers
# ---------------------------------------------------------------------------


def _clamp_iface(iface: _Interface, prev: _Interface) -> _Interface:
    """Clamp a candidate interface so it is not shallower than the previous one
    on either side."""
    return _Interface(
        left_depth=max(iface.left_depth, prev.left_depth),
        right_depth=max(iface.right_depth, prev.right_depth),
    )


def _iface_elev(
    iface: _Interface,
    fraction: float,
    left_surface: float,
    right_surface: float,
) -> float:
    """Interpolate the mTAW elevation on an interface at a given fraction.

    An interface is a straight line from (f=0, left_surface − left_depth) to
    (f=1, right_surface − right_depth).
    """
    left_elev = left_surface - iface.left_depth
    right_elev = right_surface - iface.right_depth
    return left_elev + fraction * (right_elev - left_elev)


# ---------------------------------------------------------------------------
# Polygon builders
# ---------------------------------------------------------------------------


def _build_quad_polygon(
    top_iface: _Interface,
    base_iface: _Interface,
    left_surface: float,
    right_surface: float,
) -> list[PartitionPoint]:
    """Build the 4-point quad polygon for a matched body.

    Corner order: top-left → top-right → base-right → base-left.
    """
    return [
        PartitionPoint(fraction=0, elevation=left_surface - top_iface.left_depth),
        PartitionPoint(fraction=1, elevation=right_surface - top_iface.right_depth),
        PartitionPoint(fraction=1, elevation=right_surface - base_iface.right_depth),
        PartitionPoint(fraction=0, elevation=left_surface - base_iface.left_depth),
    ]


def _build_left_pinch_polygon(
    top_iface: _Interface,
    base_iface: _Interface,
    meet_fraction: float,
    left_surface: float,
    right_surface: float,
) -> list[PartitionPoint]:
    """Build the polygon for a LEFT-only pinch that occupies [0, meet_fraction].

    The enclosing interval spans from ``top_iface`` to ``base_iface``.  The cut
    at ``meet_fraction`` is the dividing line shared with the right-only
    pinches in the same interval, computed from both interfaces independently
    so the cut is a straight (possibly slanted) line and the two trapezoids
    tile exactly.

    Corner order: top-left → top-cut → base-cut → base-left.
    When meet_fraction = 1 the cut IS the right column — triangle shape.
    """
    top_left_elev = left_surface - top_iface.left_depth
    base_left_elev = left_surface - base_iface.left_depth
    top_cut_elev = _iface_elev(top_iface, meet_fraction, left_surface, right_surface)
    base_cut_elev = _iface_elev(base_iface, meet_fraction, left_surface, right_surface)

    if abs(top_cut_elev - base_cut_elev) < EPS:
        # Degenerate: both interfaces meet at the cut → triangle.
        return [
            PartitionPoint(fraction=0, elevation=top_left_elev),
            PartitionPoint(fraction=meet_fraction, elevation=(top_cut_elev + base_cut_elev) / 2),
            PartitionPoint(fraction=0, elevation=base_left_elev),
        ]
    return [
        PartitionPoint(fraction=0, elevation=top_left_elev),
        PartitionPoint(fraction=meet_fraction, elevation=top_cut_elev),
        PartitionPoint(fraction=meet_fraction, elevation=base_cut_elev),
        PartitionPoint(fraction=0, elevation=base_left_elev),
    ]


def _build_right_pinch_polygon(
    top_iface: _Interface,
    base_iface: _Interface,
    meet_fraction: float,
    left_surface: float,
    right_surface: float,
) -> list[PartitionPoint]:
    """Build the polygon for a RIGHT-only pinch that occupies [meet_fraction, 1].

    Corner order: top-cut → top-right → base-right → base-cut.
    """
    top_right_elev = right_surface - top_iface.right_depth
    base_right_elev = right_surface - base_iface.right_depth
    top_cut_elev = _iface_elev(top_iface, meet_fraction, left_surface, right_surface)
    base_cut_elev = _iface_elev(base_iface, meet_fraction, left_surface, right_surface)

    if abs(top_cut_elev - base_cut_elev) < EPS:
        return [
            PartitionPoint(fraction=meet_fraction, elevation=(top_cut_elev + base_cut_elev) / 2),
            PartitionPoint(fraction=1, elevation=top_right_elev),
            PartitionPoint(fraction=1, elevation=base_right_elev),
        ]
    return [
        PartitionPoint(fraction=meet_fraction, elevation=top_cut_elev),
        PartitionPoint(fraction=1, elevation=top_right_elev),
        PartitionPoint(fraction=1, elevation=base_right_elev),
        PartitionPoint(fraction=meet_fraction, elevation=base_cut_elev),
    ]


def _build_freedraw_lens_outline(
    corner_frac: float,
    top_elev: float,
    base_elev: float,
    upper: Sequence[PartitionPoint],
    lower: Sequence[PartitionPoint],
) -> list[PartitionPoint]:
    """Build a multi-node freedraw lens outline anchored on column edge
    ``corner_frac`` (0 = left, 1 = right).

    The upper edge runs from the top corner out along the ``upper`` points
    (fraction-ascending), the lower edge returns along ``lower``
    (fraction-descending) to the base corner.  Same vertex order as the
    overlay's legacy ``buildLensPolygon`` so a freedraw lens renders
    identically — but now in the domain, where ``_carve_overlays`` clips it to
    the matrix + cuts the notch.
    """
    return [
        PartitionPoint(fraction=corner_frac, elevation=top_elev),
        *sorted(upper, key=lambda p: p.fraction),
        *sorted(lower, key=lambda p: p.fraction, reverse=True),
        PartitionPoint(fraction=corner_frac, elevation=base_elev),
    ]


def _build_left_lens_polygon(
    top_elev: float,
    base_elev: float,
    apex: LensApexOverride | None = None,
) -> list[PartitionPoint]:
    """Build the horizontal triangle polygon for an enclosed LEFT lens.

    The apex is at the lens's OWN mid-elevation (not interpolated from the
    enclosing interfaces), so the pinch-out is horizontal — geologically
    correct because the lens terminates at its own stratigraphic level, not
    along the dipping interfaces of the enclosing body.

    Polygon: base edge at fraction=0 (the source column), apex at
    fraction=LENS_PINCH_FRACTION.
    Corner order: top-left → apex → base-left.
    """
    if apex is not None and (apex.upper or apex.lower):
        return _build_freedraw_lens_outline(
            0, top_elev, base_elev, apex.upper or [], apex.lower or []
        )
    apex_fraction = apex.fraction if apex is not None else LENS_PINCH_FRACTION
    apex_elev = apex.elevation if apex is not None else (top_elev + base_elev) / 2
    return [
        PartitionPoint(fraction=0, elevation=top_elev),
        PartitionPoint(fraction=apex_fraction, elevation=apex_elev),
        PartitionPoint(fraction=0, elevation=base_elev),
    ]


def _build_right_lens_polygon(
    top_elev: float,
    base_elev: float,
    apex: LensApexOverride | None = None,
) -> list[PartitionPoint]:
    """Build the horizontal triangle polygon for an enclosed RIGHT lens.

    Mirror of ``_build_left_lens_polygon``: base edge at fraction=1, apex at
    fraction=1−LENS_PINCH_FRACTION.

    Corner order: top-right → apex → base-right.
    """
    if apex is not None and (apex.upper or apex.lower):
        return _build_freedraw_lens_outline(
            1, top_elev, base_elev, apex.upper or [], apex.lower or []
        )
    apex_fraction = apex.fraction if apex is not None else 1 - LENS_PINCH_FRACTION
    apex_elev = apex.elevation if apex is not None else (top_elev + base_elev) / 2
    return [
        PartitionPoint(fraction=1, elevation=top_elev),
        PartitionPoint(fraction=apex_fraction, elevation=apex_elev),
        PartitionPoint(fraction=1, elevation=base_elev),
    ]


def _build_onlap_polygon(
    unit: _PinchUnit,
    edge: _BracketEdge,
    top_iface: _Interface,
    base_iface: _Interface,
    left_surface: float,
    right_surface: float,
) -> list[PartitionPoint]:
    """Build the triangle polygon for an ONLAP — a minority that laps against
    one bracket tie-line.

    The flat edge sits on the unit's source column (fraction 0 left / 1
    right); the unit tapers to a tip at ``INTERIOR_PINCH_FRACTION`` whose
    elevation is taken from the BRACKET interface it laps against (``top`` →
    the top interface, so the base laps UP; ``base`` → the base interface, so
    the top laps DOWN).  This is geometrically distinct from a lens (apex at
    the unit's OWN mid-elevation) — the onlap is anchored on its correlated
    bracket.

    The onlap overlays the connected matrix band, so its region is emitted as
    ``kind: 'lens'`` (excluded from the tiling invariant), like an enclosed
    lens.
    """
    surface = left_surface if unit.side == "left" else right_surface
    col_frac = 0 if unit.side == "left" else 1
    tip_frac = INTERIOR_PINCH_FRACTION if unit.side == "left" else 1 - INTERIOR_PINCH_FRACTION
    top_elev = surface - unit.own_top_depth
    base_elev = surface - unit.own_base_depth
    anchor = top_iface if edge == "top" else base_iface
    tip_elev = _iface_elev(anchor, tip_frac, left_surface, right_surface)
    return [
        PartitionPoint(fraction=col_frac, elevation=top_elev),
        PartitionPoint(fraction=tip_frac, elevation=tip_elev),
        PartitionPoint(fraction=col_frac, elevation=base_elev),
    ]


# ---------------------------------------------------------------------------
# Overlay carve — turn lens/onlap overlays into a TRUE partition
# ---------------------------------------------------------------------------


def _edge_elevations(poly: list[PartitionPoint], side: int) -> list[float]:
    """Elevations of a polygon's vertices that sit on column edge ``side`` (0 or 1)."""
    return [p.elevation for p in poly if abs(p.fraction - side) < FRAC_EPS]


def _signed_area2(poly: list[PartitionPoint]) -> float:
    """Signed area × 2 of a ring in (fraction, elevation) space (> 0 = CCW)."""
    s = 0.0
    for i in range(len(poly)):
        a = poly[i]
        b = poly[(i + 1) % len(poly)]
        s += a.fraction * b.elevation - b.fraction * a.elevation
    return s


def _clip_to_convex(
    subject: list[PartitionPoint], clip: list[PartitionPoint]
) -> list[PartitionPoint]:
    """Clip a subject polygon to a CONVEX clip polygon (Sutherland-Hodgman) in
    (fraction, elevation) space.

    Used to make an overlay (lens/onlap) "rest on" its enclosing matrix: the
    part of the overlay that would stick out past a matrix edge is folded onto
    that edge, so the overlay never crosses into a neighbouring body (owner's
    Solution 2).  A fully-enclosed overlay (every vertex already inside the
    matrix) is returned unchanged.

    Parameters
    ----------
    subject : list[PartitionPoint]
        The overlay ring to clip.
    clip : list[PartitionPoint]
        The convex matrix ring to clip against.

    Returns
    -------
    list[PartitionPoint]
        The clipped ring (possibly empty if subject and clip are disjoint).
    """
    orient = 1 if _signed_area2(clip) >= 0 else -1
    m = len(clip)
    output = list(subject)
    for e in range(m):
        if len(output) == 0:
            break
        c1 = clip[e]
        c2 = clip[(e + 1) % m]
        dx = c2.fraction - c1.fraction
        dy = c2.elevation - c1.elevation

        # Left-test L(p) = (c2−c1) × (p−c1): > 0 = left of the directed edge.
        # The interior is left for a CCW ring, right for CW, so inside ⇔
        # orient·L ≥ 0.
        def line_side(
            p: PartitionPoint, c1: PartitionPoint = c1, dx: float = dx, dy: float = dy
        ) -> float:
            """Cross-product left-test against the current clip edge."""
            return dx * (p.elevation - c1.elevation) - dy * (p.fraction - c1.fraction)

        def intersect(a: PartitionPoint, b: PartitionPoint) -> PartitionPoint:
            """Intersection of segment a→b with the current clip edge line."""
            la = line_side(a)
            lb = line_side(b)
            t = 0.0 if abs(la - lb) < 1e-12 else la / (la - lb)
            return PartitionPoint(
                fraction=a.fraction + t * (b.fraction - a.fraction),
                elevation=a.elevation + t * (b.elevation - a.elevation),
            )

        input_ring = output
        output = []
        for i in range(len(input_ring)):
            a = input_ring[i]
            b = input_ring[(i + 1) % len(input_ring)]
            a_in = orient * line_side(a) >= -SPAN_EPS
            b_in = orient * line_side(b) >= -SPAN_EPS
            if a_in:
                output.append(a)
                if not b_in:
                    output.append(intersect(a, b))
            elif b_in:
                output.append(intersect(a, b))
    # Drop consecutive duplicate vertices (clipping along an existing edge
    # emits coincident points) so downstream edge-vertex counting stays exact.
    return _dedupe_ring(output)


def _dedupe_ring(poly: list[PartitionPoint]) -> list[PartitionPoint]:
    """Remove consecutive (and wrap-around) near-duplicate vertices from a ring."""
    out: list[PartitionPoint] = []
    for p in poly:
        last = out[-1] if out else None
        if (
            last is not None
            and abs(last.fraction - p.fraction) < FRAC_EPS
            and abs(last.elevation - p.elevation) < SPAN_EPS
        ):
            continue
        out.append(p)
    if (
        len(out) > 1
        and abs(out[0].fraction - out[-1].fraction) < FRAC_EPS
        and abs(out[0].elevation - out[-1].elevation) < SPAN_EPS
    ):
        out.pop()
    return out


def _notch_from_clipped(clipped: list[PartitionPoint], side: int) -> _OverlayNotch | None:
    """Extract the column-edge notch of a clipped overlay: where it meets edge
    ``side`` (``ob``/``ot``) and the interior chain between (ordered low → high).

    The clipped overlay has exactly two vertices on the column edge (its base)
    and one or more interior vertices (apex, or seam-riding chain).  Returns
    ``None`` if the shape is degenerate (fewer than two edge vertices) so the
    caller can skip.
    """
    n = len(clipped)

    def on_edge(p: PartitionPoint) -> bool:
        """True iff the vertex sits on column edge ``side``."""
        return abs(p.fraction - side) < FRAC_EPS

    edge_idx = [i for i in range(n) if on_edge(clipped[i])]
    if len(edge_idx) != 2:
        return None
    i, j = edge_idx
    ob = min(clipped[i].elevation, clipped[j].elevation)
    ot = max(clipped[i].elevation, clipped[j].elevation)

    # The two ring arcs between the edge vertices: one runs along the column
    # edge (no interior vertices), the other carries the interior boundary.
    def arc(from_idx: int, to_idx: int) -> list[PartitionPoint]:
        """Ring vertices strictly between ``from_idx`` and ``to_idx`` (cyclic)."""
        r: list[PartitionPoint] = []
        k = (from_idx + 1) % n
        while k != to_idx:
            r.append(clipped[k])
            k = (k + 1) % n
        return r

    arc_a = arc(i, j)  # i → j
    arc_b = arc(j, i)  # j → i

    def has_interior(a: list[PartitionPoint]) -> bool:
        """True iff the arc carries at least one off-edge (interior) vertex."""
        return any(not on_edge(p) for p in a)

    if has_interior(arc_a) or len(arc_b) == 0:
        chain = arc_a
        from_idx = i
    else:
        chain = arc_b
        from_idx = j
    # Normalise to low → high: reverse if the chain starts at the upper edge
    # vertex.
    if clipped[from_idx].elevation > (ob + ot) / 2:
        chain = list(reversed(chain))
    return _OverlayNotch(ob=ob, ot=ot, chain=chain)


def _insert_notches(
    poly: list[PartitionPoint],
    side: int,
    notches: list[_OverlayNotch],
) -> list[PartitionPoint]:
    """Insert notches into a polygon ring along the single edge whose BOTH
    endpoints sit on column edge ``side``.

    Each overlay shares its base with the matrix on column edge ``side``; its
    (clipped) interior boundary becomes a notch on that edge — one concave
    ring, never a hole or a split (a LEFT overlay lives in the left half, a
    RIGHT one in the right half, so an overlay only ever sits in a matrix it
    shares a column edge with).  No general polygon-boolean is needed.

    Walking the ring, when we traverse the edge ``a → b`` with both endpoints
    at ``side``, we cut each notch as ``near → chain → far`` where near/far
    follow the traversal direction (up the edge → near = the lower elevation,
    chain low→high).  Stacked notches (multiple overlays on one edge) are
    inserted in elevation order so they don't cross; overlays never overlap
    each other (LL1), so the cuts are disjoint.

    Parameters
    ----------
    poly : list[PartitionPoint]
        The matrix polygon ring (closed, no repeated last point).
    side : int
        The column edge to notch (0 = left, 1 = right).
    notches : list[_OverlayNotch]
        The notches to cut into that edge.

    Returns
    -------
    list[PartitionPoint]
        A new ring with the notches cut in (concave).
    """
    if len(notches) == 0:
        return poly
    out: list[PartitionPoint] = []
    n = len(poly)
    # Only the first qualifying edge is notched (a simple ring touches `side`
    # once).
    cut = False
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        out.append(a)
        a_on = abs(a.fraction - side) < FRAC_EPS
        b_on = abs(b.fraction - side) < FRAC_EPS
        if not cut and a_on and b_on:
            cut = True
            dir_ = b.elevation - a.elevation  # > 0 → traversing up the edge
            # Drop any notch whose [ob, ot] overlaps an earlier one.  Overlays
            # never overlap each other today (LL1), so this is a defensive
            # guard for the future nested-lens case (a lens inside a lens) —
            # overlapping notches would self-intersect the matrix ring; the
            # skipped overlay stays a harmless overlay instead.
            by_elev = sorted(notches, key=lambda nt: nt.ob)
            safe: list[_OverlayNotch] = []
            last_ot = float("-inf")
            for nt in by_elev:
                if nt.ob < last_ot - SPAN_EPS:
                    continue
                safe.append(nt)
                last_ot = nt.ot
            ordered = safe if dir_ >= 0 else list(reversed(safe))
            for nt in ordered:
                near = nt.ob if dir_ >= 0 else nt.ot
                far = nt.ot if dir_ >= 0 else nt.ob
                chain = nt.chain if dir_ >= 0 else list(reversed(nt.chain))
                out.append(PartitionPoint(fraction=side, elevation=near))
                out.extend(
                    PartitionPoint(fraction=p.fraction, elevation=p.elevation) for p in chain
                )
                out.append(PartitionPoint(fraction=side, elevation=far))
    return out


def _carve_overlays(regions: list[PartitionRegion]) -> None:
    """Subtract every lens/onlap overlay from the matrix region it sits in, in
    place, so the gap's regions become a TRUE partition: each point belongs to
    exactly one region.

    Owner's Solution 2 ("rest on the clay"): each overlay is first CLIPPED to
    its enclosing matrix (so a straddle lens's base follows the sloping seam
    of the body beneath it rather than crossing into it), then that clipped
    shape is carved out of the matrix as a notch.  A fully-enclosed lens clips
    to itself unchanged, so the simple apex notch is the special case.

    Run as a post-pass at the end of ``_emit_gap`` — after all mains +
    overlays are emitted.  Only the matrix polygons gain notches; each
    overlay's polygon is replaced by its clipped (seam-riding) shape so it
    exactly fills its notch.

    Parameters
    ----------
    regions : list[PartitionRegion]
        One gap's regions (mutated in place: overlay + matrix ``polygon``s
        change).
    """
    mains = [r for r in regions if r.kind == "quad" or r.kind == "pinch"]
    onlaps = [r for r in regions if r.overlay_tier == "onlap"]
    lenses = [r for r in regions if r.overlay_tier == "lens"]
    if len(mains) == 0:
        return

    # Notches to cut, grouped by the region they cut into and the column side.
    # All notches are accumulated first and applied once at the end, so every
    # clip sees a CONVEX target (a region is never mutated until all overlays
    # riding on it have been clipped against it).  ``PartitionRegion`` uses
    # identity hashing (eq=False) so this dict mirrors the TS Map keyed by
    # object reference; Python dicts preserve insertion order like JS Maps.
    by_target: dict[PartitionRegion, dict[int, list[_OverlayNotch]]] = {}

    def record_notch(t: PartitionRegion, side: int, nt: _OverlayNotch) -> None:
        """Accumulate a notch against its target region + column side."""
        g = by_target.get(t)
        if g is None:
            g = {0: [], 1: []}
            by_target[t] = g
        g[side].append(nt)

    def carve_onto(
        ov: PartitionRegion, candidates: list[PartitionRegion]
    ) -> PartitionRegion | None:
        """Clip ``ov`` to the tightest enclosing ``candidate`` (by column-edge
        span on the side ``ov`` is anchored to), replace ``ov``'s polygon with
        the clipped (seam-riding) shape, and record the notch to cut into that
        candidate.  Returns the candidate the overlay rode on, or ``None`` when
        none enclosed it (the overlay is then left untouched — a harmless
        overlay).
        """
        on_left = _edge_elevations(ov.polygon, 0)
        on_right = _edge_elevations(ov.polygon, 1)
        if len(on_left) >= 2:
            side = 0
            edge_elevs = on_left
        elif len(on_right) >= 2:
            side = 1
            edge_elevs = on_right
        else:
            return None  # defensive: overlay not anchored on a column edge
        ob = min(edge_elevs)
        ot = max(edge_elevs)

        # The region this overlay sits in: a candidate with >= 2 verts on
        # `side` whose edge-span contains [ob, ot].  Pick the TIGHTEST span —
        # when an onlap and the main beneath it both enclose a lens, the onlap
        # is tighter, so the lens rides (and carves out of) the onlap, not the
        # main it shares.
        best: PartitionRegion | None = None
        best_span = float("inf")
        for c in candidates:
            ce = _edge_elevations(c.polygon, side)
            if len(ce) < 2:
                continue
            lo = min(ce)
            hi = max(ce)
            if lo <= ob + SPAN_EPS and hi >= ot - SPAN_EPS:
                span = hi - lo
                if span < best_span:
                    best = c
                    best_span = span
        if best is None:
            return None  # no enclosing region (e.g. lens at the column floor)

        # Clip the overlay to the target so it rides the seam, then derive its
        # notch.
        clipped = _clip_to_convex(ov.polygon, best.polygon)
        if len(clipped) < 3:
            return None  # degenerate after clipping — leave as-is
        notch = _notch_from_clipped(clipped, side)
        if notch is None:
            return None
        ov.polygon = clipped  # the overlay now exactly fills its notch (seam-riding)
        record_notch(best, side, notch)
        return best

    # Tier 1: onlaps ride on the mains (the connected matrix band beneath
    # them).
    for ov in onlaps:
        carve_onto(ov, mains)
    # Tier 2: lenses ride on the onlap they sit inside FIRST (an enclosed
    # minority inside an onlapping clay — the tie-section-11 peat), else on a
    # main.  Onlaps were clipped above but not yet notched, so they are still
    # convex here; mains are likewise untouched until the apply pass below.
    # Both clips stay convex.
    for ov in lenses:
        carve_onto(ov, [*onlaps, *mains])

    # Apply every accumulated notch once per target/side (_insert_notches
    # orders + de-overlaps stacked notches).  Onlaps that gained lens notches
    # turn concave here; that is after all clipping, so no clip ever saw a
    # concave target.
    for t, g in by_target.items():
        if len(g[0]) > 0:
            t.polygon = _insert_notches(t.polygon, 0, g[0])
        if len(g[1]) > 0:
            t.polygon = _insert_notches(t.polygon, 1, g[1])


def _emit_one_sided_pinch(
    pinches: list[_PinchUnit],
    side: _Side,
    top_iface: _Interface,
    base_iface: _Interface,
    above: _MatrixRef | None,
    below: _MatrixRef | None,
    left_surface: float,
    right_surface: float,
    f: float,
) -> list[PartitionRegion]:
    """Emit a ONE-SIDED pinch interval as apex-sharing triangles (Thread A).

    Every pinch unit lives on ``side`` (the unit is absent on the opposite
    column, so the interval converges there).  One shared apex is placed at
    fraction ``f`` from the pinch side; each stacked pinch becomes a
    sub-triangle to the apex, and a SINGLE matrix extension closes the wedge
    beyond the apex:

      - matrix above present → apex on the BASE interface; the above matrix
        descends to fill the wedge while the unit BELOW keeps its flat
        correlated top (no extension for it);
      - no matrix above (surface) → apex on the TOP interface (surface); the
        below matrix rises to fill.

    The result tiles exactly (N pinch sub-triangles + one matrix triangle all
    share the apex), so the pinch tips mid-gap (no droop to the neighbour)
    while the fill stays hole-free.  Two-sided (interfingering) intervals are
    NOT handled here — the caller routes those to ``_emit_interval``.

    Parameters
    ----------
    pinches : list[_PinchUnit]
        The unmatched units, all on ``side`` (sorted internally top→bottom).
    side : _Side
        The column the pinches live on.
    top_iface, base_iface : _Interface
        The interval's enclosing interfaces.
    above, below : _MatrixRef | None
        The matrix quad ABOVE / BELOW the interval, or ``None`` at the
        surface / floor respectively.
    left_surface, right_surface : float
        Column surface elevations (mTAW).
    f : float
        Tip fraction measured from the pinch side
        (``INTERIOR_PINCH_FRACTION``).

    Returns
    -------
    list[PartitionRegion]
        ``[...pinch sub-triangles, above extension?, below extension?]``.
    """
    apex_fraction = f if side == "left" else 1 - f

    pinch_frac = 0 if side == "left" else 1
    opp_frac = 1 if side == "left" else 0
    pinch_surface = left_surface if side == "left" else right_surface
    opp_surface = right_surface if side == "left" else left_surface
    top_opp_depth = top_iface.right_depth if side == "left" else top_iface.left_depth
    base_opp_depth = base_iface.right_depth if side == "left" else base_iface.left_depth
    top_pinch_depth = top_iface.left_depth if side == "left" else top_iface.right_depth
    base_pinch_depth = base_iface.left_depth if side == "left" else base_iface.right_depth

    # LENS vs BOUNDARY pinch.
    #   - Same matrix FORMATION above AND below → the unit is a LENS inside one
    #     material (clay/silt/clay).  It must pinch at its OWN elevation (no
    #     droop), with the matrix filling around it from BOTH sides.
    #   - Otherwise → a BOUNDARY pinch: the unit below keeps its flat
    #     correlated top and only the ABOVE matrix descends to fill (or, at the
    #     surface, the below matrix rises).  (owner directive 2026-06-08: an
    #     enclosed silt was drooping all the way down to the lower clay's
    #     base.)
    is_lens = above is not None and below is not None and above.formation_id == below.formation_id

    if is_lens:
        # The pinch block's own mid-elevation — the lens tapers horizontally.
        apex_elev = pinch_surface - (top_pinch_depth + base_pinch_depth) / 2
    elif above is not None:
        apex_elev = _iface_elev(base_iface, apex_fraction, left_surface, right_surface)
    else:
        apex_elev = _iface_elev(top_iface, apex_fraction, left_surface, right_surface)
    apex = PartitionPoint(fraction=apex_fraction, elevation=apex_elev)

    # The interval has zero thickness on the OPPOSITE column (the unit is
    # absent there) — the two interfaces meet at this convergence point.
    conv = PartitionPoint(
        fraction=opp_frac,
        elevation=opp_surface - (top_opp_depth + base_opp_depth) / 2,
    )

    out: list[PartitionRegion] = []
    # Each stacked pinch → a sub-triangle from its own depth span on the pinch
    # edge to the SHARED apex (one apex for the whole stack), so N stacked
    # units tile the pinch block exactly.
    for p in sorted(pinches, key=lambda x: x.own_top_depth):
        top = PartitionPoint(fraction=pinch_frac, elevation=pinch_surface - p.own_top_depth)
        base = PartitionPoint(fraction=pinch_frac, elevation=pinch_surface - p.own_base_depth)
        out.append(
            PartitionRegion(
                formation_id=p.formation_id,
                body_id=p.body_id,
                kind="pinch",
                polygon=[top, apex, base],
            )
        )
    top_corner = PartitionPoint(fraction=pinch_frac, elevation=pinch_surface - top_pinch_depth)
    base_corner = PartitionPoint(fraction=pinch_frac, elevation=pinch_surface - base_pinch_depth)
    # Matrix extensions close the wedge beyond the apex (merged contact
    # apex→conv).  A LENS fills from BOTH sides (same material) so the unit
    # keeps its own level; a BOUNDARY pinch fills from the ABOVE side only
    # (the unit below stays flat), or from BELOW at the surface.
    if above is not None and below is not None and above.formation_id == below.formation_id:
        out.append(
            PartitionRegion(
                formation_id=above.formation_id,
                body_id=above.body_id,
                kind="quad",
                polygon=[top_corner, conv, apex],
            )
        )
        out.append(
            PartitionRegion(
                formation_id=below.formation_id,
                body_id=below.body_id,
                kind="quad",
                polygon=[base_corner, apex, conv],
            )
        )
    elif above is not None:
        out.append(
            PartitionRegion(
                formation_id=above.formation_id,
                body_id=above.body_id,
                kind="quad",
                polygon=[top_corner, conv, apex],
            )
        )
    elif below is not None:
        out.append(
            PartitionRegion(
                formation_id=below.formation_id,
                body_id=below.body_id,
                kind="quad",
                polygon=[base_corner, apex, conv],
            )
        )
    return out


# ---------------------------------------------------------------------------
# Interval emission
# ---------------------------------------------------------------------------


def _emit_interval(
    pinches: list[_PinchUnit],
    top_iface: _Interface,
    base_iface: _Interface,
    left_surface: float,
    right_surface: float,
    bracketed: bool = False,
) -> list[PartitionRegion]:
    """Emit regions for one interval (the span between two quads, or between
    the surface/floor and a quad).

    An interval has a fixed enclosing ``top_iface`` and ``base_iface``.  Any
    number of left-only and right-only pinches share this interval and are
    tiled inside it side-by-side.

    Meeting fraction = total_left_thickness / (total_left + total_right) — the
    thicker side keeps more of the interval width.  When only one side has
    pinches the lone side fills the whole interval (meet_fraction 0 or 1).

    Parameters
    ----------
    pinches : list[_PinchUnit]
        The unmatched units in this interval, in top→bottom order per side.
    top_iface : _Interface
        Top boundary of the interval.
    base_iface : _Interface
        Base boundary of the interval.
    left_surface, right_surface : float
        Column surface elevations (mTAW).
    bracketed : bool
        True when correlated bands exist ABOVE and BELOW the interval —
        enables the mismatched-matrix midpoint seam.

    Returns
    -------
    list[PartitionRegion]
        The pinch regions tiling this interval.  Empty when ``pinches`` is
        empty.
    """
    if len(pinches) == 0:
        return []

    left_pinches = [p for p in pinches if p.side == "left"]
    right_pinches = [p for p in pinches if p.side == "right"]

    # Geometric-connectivity inference (owner directive 2026-06-08): when the
    # interval reduces to exactly one left unit and one right unit of the SAME
    # lithology (formation_id), they are the same matrix body bridging the gap
    # even though they were never explicitly correlated (different body_id).
    # Connect them as one band quad spanning the interval, inheriting the
    # bracketing interfaces — instead of tiling them as opposing pinches
    # meeting at a seam (the "droop").  Minority lithologies are extracted as
    # lenses by the pre-pass, so after extraction the matrix is this
    # single-unit-per-side case.
    if (
        len(left_pinches) == 1
        and len(right_pinches) == 1
        and left_pinches[0].formation_id == right_pinches[0].formation_id
    ):
        p = left_pinches[0]
        polygon = [
            PartitionPoint(fraction=0, elevation=left_surface - top_iface.left_depth),
            PartitionPoint(fraction=1, elevation=right_surface - top_iface.right_depth),
            PartitionPoint(fraction=1, elevation=right_surface - base_iface.right_depth),
            PartitionPoint(fraction=0, elevation=left_surface - base_iface.left_depth),
        ]
        return [
            PartitionRegion(
                formation_id=p.formation_id, body_id=p.body_id, kind="quad", polygon=polygon
            )
        ]

    # Compute total elevation thickness on each side for the meeting-fraction
    # weight.
    sum_left = sum(
        max(0.0, (left_surface - p.own_top_depth) - (left_surface - p.own_base_depth))
        for p in left_pinches
    )
    sum_right = sum(
        max(0.0, (right_surface - p.own_top_depth) - (right_surface - p.own_base_depth))
        for p in right_pinches
    )

    # Mismatched matrix: inside an interval bracketed by correlated bands ABOVE
    # and BELOW, exactly one left + one right unit of DIFFERENT lithology fill
    # it — no matrix connects across.  The transition position is unknown, so
    # the two halves meet at the MIDPOINT (0.5, "halfway", not the
    # thickness-weighted fraction).  The seam is a straight contact: the
    # owner's model (2026-06-09) has NO auto-facies wriggle — a lateral
    # facies/disturbed contact is the engineer's call, not a geometric
    # inference.  The ``bracketed`` gate keeps surface/floor opposing pinches
    # (PF3) on the weighted fraction.
    mismatched_matrix = (
        bracketed
        and len(left_pinches) == 1
        and len(right_pinches) == 1
        and left_pinches[0].formation_id != right_pinches[0].formation_id
    )

    if mismatched_matrix:
        meet_fraction = 0.5
    elif len(left_pinches) > 0 and len(right_pinches) > 0:
        meet_fraction = sum_left / (sum_left + sum_right) if sum_left + sum_right > EPS else 0.5
    elif len(left_pinches) > 0:
        meet_fraction = 1  # lone left-only: full triangle to right column
    else:
        meet_fraction = 0  # lone right-only: full triangle to left column

    regions: list[PartitionRegion] = []

    # Each left pinch is a SEPARATE region.  They all use the SAME top_iface
    # and base_iface (the interval boundaries) and the SAME meet_fraction —
    # they tile the same [0, meet_fraction] slice, one per pinch body.
    # When there are multiple left pinches they are stacked vertically inside
    # [0, meet_fraction]: each gets its own sub-interval.
    if len(left_pinches) == 1:
        p = left_pinches[0]
        polygon = _build_left_pinch_polygon(
            top_iface, base_iface, meet_fraction, left_surface, right_surface
        )
        regions.append(
            PartitionRegion(
                formation_id=p.formation_id, body_id=p.body_id, kind="pinch", polygon=polygon
            )
        )
    elif len(left_pinches) > 1:
        # Multiple left pinches: subdivide the interval vertically on the left
        # side.  Each pinch's own depth span defines its sub-interval on the
        # left.  The right side (at meet_fraction) is shared — interpolated
        # from top_iface/base_iface.
        interval_left_span = base_iface.left_depth - top_iface.left_depth
        for p in left_pinches:
            if p.own_base_depth - p.own_top_depth < EPS:
                continue
            # Sub-interface for this pinch: left side from the unit's own
            # depths, right side linearly interpolated from the interval's
            # right progression.
            t_top = (
                0
                if interval_left_span < EPS
                else (p.own_top_depth - top_iface.left_depth) / interval_left_span
            )
            t_base = (
                1
                if interval_left_span < EPS
                else (p.own_base_depth - top_iface.left_depth) / interval_left_span
            )
            sub_top_right = top_iface.right_depth + t_top * (
                base_iface.right_depth - top_iface.right_depth
            )
            sub_base_right = top_iface.right_depth + t_base * (
                base_iface.right_depth - top_iface.right_depth
            )
            sub_top = _Interface(left_depth=p.own_top_depth, right_depth=sub_top_right)
            sub_base = _Interface(left_depth=p.own_base_depth, right_depth=sub_base_right)
            polygon = _build_left_pinch_polygon(
                sub_top, sub_base, meet_fraction, left_surface, right_surface
            )
            regions.append(
                PartitionRegion(
                    formation_id=p.formation_id, body_id=p.body_id, kind="pinch", polygon=polygon
                )
            )

    # Similarly for right pinches.
    if len(right_pinches) == 1:
        p = right_pinches[0]
        polygon = _build_right_pinch_polygon(
            top_iface, base_iface, meet_fraction, left_surface, right_surface
        )
        regions.append(
            PartitionRegion(
                formation_id=p.formation_id, body_id=p.body_id, kind="pinch", polygon=polygon
            )
        )
    elif len(right_pinches) > 1:
        interval_right_span = base_iface.right_depth - top_iface.right_depth
        for p in right_pinches:
            if p.own_base_depth - p.own_top_depth < EPS:
                continue
            t_top = (
                0
                if interval_right_span < EPS
                else (p.own_top_depth - top_iface.right_depth) / interval_right_span
            )
            t_base = (
                1
                if interval_right_span < EPS
                else (p.own_base_depth - top_iface.right_depth) / interval_right_span
            )
            sub_top_left = top_iface.left_depth + t_top * (
                base_iface.left_depth - top_iface.left_depth
            )
            sub_base_left = top_iface.left_depth + t_base * (
                base_iface.left_depth - top_iface.left_depth
            )
            sub_top = _Interface(left_depth=sub_top_left, right_depth=p.own_top_depth)
            sub_base = _Interface(left_depth=sub_base_left, right_depth=p.own_base_depth)
            polygon = _build_right_pinch_polygon(
                sub_top, sub_base, meet_fraction, left_surface, right_surface
            )
            regions.append(
                PartitionRegion(
                    formation_id=p.formation_id, body_id=p.body_id, kind="pinch", polygon=polygon
                )
            )

    return regions


# ---------------------------------------------------------------------------
# Gap emission
# ---------------------------------------------------------------------------


def _emit_gap(
    left_units: list[PartitionUnit],
    left_surface: float,
    right_units: list[PartitionUnit],
    right_surface: float,
    left_lenses_in: Sequence[_ExtractedLens],
    right_lenses_in: Sequence[_ExtractedLens],
    correlated: Correlated,
    lens_apex_overrides: Mapping[str, LensApexOverride] | None = None,
    gap_index: int = 0,
) -> list[PartitionRegion]:
    """Emit the partition regions for ONE adjacent-column gap, given the
    already reduced + collapsed unit stacks and each column's pinched-out
    lenses.

    Matching (``match_columns``), the interval walk, onlap + facies handling,
    and the lens/onlap overlays live here.  The reduction happens upstream in
    ``compute_section_fill``.

    Parameters
    ----------
    left_units, right_units : list[PartitionUnit]
        The two columns' reduced + collapsed units (gap-free, sorted,
        non-empty).
    left_surface, right_surface : float
        Column surface elevations (mTAW).
    left_lenses_in, right_lenses_in : Sequence[_ExtractedLens]
        The lenses pinched out of each column, rendered as LEFT / RIGHT
        overlays.
    correlated : Correlated
        Edge lookup (approved correlation between two ``layer_id``s).
    lens_apex_overrides : Mapping[str, LensApexOverride] | None
        Optional per-body apex shaping.
    gap_index : int
        The gap index (keys the apex-override lookup).

    Returns
    -------
    list[PartitionRegion]
        Top-to-bottom MAIN regions that tile the gap, followed by lens/onlap
        overlays.
    """
    # Local copies — the interval walk appends interval-extracted lenses to
    # these.
    left_lenses = list(left_lenses_in)
    right_lenses = list(right_lenses_in)

    # -------------------------------------------------------------------------
    # Step 1: Edge-driven monotonic alignment (post-reduction units).  An
    # explicit correlation edge bands a pair (at any elevation); geometric
    # overlap is the fallback fill tier for the matrix; never matches across
    # lithology.
    # -------------------------------------------------------------------------
    def to_match_units(units: list[PartitionUnit], surface: float) -> list[MatchUnit]:
        """Precompute mTAW elevations for the matcher."""
        return [
            MatchUnit(
                formation_id=u.formation_id,
                layer_id=u.layer_id,
                top_elev=surface - u.top_depth_m,
                base_elev=surface - u.base_depth_m,
            )
            for u in units
        ]

    matched_pairs = match_columns(
        to_match_units(left_units, left_surface),
        to_match_units(right_units, right_surface),
        correlated,
    )

    left_matched = {li for li, _ in matched_pairs}
    right_matched = {ri for _, ri in matched_pairs}

    # -------------------------------------------------------------------------
    # Step 2: Walk the matched pairs, collecting interval groups.
    #
    # Each "interval" is defined by its top and base interface:
    #   - top = previous quad's base iface (or the surface interface).
    #   - base = next quad's top iface (or the floor interface).
    #
    # Within each interval we collect all unmatched left and right units, then
    # call _emit_interval to tile them side-by-side.
    # -------------------------------------------------------------------------
    left_top = left_units[0].top_depth_m
    right_top = right_units[0].top_depth_m if len(right_units) > 0 else left_top
    left_floor = left_units[-1].base_depth_m
    right_floor = right_units[-1].base_depth_m if len(right_units) > 0 else left_floor

    surface_iface = _Interface(left_depth=left_top, right_depth=right_top)
    floor_iface = _Interface(left_depth=left_floor, right_depth=right_floor)

    regions: list[PartitionRegion] = []

    # Onlaps collected during the walk, emitted AFTER the main regions (they
    # overlay the connected matrix band, like lenses).  Each carries the
    # interval interfaces it laps against, snapshotted because
    # ``prev_quad_base`` is reused.
    interval_onlaps: list[_IntervalOnlap] = []

    # prev_quad_base: the base interface of the most recently emitted quad (or
    # the surface interface before any quads).
    prev_quad_base = surface_iface
    # Identity of the most recently emitted quad (the matrix ABOVE the next
    # interval) — fed to _emit_one_sided_pinch so the above-matrix extension is
    # coloured correctly (Slice 1).
    prev_quad_formation_id: str | None = None
    prev_quad_body_id: str | None = None

    # Also track the left and right unit cursors so we can collect unmatched
    # units.  For each inter-quad gap, unmatched left units are those between
    # the previous match's left index and the next match's left index
    # (exclusive, left-unmatched), and similarly for right.
    prev_match_li = -1  # last matched left index (-1 = before first)
    prev_match_ri = -1  # last matched right index

    for pair_idx in range(len(matched_pairs) + 1):
        is_floor = pair_idx == len(matched_pairs)
        next_match_li = len(left_units) if is_floor else matched_pairs[pair_idx][0]
        next_match_ri = len(right_units) if is_floor else matched_pairs[pair_idx][1]

        # Collect unmatched units in this interval, per column.
        left_stack: list[_PinchUnit] = []
        for li in range(prev_match_li + 1, next_match_li):
            if li in left_matched:
                continue
            lu = left_units[li]
            left_stack.append(
                _PinchUnit(
                    body_id=lu.body_id,
                    formation_id=lu.formation_id,
                    side="left",
                    own_top_depth=lu.top_depth_m,
                    own_base_depth=lu.base_depth_m,
                )
            )
        right_stack: list[_PinchUnit] = []
        for ri in range(prev_match_ri + 1, next_match_ri):
            if ri in right_matched:
                continue
            ru = right_units[ri]
            right_stack.append(
                _PinchUnit(
                    body_id=ru.body_id,
                    formation_id=ru.formation_id,
                    side="right",
                    own_top_depth=ru.top_depth_m,
                    own_base_depth=ru.base_depth_m,
                )
            )

        # Interval interfaces + bracket matrices — computed BEFORE extraction
        # so an onlap can be anchored on the bracket interface it laps against.
        if is_floor:
            interval_base = _clamp_iface(floor_iface, prev_quad_base)
        else:
            mli, mri = matched_pairs[pair_idx]
            interval_base = _clamp_iface(
                _Interface(
                    left_depth=left_units[mli].top_depth_m,
                    right_depth=right_units[mri].top_depth_m,
                ),
                prev_quad_base,
            )
        interval_top = prev_quad_base
        # TS: hasAbove = prevMatchLi >= 0 && prevQuadFormationId !== null; the
        # explicit ``is not None`` check here also narrows the type for mypy
        # (the TS non-null assertion).
        above_matrix: _MatrixRef | None = None
        if prev_match_li >= 0 and prev_quad_formation_id is not None:
            above_matrix = _MatrixRef(
                formation_id=prev_quad_formation_id, body_id=prev_quad_body_id
            )
        below_matrix: _MatrixRef | None = None
        if not is_floor:
            mli = matched_pairs[pair_idx][0]
            u = left_units[mli]
            below_matrix = _MatrixRef(formation_id=u.formation_id, body_id=u.body_id)

        # Interval-scoped minority extraction: pull lenses (enclosed by the
        # matrix) and onlaps (touching one bracket) so the matrix reduces to
        # one unit per column and connects across as a band (the reduced
        # stacks feed _emit_interval).  Lenses append after the main regions
        # (horizontal apex); onlaps are collected with their interfaces and
        # emitted after the main regions too — both overlay the connected
        # matrix band.
        for minority in _extract_interval_minorities(
            left_stack,
            right_stack,
            above_matrix.formation_id if above_matrix is not None else None,
            below_matrix.formation_id if below_matrix is not None else None,
        ):
            if minority.kind == "lens":
                target = left_lenses if minority.unit.side == "left" else right_lenses
                target.append(
                    _ExtractedLens(
                        body_id=minority.unit.body_id,
                        formation_id=minority.unit.formation_id,
                        depth_top_m=minority.unit.own_top_depth,
                        depth_base_m=minority.unit.own_base_depth,
                    )
                )
            else:
                # Onlap minorities always carry their bracket edge (TS:
                # ``min.edge!``).
                assert minority.edge is not None, (
                    "onlap minority must carry its bracket edge (TS: min.edge!)"
                )
                interval_onlaps.append(
                    _IntervalOnlap(
                        unit=minority.unit,
                        edge=minority.edge,
                        top_iface=replace(interval_top),
                        base_iface=replace(interval_base),
                    )
                )

        pinches: list[_PinchUnit] = [*left_stack, *right_stack]

        pinch_pool = pinches
        if is_floor:
            # Too-shallow carry-through (Slice 2): a unit whose TOP is at/below
            # the shallower column's deepest data lies entirely in
            # "no-neighbour-data" depth — render it as a full-gap-width flat
            # band (the deep data governs the whole gap below the shallow test)
            # instead of pinching to the shallow neighbour.  A data gap is not
            # a pinch-out.
            shallow_floor = min(left_floor, right_floor)
            carry: list[_PinchUnit] = []
            rest: list[_PinchUnit] = []
            for p in pinches:
                if p.own_top_depth >= shallow_floor - EPS:
                    carry.append(p)
                else:
                    rest.append(p)
            # The carry units all sit on the DEEPER column (they're below the
            # shallow floor); the shallow column has no data there.  The
            # carried band must span from the SHALLOW column's floor (its data
            # ends) down — its top SLOPES from the shallow floor (shallow side)
            # to the carry unit's own top (deep side).  A flat full-width top
            # (the old behaviour) left a wedge between the shallow floor and a
            # deeper carry top either uncovered (gap) or, with the deepest-
            # floor interval base, filled by a rest-pinch dipping in (overlap —
            # CS1 gap-11).  When the carry top equals the shallow floor (CT1)
            # the slope is flat, so CT1 is unchanged.
            carry.sort(key=lambda p: p.own_top_depth)  # shallowest carry first
            shallow_is_left = left_floor <= right_floor
            shallow_surface = left_surface if shallow_is_left else right_surface
            shallow_floor_elev = shallow_surface - shallow_floor
            for ci, p in enumerate(carry):
                deep_surface = left_surface if p.side == "left" else right_surface
                deep_top_elev = deep_surface - p.own_top_depth
                deep_base_elev = deep_surface - p.own_base_depth
                # Only the SHALLOWEST carry unit's top reaches the shallow
                # floor; deeper carry units stack flat below it (a fine
                # approximation for the rare multi-carry stack).
                shallow_top_elev = shallow_floor_elev if ci == 0 else deep_top_elev
                # Fraction 0 = left column edge, 1 = right.  Build the quad so
                # the DEEP side carries the unit's own elevations and the
                # SHALLOW side its top reaches the shallow floor (sloped top),
                # with a flat full-width base.
                if p.side == "left":
                    polygon = [
                        PartitionPoint(fraction=0, elevation=deep_top_elev),
                        PartitionPoint(fraction=1, elevation=shallow_top_elev),
                        PartitionPoint(fraction=1, elevation=deep_base_elev),
                        PartitionPoint(fraction=0, elevation=deep_base_elev),
                    ]
                else:
                    polygon = [
                        PartitionPoint(fraction=0, elevation=shallow_top_elev),
                        PartitionPoint(fraction=1, elevation=deep_top_elev),
                        PartitionPoint(fraction=1, elevation=deep_base_elev),
                        PartitionPoint(fraction=0, elevation=deep_base_elev),
                    ]
                regions.append(
                    PartitionRegion(
                        formation_id=p.formation_id,
                        body_id=p.body_id,
                        kind="quad",
                        polygon=polygon,
                    )
                )
            pinch_pool = rest
            # The remaining pinches tile ONLY above the carried bands — clamp
            # their interval base to the carried band's (sloped) top so they
            # meet it instead of filling down into it.
            if len(carry) > 0 and len(rest) > 0:
                carry_top0 = carry[0]
                interval_base = _clamp_iface(
                    _Interface(left_depth=shallow_floor, right_depth=carry_top0.own_top_depth)
                    if shallow_is_left
                    else _Interface(left_depth=carry_top0.own_top_depth, right_depth=shallow_floor),
                    interval_top,
                )

        # "One-sided" when every remaining pinch is on the same column — only
        # then can the matrix close cleanly to a single apex.
        pinch_sides = {p.side for p in pinch_pool}
        one_side = pinch_pool[0].side if len(pinch_sides) == 1 else None
        if (
            len(pinch_pool) > 0
            and one_side is not None
            and (above_matrix is not None or below_matrix is not None)
        ):
            regions.extend(
                _emit_one_sided_pinch(
                    pinch_pool,
                    one_side,
                    interval_top,
                    interval_base,
                    above_matrix,
                    below_matrix,
                    left_surface,
                    right_surface,
                    INTERIOR_PINCH_FRACTION,
                )
            )
        else:
            # ``bracketed`` (correlated bands above AND below) enables the
            # mismatched-matrix facies seam; surface/floor intervals stay
            # weighted.
            bracketed = above_matrix is not None and below_matrix is not None
            regions.extend(
                _emit_interval(
                    pinch_pool, interval_top, interval_base, left_surface, right_surface, bracketed
                )
            )

        # Emit the quad (if not the floor sentinel).
        if not is_floor:
            mli, mri = matched_pairs[pair_idx]
            lu = left_units[mli]
            ru = right_units[mri]
            quad_top = _clamp_iface(
                _Interface(left_depth=lu.top_depth_m, right_depth=ru.top_depth_m),
                prev_quad_base,
            )
            quad_base = _clamp_iface(
                _Interface(left_depth=lu.base_depth_m, right_depth=ru.base_depth_m),
                quad_top,
            )
            left_h = quad_base.left_depth - quad_top.left_depth
            right_h = quad_base.right_depth - quad_top.right_depth
            if left_h >= EPS or right_h >= EPS:
                regions.append(
                    PartitionRegion(
                        formation_id=lu.formation_id,
                        body_id=lu.body_id,
                        kind="quad",
                        polygon=_build_quad_polygon(
                            quad_top, quad_base, left_surface, right_surface
                        ),
                    )
                )
                prev_quad_base = quad_base
                prev_quad_formation_id = lu.formation_id
                prev_quad_body_id = lu.body_id
            else:
                prev_quad_base = quad_top
            prev_match_li = mli
            prev_match_ri = mri

    # -------------------------------------------------------------------------
    # Step 3a: Append onlap regions.
    #
    # An onlap laps against ONE bracket tie-line — anchored flat on its source
    # column, tapering to a tip on the bracket interface.  It overlays the
    # connected matrix band (emitted as kind:'lens', excluded from the tiling
    # invariant), so it must come AFTER the main regions in array order.
    # -------------------------------------------------------------------------
    for onlap in interval_onlaps:
        regions.append(
            PartitionRegion(
                formation_id=onlap.unit.formation_id,
                body_id=onlap.unit.body_id,
                kind="lens",
                overlay_tier="onlap",
                polygon=_build_onlap_polygon(
                    onlap.unit,
                    onlap.edge,
                    onlap.top_iface,
                    onlap.base_iface,
                    left_surface,
                    right_surface,
                ),
            )
        )

    # -------------------------------------------------------------------------
    # Step 3: Append extracted lens regions.
    #
    # Each lens is a horizontal pinch-out triangle that overlays its enclosing
    # matrix quad.  The apex elevation is the lens's OWN mid-elevation so it
    # terminates at its own stratigraphic level (horizontal), not along the
    # dipping enclosing interfaces.  The overlay draws these on top of the
    # main regions (array order) so the lens colour is visible over the
    # matrix.  These regions deliberately overlap their matrix and are
    # excluded from the tiling invariant.
    # -------------------------------------------------------------------------
    for lens in left_lenses:
        top_elev = left_surface - lens.depth_top_m
        base_elev = left_surface - lens.depth_base_m
        apex = (
            lens_apex_overrides.get(lens_apex_override_key(lens.body_id, gap_index))
            if lens.body_id and lens_apex_overrides is not None
            else None
        )
        regions.append(
            PartitionRegion(
                formation_id=lens.formation_id,
                body_id=lens.body_id,
                kind="lens",
                overlay_tier="lens",
                polygon=_build_left_lens_polygon(top_elev, base_elev, apex),
            )
        )
    for lens in right_lenses:
        top_elev = right_surface - lens.depth_top_m
        base_elev = right_surface - lens.depth_base_m
        apex = (
            lens_apex_overrides.get(lens_apex_override_key(lens.body_id, gap_index))
            if lens.body_id and lens_apex_overrides is not None
            else None
        )
        regions.append(
            PartitionRegion(
                formation_id=lens.formation_id,
                body_id=lens.body_id,
                kind="lens",
                overlay_tier="lens",
                polygon=_build_right_lens_polygon(top_elev, base_elev, apex),
            )
        )

    # Subtract each lens/onlap overlay out of the matrix it sits in, so the
    # gap is a TRUE volumetric partition (every point in exactly one region) —
    # required by the 3D extraction, which assigns each CPT point to exactly
    # one body.
    _carve_overlays(regions)

    return regions


# ---------------------------------------------------------------------------
# Whole-section resolve
# ---------------------------------------------------------------------------


def compute_section_fill(
    columns: Sequence[PartitionColumn],
    edges: Sequence[CorrelationEdge] = (),
    lens_apex_overrides: Mapping[str, LensApexOverride] | None = None,
) -> list[SectionRegion]:
    """Resolve the WHOLE section at once into partition regions, per gap.

    PER-GAP, PER-SIDE resolve (owner directive 2026-06-09): each gap is
    self-contained.  A unit's shape toward its LEFT neighbour and toward its
    RIGHT neighbour are independent (it can band one way, pinch the other),
    so each gap reduces FRESH COPIES of its two columns against EACH OTHER —
    no shared per-column state carried between gaps.  The reduce pulls only
    the lenses (units uncorrelated to the facing neighbour on both contacts)
    and merges the matrix around them; bands + onlaps are shaped by
    ``_emit_gap``.

    Rendering stays per-gap (the column strips interrupt the fill); each
    region is tagged with its ``gap_index`` so the overlay maps it with that
    gap's column edges.

    Parameters
    ----------
    columns : Sequence[PartitionColumn]
        The section's columns, left→right (along-section order).  Empty
        columns are skipped.  Each column's ``units`` must be sorted by
        ``top_depth_m``.
    edges : Sequence[CorrelationEdge]
        The APPROVED correlation edges (layer-id pairs).  Two units band iff
        an edge connects their ``layer_id``s; geometry only fills the
        uncorrelated remainder.
    lens_apex_overrides : Mapping[str, LensApexOverride] | None
        Optional per-body apex shaping (keyed by ``lens_apex_override_key``).

    Returns
    -------
    list[SectionRegion]
        All gaps' regions, each tagged with ``gap_index``.
    """

    # Build the edge lookup once (order-independent layer-id pair key).
    def edge_key(a: str, b: str) -> str:
        """Order-independent composite key for a layer-id pair."""
        return f"{a}|{b}" if a < b else f"{b}|{a}"

    edge_set = {edge_key(e.a, e.b) for e in edges}

    def correlated(a: str, b: str) -> bool:
        """True iff an approved correlation edge directly connects ``a`` and ``b``."""
        return edge_key(a, b) in edge_set

    # Drop empty columns; a gap is between two consecutive non-empty columns.
    # Per-unit copies (TS ``{ ...u }``) keep the caller's inputs untouched.
    cols: list[tuple[float, list[PartitionUnit]]] = [
        (c.surface_elev_m, [replace(u) for u in c.units]) for c in columns if len(c.units) > 0
    ]
    if len(cols) < 2:
        return []
    for _, units in cols:
        _close_column_gaps(units)

    out: list[SectionRegion] = []
    for i in range(len(cols) - 1):
        left_surface, left_src = cols[i]
        right_surface, right_src = cols[i + 1]
        left_units = [replace(u) for u in left_src]
        right_units = [replace(u) for u in right_src]
        left_ids = {u.layer_id for u in left_units}
        right_ids = {u.layer_id for u in right_units}
        lenses_left = _reduce_column(left_units, right_ids, correlated)
        lenses_right = _reduce_column(right_units, left_ids, correlated)
        _collapse_adjacent_same_formation(left_units)
        _collapse_adjacent_same_formation(right_units)
        gap_regions = _emit_gap(
            left_units,
            left_surface,
            right_units,
            right_surface,
            lenses_left,
            lenses_right,
            correlated,
            lens_apex_overrides,
            i,
        )
        for r in gap_regions:
            out.append(
                SectionRegion(
                    formation_id=r.formation_id,
                    body_id=r.body_id,
                    kind=r.kind,
                    polygon=r.polygon,
                    overlay_tier=r.overlay_tier,
                    gap_index=i,
                )
            )
    return out
