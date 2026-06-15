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

from pydantic import BaseModel, Field

from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


class RegionInputSchema(BaseModel):
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
    """

    formation_id: str
    body_id: str | None = None
    polygon: list[tuple[float, float]]
    gap_index: int

    def to_domain(self) -> RegionInput:
        """Convert to the frozen domain :class:`RegionInput` value object."""
        return RegionInput(
            formation_id=self.formation_id,
            body_id=self.body_id,
            polygon=tuple((float(p[0]), float(p[1])) for p in self.polygon),
            gap_index=self.gap_index,
        )


class SectionColumnInputSchema(BaseModel):
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


class SectionPartitionInputSchema(BaseModel):
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


class VoxelBuildRequest(BaseModel):
    """The full payload POSTed to ``.../litho-solids/build-voxel``.

    Mirrors the frontend ``VoxelBuildRequest`` interface: the validated
    per-section 2-D partitions + the voxel grid spacing.  The payload IS the
    source of truth for the build (the backend never re-derives the partition);
    the use case labels a 3-D grid from it and extracts watertight body meshes.

    Attributes
    ----------
    sections : list of SectionPartitionInputSchema
        One partition per section in the litho model.
    grid_spacing_m : float
        Voxel grid spacing in metres (must be positive).
    """

    sections: list[SectionPartitionInputSchema] = Field(default_factory=list)
    grid_spacing_m: float = Field(gt=0.0)

    def to_domain_sections(self) -> list[SectionPartitionInput]:
        """Convert every section to its frozen domain value object.

        Returns
        -------
        list[SectionPartitionInput]
            The domain-layer sections the voxel use case consumes.
        """
        return [s.to_domain() for s in self.sections]
