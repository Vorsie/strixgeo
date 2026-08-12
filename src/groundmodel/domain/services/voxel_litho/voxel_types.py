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
produces and the mesher consumes.

Notes
-----
The approved exception to "one class per file" applies here: all four
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
    """

    gx: np.ndarray
    gy: np.ndarray
    gz: np.ndarray
    labels: np.ndarray
    body_id_by_index: tuple[str, ...]
    formation_by_body: dict[str, str]
