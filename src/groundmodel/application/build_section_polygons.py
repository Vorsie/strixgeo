"""Use case — resolve a drawn section partition into exportable polygons.

The 2-D partition fill is computed in the renderer (``computeSectionFill``)
and reaches the backend as a POSTed ``SectionPartitionInput``, exactly as
it already does for the 3-D voxel build. Its regions are expressed in
**gap-local fractions**: 0 at the gap's left column, 1 at its right. A
downstream tool cannot use that — D-Stability wants metres along the
section — so this use case converts fractions to absolute along-distances
and attaches each region's unit identity from the formation row.

Why the partition is POSTed rather than derived here
----------------------------------------------------
The section is the editing surface: what the engineer sees filled IS the
model, including every pinch-out, lens and onlap the 2/1/0 contact model
produced. Re-deriving polygons on the backend from formation contacts
would be a second, simpler, DIFFERENT partition — a plausible geometry
that disagrees with the screen. So the renderer sends what it drew, and
this use case only resolves coordinates and identities.

The linear-in-``along_m`` mapping is the same one
``domain/services/voxel_litho`` applies when it maps gap fractions onto
the line between consecutive columns, so a D-Stability export and a 3-D
build of one section describe the same ground.

Per CLAUDE.md "Architecture": this lives in the application layer so the
infrastructure-layer exporters never touch the DB.
"""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.section_polygon_set import (
    SectionPolygon,
    SectionPolygonSet,
    SectionPolygonUnit,
)
from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# A gap needs a column on each side. Fewer columns than this and the
# partition has no gap for any region to reference.
MIN_COLUMNS_FOR_A_GAP = 2


class BuildSectionPolygons(GroundModelLogger):
    """Turn a renderer-drawn section partition into a ``SectionPolygonSet``."""

    def __init__(
        self,
        session: AsyncSession,
        formation_repository: GeologyRepository | None = None,
    ) -> None:
        """Initialise with an active async session.

        Parameters
        ----------
        session : AsyncSession
            Active database session, used to build the default
            repository.
        formation_repository : GeologyRepository | None
            Repository override. Present so the conversion can be unit
            tested without a database — the production path leaves it
            ``None`` and gets a ``GeologyRepository`` over ``session``.
        """
        super().__init__(__name__)
        self._session = session
        self._formations = (
            formation_repository if formation_repository is not None else GeologyRepository(session)
        )

    async def execute(
        self,
        *,
        snapshot: SectionSnapshot,
        partition: SectionPartitionInput,
    ) -> SectionPolygonSet:
        """Resolve the partition against the project's formations.

        Parameters
        ----------
        snapshot : SectionSnapshot
            The section's metadata, already scope-guarded by the caller
            (project / section / model resolution + the metric-CRS
            check). Supplies project name, section name, length, CRS and
            vertical datum.
        partition : SectionPartitionInput
            The drawn fill as the renderer produced it — columns with
            their along-distances, and regions in gap-local fractions.

        Returns
        -------
        SectionPolygonSet
            Absolute ``(along_m, elevation_m)`` rings plus the units
            they reference. ``polygons`` is empty when nothing in the
            partition resolved; the exporters refuse that rather than
            writing an empty artefact.
        """
        self.info(
            f"Building section polygons: section={snapshot.section_id} "
            f"columns={len(partition.columns)} regions={len(partition.regions)}"
        )

        formations = await self._formations.list_formations(snapshot.project_id)
        formation_by_id = {formation.id: formation for formation in formations}

        column_positions = tuple(float(column.along_m) for column in partition.columns)
        if len(column_positions) < MIN_COLUMNS_FOR_A_GAP:
            self.warning(
                f"Section {snapshot.section_id} partition has {len(column_positions)} "
                f"column(s) — a gap needs {MIN_COLUMNS_FOR_A_GAP}, so none of its "
                f"{len(partition.regions)} region(s) can be placed"
            )
            return self._empty(snapshot, column_positions)

        polygons, dropped = self._convert_regions(
            partition.regions, column_positions, formation_by_id, snapshot.section_id
        )
        units = self._units_in_use(polygons, formation_by_id)

        if dropped:
            self.warning(
                f"Section {snapshot.section_id}: {dropped} of {len(partition.regions)} "
                f"region(s) dropped while resolving the partition; "
                f"{len(formation_by_id)} formation(s) available in the project"
            )
        self.success(
            f"Section polygons built: section={snapshot.section_id} "
            f"polygons={len(polygons)} units={len(units)} "
            f"columns={len(column_positions)}"
        )
        return SectionPolygonSet(
            project_id=snapshot.project_id,
            project_name=snapshot.project_name,
            section_id=snapshot.section_id,
            section_name=snapshot.section_name,
            section_length_m=snapshot.section_length_m,
            crs_epsg=snapshot.crs_epsg,
            vertical_datum_label=snapshot.vertical_datum_label,
            column_positions_m=column_positions,
            units=units,
            polygons=polygons,
        )

    def _convert_regions(
        self,
        regions: tuple[RegionInput, ...],
        column_positions: tuple[float, ...],
        formation_by_id: Mapping[UUID, GeologicalFormationOrm],
        section_id: UUID,
    ) -> tuple[tuple[SectionPolygon, ...], int]:
        """Map each region to absolute coordinates; count the ones that cannot be."""
        converted: list[SectionPolygon] = []
        dropped = 0
        total = len(regions)
        last_gap = len(column_positions) - 2
        for index, region in enumerate(regions, start=1):
            formation_id = _as_uuid(region.formation_id)
            if formation_id is None:
                dropped += 1
                self.warning(
                    f"[{index}/{total}] section {section_id}: region dropped — "
                    f"formation_id '{region.formation_id}' is not a UUID"
                )
                continue
            if formation_id not in formation_by_id:
                dropped += 1
                self.warning(
                    f"[{index}/{total}] section {section_id}: region dropped — "
                    f"formation {formation_id} is not in this project (gap="
                    f"{region.gap_index}); the partition outlived the model it was "
                    "drawn against"
                )
                continue
            if not 0 <= region.gap_index <= last_gap:
                dropped += 1
                self.warning(
                    f"[{index}/{total}] section {section_id}: region dropped — "
                    f"gap {region.gap_index} is outside the partition's 0..{last_gap} "
                    f"({len(column_positions)} column(s))"
                )
                continue
            left_m = column_positions[region.gap_index]
            right_m = column_positions[region.gap_index + 1]
            converted.append(
                SectionPolygon(
                    formation_id=formation_id,
                    points=tuple(
                        (left_m + fraction * (right_m - left_m), elevation_m)
                        for fraction, elevation_m in region.polygon
                    ),
                    gap_index=region.gap_index,
                    body_id=region.body_id,
                )
            )
            self.trace(
                f"[{index}/{total}] region placed: formation={formation_id} "
                f"gap={region.gap_index} span={left_m:.2f}..{right_m:.2f} m "
                f"vertices={len(region.polygon)}"
            )
        return tuple(converted), dropped

    def _units_in_use(
        self,
        polygons: tuple[SectionPolygon, ...],
        formation_by_id: Mapping[UUID, GeologicalFormationOrm],
    ) -> tuple[SectionPolygonUnit, ...]:
        """Declare only the units that actually fill something."""
        in_use = {polygon.formation_id for polygon in polygons}
        units = [
            SectionPolygonUnit(
                formation_id=formation.id,
                name=formation.name,
                nad_class=formation.nad_class,
                litho_main_soil_code=formation.litho_main_soil_code,
                color=formation.color,
                display_order=formation.display_order,
            )
            for formation_id, formation in formation_by_id.items()
            if formation_id in in_use
        ]
        units.sort(key=lambda unit: (unit.display_order, unit.name))
        return tuple(units)

    def _empty(
        self,
        snapshot: SectionSnapshot,
        column_positions: tuple[float, ...],
    ) -> SectionPolygonSet:
        """A set with metadata but no geometry — the exporters refuse it."""
        return SectionPolygonSet(
            project_id=snapshot.project_id,
            project_name=snapshot.project_name,
            section_id=snapshot.section_id,
            section_name=snapshot.section_name,
            section_length_m=snapshot.section_length_m,
            crs_epsg=snapshot.crs_epsg,
            vertical_datum_label=snapshot.vertical_datum_label,
            column_positions_m=column_positions,
        )


def _as_uuid(raw: str) -> UUID | None:
    """Parse a payload-supplied formation id, or ``None`` when it is not one."""
    try:
        return UUID(raw)
    except (ValueError, AttributeError, TypeError):
        return None
