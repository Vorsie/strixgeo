"""Pydantic request schemas for the voxel litho builder (``POST .../build-voxel``).

These mirror the frozen domain value objects in
``groundmodel.domain.services.voxel_litho.voxel_types`` one-for-one, in
snake_case so the frontend payload (``desktop/.../utils/buildVoxelRequest.ts``)
round-trips unchanged.  The API layer validates the JSON into these Pydantic
models, then :meth:`VoxelBuildRequest.to_domain` converts them into the frozen
domain value objects the use case consumes (the clean-architecture boundary:
the domain takes value objects, not Pydantic).

The four request schemas form one cohesive vocabulary (the build-request
contract), so they are grouped in this single module — matching the domain-side
``voxel_types.py`` grouping (the approved exception to "one class per file").
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from groundmodel.api.schemas.project.gapless_build_report import GaplessClauseInputSchema
from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


class RegionInputSchema(StrictRequestModel):
    """One filled region of a 2-D section partition (mirrors ``RegionInput``).

    Attributes
    ----------
    formation_id : str
        The lithostratigraphic formation this region belongs to.
    body_id : str or None
        The resolver-assigned body identity; ``None`` when not part of a
        correlated body.
    polygon : list of (float, float)
        The region outline as ``(fraction, elevation_m)`` points — ``fraction``
        is the gap-local horizontal position in ``[0, 1]``, ``elevation_m`` the
        absolute elevation (mTAW).
    gap_index : int
        Zero-based index of the gap's LEFT column within the section's column
        list.
    kind : {'quad', 'pinch', 'lens'} or None
        How the 2-D engine terminated this region — the 2/1/0 gesture
        semantics. ``None`` only on a payload written before debt #256.
    overlay_tier : {'onlap', 'lens'} or None
        Carve tier of an overlay region; ``None`` on a main region.
    tied_band_base : float or None
        Base elevation (mTAW) fixed by an explicit user correlation.
    tie_clipped : bool
        Region deliberately kept only ABOVE a cross-lithology tie.

    Notes
    -----
    The four classification fields are optional so a stored build generation
    or a bundle written before debt #256 still loads and still builds.
    """

    formation_id: str
    body_id: str | None = None
    polygon: list[tuple[float, float]]
    gap_index: int
    kind: Literal["quad", "pinch", "lens"] | None = None
    overlay_tier: Literal["onlap", "lens"] | None = None
    tied_band_base: float | None = None
    tie_clipped: bool = False
    # Layer-level provenance for the body recompute (owner ruling 2026-08-12):
    # connectivity evidence must name LAYERS, never bodies — the recompute
    # restamps body ids, so body-labelled evidence fed back on itself and
    # oscillated. The voxel build ignores it; additive, default empty.
    layer_ids: list[str] = Field(default_factory=list)

    def to_domain(self) -> RegionInput:
        """Convert to the frozen domain :class:`RegionInput` value object."""
        return RegionInput(
            formation_id=self.formation_id,
            body_id=self.body_id,
            polygon=tuple((float(p[0]), float(p[1])) for p in self.polygon),
            gap_index=self.gap_index,
            kind=self.kind,
            overlay_tier=self.overlay_tier,
            tied_band_base=self.tied_band_base,
            tie_clipped=self.tie_clipped,
            layer_ids=tuple(self.layer_ids),
        )


class SectionColumnInputSchema(StrictRequestModel):
    """One investigation column of a section (mirrors ``SectionColumnInput``).

    Attributes
    ----------
    investigation_id : str
        Identifier of the CPT / borehole this column represents.
    along_m : float
        Distance of the column along the section line in metres, from the start.
    world_x : float
        Easting of the column in metres (project CRS).
    world_y : float
        Northing of the column in metres (project CRS).
    """

    investigation_id: str
    along_m: float
    world_x: float
    world_y: float

    def to_domain(self) -> SectionColumnInput:
        """Convert to the frozen domain :class:`SectionColumnInput` value object."""
        return SectionColumnInput(
            investigation_id=self.investigation_id,
            along_m=float(self.along_m),
            world_x=float(self.world_x),
            world_y=float(self.world_y),
        )


class SectionPartitionInputSchema(StrictRequestModel):
    """One section's full 2-D partition (mirrors ``SectionPartitionInput``).

    Attributes
    ----------
    start_x, start_y, end_x, end_y : float
        The section line's endpoints in metres (project CRS).
    columns : list of SectionColumnInputSchema
        The on-section investigation columns, ordered along the line.
    regions : list of RegionInputSchema
        The filled partition regions; each references the column pair it fills.
    """

    start_x: float
    start_y: float
    end_x: float
    end_y: float
    columns: list[SectionColumnInputSchema]
    regions: list[RegionInputSchema]

    def to_domain(self) -> SectionPartitionInput:
        """Convert to the frozen domain :class:`SectionPartitionInput` value object."""
        return SectionPartitionInput(
            start_x=float(self.start_x),
            start_y=float(self.start_y),
            end_x=float(self.end_x),
            end_y=float(self.end_y),
            columns=tuple(c.to_domain() for c in self.columns),
            regions=tuple(r.to_domain() for r in self.regions),
        )


class VoxelBuildRequest(StrictRequestModel):
    """The full payload POSTed to ``.../litho-solids/build-voxel``.

    Mirrors the frontend ``VoxelBuildRequest`` interface: the validated
    per-section 2-D partitions + the voxel grid spacing.  The payload IS the
    source of truth for the build (the backend never re-derives the partition);
    the use case labels a 3-D grid from it and extracts watertight body meshes.

    The grid may be CUBIC (``grid_spacing_m`` only) or ANISOTROPIC
    (``horizontal_spacing_m`` for X/Y + ``vertical_spacing_m`` for Z).  Geology
    is thin-layered vertically, so a fine Z over a coarse X/Y catches thin layers
    without exploding the X/Y voxel count.  Both anisotropic fields are optional
    and fall back to ``grid_spacing_m`` when absent, so a legacy payload carrying
    only ``grid_spacing_m`` still builds a cubic grid (additive, backwards-safe).

    Precedence — what wins when an explicit axis spacing AND ``grid_spacing_m``
    are both present
    ------------------------------------------------------------------------
    Each axis resolves INDEPENDENTLY (see :attr:`effective_horizontal_spacing_m`
    / :attr:`effective_vertical_spacing_m`):

    * ``horizontal_spacing_m`` (when set) takes precedence over ``grid_spacing_m``
      for the X/Y (map-plane) axes.
    * ``vertical_spacing_m`` (when set) takes precedence over ``grid_spacing_m``
      for the Z (elevation) axis.
    * ``grid_spacing_m`` is the cubic fallback used only for whichever axis has
      NO explicit override.

    So ``{grid_spacing_m: 2, horizontal_spacing_m: 3}`` resolves to **3 m X/Y, 2 m
    Z** — ``grid_spacing_m`` is ignored for X/Y (the explicit horizontal wins) and
    serves only as the Z fallback (no explicit vertical given).

    Attributes
    ----------
    sections : list of SectionPartitionInputSchema
        One partition per section in the litho model.
    grid_spacing_m : float
        The cubic / fallback voxel grid spacing in metres (must be positive).
        Used for any axis whose explicit spacing field is absent.
    horizontal_spacing_m : float or None
        The X/Y (map-plane) voxel spacing in metres.  ``None`` → fall back to
        ``grid_spacing_m``.  Must be positive when set.
    vertical_spacing_m : float or None
        The Z (elevation) voxel spacing in metres.  ``None`` → fall back to
        ``grid_spacing_m``.  Must be positive when set.
    gapless_2d : list of GaplessClauseInputSchema or None
        The renderer's clauses 1-4 of the seven-clause gapless gate (computed
        at fill time, from the same partition this payload carries).  ``None``
        for a lithology build (which runs no packing fill) or a client older
        than the gate — the backend then reports clauses 1-4 as
        ``not-evaluated`` rather than fabricating a pass.  Deliberately NOT
        folded into the model-level partition checksum
        (``BuildVoxelLithoModel._partition_checksum``): the gate's own findings
        never change what the 3-D model IS, only what is reported about it, so
        a changed clause 1-4 finding on an otherwise-unchanged payload must not
        bust the labelling cache.
    """

    sections: list[SectionPartitionInputSchema] = Field(default_factory=list)
    grid_spacing_m: float = Field(gt=0.0)
    horizontal_spacing_m: float | None = Field(default=None, gt=0.0)
    vertical_spacing_m: float | None = Field(default=None, gt=0.0)
    gapless_2d: list[GaplessClauseInputSchema] | None = None

    @property
    def effective_horizontal_spacing_m(self) -> float:
        """The X/Y spacing the use case should build with.

        ``horizontal_spacing_m`` takes precedence when explicitly set; otherwise
        falls back to ``grid_spacing_m`` (the cubic / legacy fallback).  This axis
        resolves independently of Z, so ``grid_spacing_m`` is ignored here whenever
        a horizontal override is present.

        Returns
        -------
        float
            The resolved horizontal voxel spacing in metres (always positive).
        """
        return (
            self.horizontal_spacing_m
            if self.horizontal_spacing_m is not None
            else self.grid_spacing_m
        )

    @property
    def effective_vertical_spacing_m(self) -> float:
        """The Z spacing the use case should build with.

        ``vertical_spacing_m`` takes precedence when explicitly set; otherwise
        falls back to ``grid_spacing_m`` (the cubic / legacy fallback).  This axis
        resolves independently of X/Y, so ``grid_spacing_m`` is ignored here
        whenever a vertical override is present.

        Returns
        -------
        float
            The resolved vertical voxel spacing in metres (always positive).
        """
        return (
            self.vertical_spacing_m if self.vertical_spacing_m is not None else self.grid_spacing_m
        )

    def to_domain_sections(self) -> list[SectionPartitionInput]:
        """Convert every section to its frozen domain value object.

        Returns
        -------
        list[SectionPartitionInput]
            The domain-layer sections the voxel use case consumes.
        """
        return [s.to_domain() for s in self.sections]

    def to_gapless_2d_dicts(self) -> list[dict[str, Any]] | None:
        """Convert ``gapless_2d`` to plain dicts for the application layer.

        The assembler that re-stamps these clauses lives in the application
        layer, which must not import API (Pydantic) schemas — so the boundary
        crossing happens here, on the schema side, not there.

        Returns
        -------
        list of dict, or None
            One dict per clause (``model_dump()`` of each
            ``GaplessClauseInputSchema``), or ``None`` when the field itself
            was never sent (preserved, not coerced to ``[]``, so the use case
            can tell "sent nothing" from "sent an empty list" if that ever
            matters).
        """
        if self.gapless_2d is None:
            return None
        return [clause.model_dump() for clause in self.gapless_2d]
