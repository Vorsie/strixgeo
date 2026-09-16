"""Frozen value objects for the voxel-litho build-request contract.

These are the data exchanged between the frontend (which computes the
validated 2-D section partition via ``computeSectionFill``) and the
backend voxel builder (which labels a 3-D grid and extracts watertight
body meshes).  They are pure data containers — no I/O, no logging, no
framework dependencies.

The request-side objects (:class:`RegionInput`, :class:`SectionColumnInput`,
:class:`SectionPartitionInput`) mirror the frontend ``SectionRegion`` /
fence-column shapes one-for-one, in snake_case so they round-trip the API
JSON unchanged.  :class:`LabelGrid` is the intermediate the labeller
produces and the mesher consumes, and it carries a :class:`LabelReport` of
the structural anomalies the labelling had to paper over.

Notes
-----
The approved exception to "one class per file" applies here: all the
value objects are grouped in this single module because they form a
single cohesive vocabulary (the build-request contract), analogous to
``shared/exceptions.py``.  Constants (if needed later) go in a sibling
``voxel_constants.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np


@dataclass(frozen=True)
class RegionInput:
    """One filled region of a 2-D section partition (mirrors ``SectionRegion``).

    A region is a single-lithology polygon the frontend's
    ``computeSectionFill`` produced for one gap of one section.  Its
    polygon points are expressed in the gap's local horizontal fraction
    (0 = left column edge, 1 = right column edge) against absolute
    elevation, exactly as the frontend ``PartitionPoint`` carries them.

    Parameters
    ----------
    formation_id : str
        The lithostratigraphic formation this region belongs to
        (``SectionRegion.formationId``).  Drives the body's lithology
        colour and the ``formation_by_body`` lookup on :class:`LabelGrid`.
    body_id : str or None
        The resolver-assigned body identity
        (``SectionRegion.bodyId``); ``None`` when the region's units are
        not part of a correlated body.
    polygon : tuple of (float, float)
        The region outline as ``(fraction, elevation_m)`` points.
        ``fraction`` is the gap-local horizontal position in ``[0, 1]``
        (0 = the gap's left column, 1 = its right column); ``elevation_m``
        is the absolute elevation (mTAW) of the point.
    gap_index : int
        Zero-based index of the gap's LEFT column within the section's
        column list — i.e. the gap between column ``gap_index`` and
        column ``gap_index + 1`` (matches ``SectionRegion.gapIndex``).
    kind : {'quad', 'pinch', 'lens'} or None
        How the 2-D engine terminated this region — ``'quad'`` for a body
        present on both columns, ``'pinch'`` for one present on a single
        column and cut inside its interval, ``'lens'`` for an enclosed
        minority overlaying its matrix.  This is the 2/1/0 gesture
        semantics; ``None`` only for a payload written before debt #256,
        where the field did not cross the API boundary at all.
    overlay_tier : {'onlap', 'lens'} or None
        For an overlay region, which carve tier it belongs to: ``'onlap'``
        laps one bracket tie-line, ``'lens'`` is fully enclosed by its
        matrix.  ``None`` on a main region, and on any pre-#256 payload.
    tied_band_base : float or None
        Elevation (mTAW) that an EXPLICIT user correlation fixed for this
        region's base.  Owner directive 2026-07-08: a user correlation is
        absolute, so the shallow-TD cap must not chop it flat.  ``None``
        when no correlation fixes the base.
    tie_clipped : bool
        ``True`` when the 2-D pass deliberately kept this region only
        ABOVE a sloping cross-lithology tie, so it must never be merged
        back across that tie.
    layer_ids : tuple of str
        The ``litho_layer`` ids whose units produced this region. Carried for
        the body recompute (owner ruling 2026-08-12): geometric-connectivity
        evidence must name LAYERS, whose ids never change, never bodies,
        whose ids the recompute itself restamps — body-labelled evidence fed
        back on itself and oscillated (dogfeed 2026-08-12 evening). Empty on
        voxel-build payloads (the build never reads it) and on pre-existing
        stored payloads.

    Notes
    -----
    Every classification field is optional.  A stored build generation or a
    ``.gmproj`` bundle written before debt #256 carries only the first four
    attributes, and must stay loadable — refusing it would make an existing
    project unbuildable.
    """

    formation_id: str
    body_id: str | None
    polygon: tuple[tuple[float, float], ...]
    gap_index: int
    kind: Literal["quad", "pinch", "lens"] | None = None
    overlay_tier: Literal["onlap", "lens"] | None = None
    tied_band_base: float | None = None
    tie_clipped: bool = False
    layer_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class SectionColumnInput:
    """One investigation column of a section, with its canonical world position.

    The world coordinates come from ``buildProjectFence`` on the frontend,
    so the backend never re-projects: the section's gap fractions map onto
    the straight line between consecutive columns' ``(world_x, world_y)``.

    Parameters
    ----------
    investigation_id : str
        Identifier of the CPT / borehole this column represents.
    along_m : float
        Distance of the column along the section line in metres, measured
        from the section's start point.
    world_x : float
        Easting of the column in metres (project CRS, e.g. Lambert-72).
    world_y : float
        Northing of the column in metres (project CRS).
    """

    investigation_id: str
    along_m: float
    world_x: float
    world_y: float


@dataclass(frozen=True)
class SectionPartitionInput:
    """One section's full 2-D partition: its line, columns, and filled regions.

    This is the per-section unit the frontend POSTs.  The section line runs
    from ``(start_x, start_y)`` to ``(end_x, end_y)`` in project CRS; the
    columns sit on that line (their ``along_m`` measured from the start);
    each region's ``gap_index`` references a consecutive pair of those
    columns.

    Parameters
    ----------
    start_x : float
        Easting of the section line's start point in metres (project CRS).
    start_y : float
        Northing of the section line's start point in metres (project CRS).
    end_x : float
        Easting of the section line's end point in metres (project CRS).
    end_y : float
        Northing of the section line's end point in metres (project CRS).
    columns : tuple of SectionColumnInput
        The on-section investigation columns, ordered along the line
        (ascending ``along_m``).
    regions : tuple of RegionInput
        The filled partition regions for this section; each carries the
        ``gap_index`` of the column pair it fills.
    """

    start_x: float
    start_y: float
    end_x: float
    end_y: float
    columns: tuple[SectionColumnInput, ...]
    regions: tuple[RegionInput, ...]


@dataclass(frozen=True)
class InvestigationColumn:
    """One investigation's OWN observed pick stack at its true map location.

    A borehole / CPT feeds a section at its PROJECTED foot on the section
    line, but its true map ``(world_x, world_y)`` usually sits off to the
    side.  The voxel labeller's between-section blend at that true location
    can therefore disagree with the investigation's own observed log.  This
    value object carries that observed log so the labeller can HONOR it at
    the investigation's own grid column — labelling those voxels from the
    log itself within its observed depth range, and falling back to the
    section blend above its top / below its base (so a shallow log does not
    punch a hole through the deep fill).

    The ``intervals`` carry the resolver-assigned ``body_id`` (the same
    identity the section partitions and the resolver use), so the honored
    voxels group with the matching partition bodies in the mesher.

    Parameters
    ----------
    investigation_id : str
        Identifier of the CPT / borehole this column represents.
    world_x : float
        Easting of the investigation in metres (project CRS, e.g.
        Lambert-72) — its TRUE map location, not a section projection.
    world_y : float
        Northing of the investigation in metres (project CRS).
    intervals : tuple of (str, str, float, float)
        The observed body intervals, ordered top → bottom, as
        ``(body_id, formation_id, top_elev_m, base_elev_m)`` where the
        elevations are ABSOLUTE (mTAW, positive up; ``top_elev_m`` above
        ``base_elev_m``).  Empty when the investigation has no body-assigned
        accepted picks (it then contributes no override).
    kind : str, default ``"borehole"``
        The investigation kind — ``"cpt"`` or ``"borehole"`` (see
        :mod:`~groundmodel.domain.services.voxel_litho.honor_precedence`).  Decides
        which investigation is honored when two of them share one voxel column,
        which a regular grid can only fill from a single log.  Defaults to
        ``"borehole"``, the conservative choice: a column of unstated provenance
        never outranks a cone.
    """

    investigation_id: str
    world_x: float
    world_y: float
    intervals: tuple[tuple[str, str, float, float], ...]
    kind: str = "borehole"


@dataclass(frozen=True)
class LabelReport:
    """What the labelling had to paper over, so the caller can say it out loud.

    The labeller is a pure function with no logger of its own, and three of the
    situations below are invisible in the grid it returns: a closed void looks
    like a contact, a truncated log looks like a shallow one, and a column the
    fall-through rescued looks like any other column.  Each is counted here and
    logged by the application layer.

    Every field is zero / empty on a clean build, so a caller can treat a
    default-constructed report as "nothing to report".

    Parameters
    ----------
    beyond_fallthrough_columns : int
        Columns BEYOND every section whose nearest section had nothing to say at
        that position, so a farther one answered instead.  Not a defect — the
        deliberate defer stance — but the count says how much of the model's
        rim is carried by a section that is not the nearest.
    beyond_void_columns : int
        Columns inside the footprint that NO section could fill.  Each is a hole
        in a model the owner requires to be gapless, so any non-zero value is a
        finding, not a statistic.
    projection_tie_rescues : int
        Contests where two gaps of ONE section reached a query point at the same
        distance (to within the projection tie window) and the one carrying
        material was preferred over the empty one that fence order would have
        picked.
    layout_closed_voids : int
        Column-instances where an interior void wider than the 2-D engine's snap
        grid arrived on an input stack of the two-section blend and was closed by
        the cumulative layout.  What such a void SHOULD look like between two
        sections is an open geological ruling (docs/debt.md #268), so it is
        reported rather than interpreted.
    layout_closed_worst_m : float
        Height of the tallest such void, in metres; ``0.0`` when none was closed.
    layout_closed_worst_site : str or None
        Human-readable ``"section {index} gap {index}"`` of that tallest void, or
        ``None`` when none was closed.
    hairline_gaps_over_limit : int
        Interior gaps in a FINAL column stack taller than the hairline limit.
        A surviving void is legitimate (the partition said unknown), but one this
        tall is no longer the millimetre snapping of a flush contact.  This is the
        RESIDUE count (15 mm .. the action threshold): real but sub-actionable, it
        is noted, not reported as a violation — see ``hairline_gaps_actionable``.
    hairline_gaps_actionable : int
        Interior gaps of ONE VOXEL HEIGHT OR MORE (``>= voxel_vertical_m``) — a
        real hole the builder left unknown, since the builder closes only a void
        SHORTER than one voxel (owner ruling installer #41).  Clause 6
        (stack-voids) fails on THIS count, not on ``hairline_gaps_over_limit``.
        Because the close pass and this count share one threshold (the voxel
        height), no gap falls between "closed" and "reported".
    hairline_worst_m : float
        Height of the tallest interior gap in any final stack, in metres —
        reported whether or not it passed the limit, so the margin is visible.
    voxel_vertical_m : float
        The vertical voxel height (metres) this build used — the size threshold
        that both bounds the close pass (a void shorter than this is a sliver the
        builder closes) and names what clause 6 reports (a void of one voxel or
        more).  ``0.0`` on a report written before installer #41 or when no grid
        was labelled; the report assembler then falls back to
        :data:`~groundmodel.domain.services.voxel_litho.voxel_constants.STACK_VOID_ACTIONABLE_M`.
    logs_below_grid_floor : tuple of (str, float)
        ``(investigation_id, metres_below)`` for every honored investigation whose
        log reaches deeper than the grid floor and is therefore truncated.  The
        grid's elevation range comes from the section polygons alone, so a log
        deeper than every section has nowhere to be labelled.
    in_footprint_columns : int
        Every voxel column whose ``(x, y)`` passed the domain footprint gate —
        the DENOMINATOR for the gapless gate's clause 5 (column-totality).
    empty_in_footprint_columns : int
        In-footprint columns whose WRITTEN ``labels`` array ended up all void
        (``-1`` at every ``z``) — clause 5's numerator.  Deliberately NOT
        ``beyond_void_columns``: that counter increments only inside the
        un-bounded blend's BEYOND branch (:func:`_stack_at`), which the
        geology-bounded band path (:func:`_column_stack_geo`) never even calls,
        and a column it does count into can still end up labelled — an honored
        investigation's own log fills the observed range through
        :func:`_honored_column_labels` even when the section blend it falls
        back on (``stack``) came back empty.  So ``beyond_void_columns`` is a
        numerator for a narrower, different question ("did the un-bounded
        between/beyond blend answer here") and reusing it for clause 5 would
        both miss columns the geo-bounded path voided and wrongly count
        columns the honored path went on to fill.  This field instead measures
        the array the labeller actually wrote, once, after both the blend and
        the honored override have had their say.
    """

    beyond_fallthrough_columns: int = 0
    beyond_void_columns: int = 0
    projection_tie_rescues: int = 0
    layout_closed_voids: int = 0
    layout_closed_worst_m: float = 0.0
    layout_closed_worst_site: str | None = None
    hairline_gaps_over_limit: int = 0
    hairline_gaps_actionable: int = 0
    hairline_worst_m: float = 0.0
    voxel_vertical_m: float = 0.0
    logs_below_grid_floor: tuple[tuple[str, float], ...] = ()
    in_footprint_columns: int = 0
    empty_in_footprint_columns: int = 0


@dataclass(frozen=True)
class LabelGrid:
    """A labelled 3-D voxel grid: every cell tagged with the body that fills it.

    The grid axes are regular 1-D coordinate arrays; ``labels`` is the
    dense ``(nx, ny, nz)`` integer array of body indices.  This is the
    intermediate the labeller produces and the mesher consumes: a labelling
    of space is itself a partition, so the extracted body boundaries are
    watertight and faithful by construction.

    Indexing convention
    -------------------
    ``labels[i, j, k]`` is the body index (into :attr:`body_id_by_index`)
    of the voxel centred at world position ``(gx[i], gy[j], gz[k])``, with
    ``-1`` meaning void / unlabelled.  Therefore
    ``labels.shape == (len(gx), len(gy), len(gz))``.  Resolve a label to a
    body via ``body_id_by_index[labels[i, j, k]]`` (when the label is not
    ``-1``), and a body to its formation via
    ``formation_by_body[body_id]``.

    Parameters
    ----------
    gx : numpy.ndarray
        Shape ``(nx,)`` — the X-axis grid-node coordinates in metres
        (project CRS), ascending.
    gy : numpy.ndarray
        Shape ``(ny,)`` — the Y-axis grid-node coordinates in metres
        (project CRS), ascending.
    gz : numpy.ndarray
        Shape ``(nz,)`` — the Z-axis (elevation) grid-node coordinates in
        metres (project vertical datum), ascending.
    labels : numpy.ndarray
        Shape ``(nx, ny, nz)`` integer array of body indices; ``-1`` for
        void / unlabelled voxels.  Index ``i`` runs over ``gx``, ``j`` over
        ``gy``, ``k`` over ``gz``.
    body_id_by_index : tuple of str
        Maps a non-negative label value to its body_id string:
        ``body_id_by_index[label]`` is the body filling voxels labelled
        ``label``.
    formation_by_body : dict of str to str
        Maps each ``body_id`` to its ``formation_id`` (the body's
        lithology), so the mesher can colour each extracted body without
        re-walking the section regions.
    report : LabelReport
        The structural anomalies met while labelling.  Defaults to an
        all-clear report so a hand-built grid (tests, fixtures) needs no
        knowledge of it.
    """

    gx: np.ndarray
    gy: np.ndarray
    gz: np.ndarray
    labels: np.ndarray
    body_id_by_index: tuple[str, ...]
    formation_by_body: dict[str, str]
    report: LabelReport = LabelReport()


@dataclass(frozen=True)
class SectionReconciliation:
    """One section's per-gap swept-area comparison of the 2-D fill vs the 3-D grid.

    Clause 7 of the gapless gate (``"section-reconciliation"``) needs a check
    that is dimensionally sound — a bare area-vs-volume comparison has no
    defensible width — so both sides are measured as a SWEPT AREA in the
    vertical plane along the section's own column fence: at evenly spaced
    samples across every gap, the 2-D fill's classed height and the 3-D grid's
    labelled height are each multiplied by the metres of fence the sample
    represents and accumulated in square metres.  See
    :func:`~groundmodel.domain.services.voxel_litho.section_reconciliation.reconcile_sections`
    for the full algorithm.

    Parameters
    ----------
    section_index : int
        The section's position in the build payload.  Nothing backend-side
        carries a section's display name (the payload has none), so a clause-7
        finding names a section by this index plus its line endpoints — never
        a guessed name.
    start_x, start_y, end_x, end_y : float
        The section line's endpoints (metres, project CRS) — the other half
        of how a finding identifies its section.
    swept_2d_m2 : float
        Total classed area from the 2-D fill, summed over every gap sample:
        ``sum(h2 * step)`` where ``h2`` is the union height of the fill's
        regions at that sample and ``step`` is the fence-metres it represents.
    swept_3d_m2 : float
        The matching total read from the 3-D label grid: ``sum(h3 * step)``
        where ``h3`` is the labelled (non-void) height of the nearest grid
        column at that sample.
    budget_m2 : float
        The EXACT vertical-quantisation allowance: a contiguous run of height
        ``L`` sampled on a grid of pitch ``v`` differs from its true height by
        at most ``v`` (an arithmetic-progression counting bound), so ``runs``
        disjoint runs bound the sample's error by ``runs * v``; summed over
        every sample as ``runs_2d * v * step`` this is derived, not guessed.
    divergence_m2 : float
        ``abs(swept_2d_m2 - swept_3d_m2)`` — how far the two sides disagree.
    allowance_m2 : float
        ``budget_m2 + RECONCILE_RELATIVE_TOLERANCE * swept_2d_m2`` — the
        quantisation budget plus the owner-calibration-pending relative slack
        (see ``section_reconciliation_constants.RECONCILE_RELATIVE_TOLERANCE``).
    violated : bool
        ``divergence_m2 > allowance_m2`` — clause 7 fails for this section.
    worst_sample_along_m : float or None
        Fence-distance (metres from the section's first column, along the
        column-world polyline — NOT the same axis as ``along_m`` when columns
        were re-seated) of the single sample with the largest per-sample
        height divergence.  ``None`` when every sample in this section landed
        outside the model footprint.
    worst_sample_divergence_m : float
        That sample's height divergence, in metres (``abs(h2 - h3)``) — a
        vertical figure, unlike the area totals above, so a clause-7 finding
        can name a HEIGHT discrepancy at a PLACE, not just a total area.
    samples_outside_footprint : int
        Samples excluded from both sides because the model footprint does not
        reach them there.  Reported so an excluded sample is visible, never
        silently folded into (or out of) the divergence.
    samples_total : int
        Total samples taken across every gap of this section (including the
        excluded ones), for context on how much of the section was measured.
    """

    section_index: int
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    swept_2d_m2: float
    swept_3d_m2: float
    budget_m2: float
    divergence_m2: float
    allowance_m2: float
    violated: bool
    worst_sample_along_m: float | None
    worst_sample_divergence_m: float
    samples_outside_footprint: int
    samples_total: int
