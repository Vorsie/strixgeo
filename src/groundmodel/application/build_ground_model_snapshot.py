"""Use case — materialise a ``GroundModelSnapshot`` from the DB.

Project-wide counterpart to ``BuildSectionSnapshot``. Where the
section snapshot projects investigations onto a single line, this
one keeps every CPT + borehole in its native (x, y, z) frame —
the right shape for Plaxis 3D's borehole + soillayer model, which
re-interpolates between boreholes itself.

The use case owns:

1. Loading the project + model + formations + contacts.
2. Loading every CPT + borehole in the project (lightweight list-
   item shape — no series, no children).
3. Grouping contacts by anchor (borehole_id XOR cpt_id), sorting
   each column's contacts top-down, deriving each layer's
   ``base_depth_m`` from the next-deeper contact (or the
   investigation's total depth for the deepest layer).
4. Emitting one ``LayerGeometry`` row per (column, formation) pair
   and one ``FormationDisplay`` row per formation that appears in
   the layer set.

The exporter never sees the DB — it receives the value object and
serialises it. Mirrors ``BuildSectionSnapshot``'s contract.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.ground_model_snapshot import (
    FormationDisplay,
    GroundModelSnapshot,
    LayerGeometry,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Fallback thickness used for the deepest layer at a column whose
# investigation has no recorded total depth. Half a metre is small
# enough that engineers re-running the export against a Plaxis model
# will notice + fix; large enough that the layer is non-degenerate
# (LayerGeometry's contract drops equal-depth rows).
_FALLBACK_BOTTOM_THICKNESS_M = 0.5


class BuildGroundModelSnapshot(GroundModelLogger):
    """Materialise the data needed to export a whole geological model."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active async session."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        app_project_id: UUID,
        model_id: UUID,
    ) -> GroundModelSnapshot:
        """Build a ``GroundModelSnapshot`` for the given (project, model).

        Parameters
        ----------
        app_project_id : UUID
            Project scope — used to load the right CPT / borehole /
            formation collections.
        model_id : UUID
            Which geological model's contacts to include. Must
            belong to ``app_project_id``.

        Returns
        -------
        GroundModelSnapshot
            Materialised geometry. ``layers`` carries one row per
            (investigation column, formation contact); ``formations``
            carries one row per formation present.

        Raises
        ------
        ParseError
            When the project or model doesn't exist or doesn't
            belong to the project scope.
        """
        self.info(f"Building ground-model snapshot: project={app_project_id} model={model_id}")

        # Project ---------------------------------------------------
        project_repo = ProjectRepository(self._session)
        project = await project_repo.get_by_id(app_project_id)
        if project is None:
            raise ParseError(f"Project {app_project_id} not found")

        # Geology ---------------------------------------------------
        geology_repo = GeologyRepository(self._session)
        model = await geology_repo.get_model(model_id)
        if model is None or model.app_project_id != app_project_id:
            raise ParseError(f"Geological model {model_id} not found in project {app_project_id}")
        formations_orm = await geology_repo.list_formations(app_project_id)
        formation_by_id = {f.id: f for f in formations_orm}
        contacts_orm = await geology_repo.list_contacts(model_id)

        # Investigations --------------------------------------------
        cpt_repo = CptRepository(self._session)
        borehole_repo = BoreholeRepository(self._session)
        cpts = await cpt_repo.list_all(app_project_id)
        boreholes = await borehole_repo.list_all(app_project_id)

        # Lookups keyed by anchor id — contacts XOR borehole / cpt
        # so a single dict per kind is enough.
        cpt_by_id = {c.id: c for c in cpts}
        bh_by_id = {b.id: b for b in boreholes}

        # CRS — prefer the project's default; fall back to the first
        # investigation that carries an EPSG. The .gmproj v3 contract
        # already requires default_horizontal_epsg on project rows so
        # this fallback is defensive against legacy DBs.
        crs_epsg = project.default_horizontal_epsg
        if crs_epsg is None:
            first_with_epsg = next(
                (c.epsg for c in cpts if c.epsg is not None),
                next((b.epsg for b in boreholes if b.epsg is not None), None),
            )
            if first_with_epsg is None:
                raise ParseError(
                    "Project has no default_horizontal_epsg and no investigation "
                    "carries an EPSG — cannot resolve snapshot CRS."
                )
            crs_epsg = first_with_epsg

        # Group contacts by anchor id ------------------------------
        contacts_by_borehole: dict[UUID, list[FormationContactOrm]] = defaultdict(list)
        contacts_by_cpt: dict[UUID, list[FormationContactOrm]] = defaultdict(list)
        for c in contacts_orm:
            if c.formation_id not in formation_by_id:
                # Defensive — formation deleted while the contact
                # row survives. Validator catches this elsewhere; we
                # just skip the row from the export.
                continue
            if c.borehole_id is not None:
                contacts_by_borehole[c.borehole_id].append(c)
            elif c.cpt_id is not None:
                contacts_by_cpt[c.cpt_id].append(c)

        # Emit LayerGeometry per (column, contact) -----------------
        layers: list[LayerGeometry] = []
        formation_ids_in_use: set[UUID] = set()
        skipped_no_elevation = 0

        for cpt_id, contact_list in contacts_by_cpt.items():
            cpt = cpt_by_id.get(cpt_id)
            if cpt is None:
                continue
            if cpt.elevation_m is None:
                # Plaxis 3D needs Z to place a borehole — drop the
                # column from the snapshot rather than emit a half-
                # placed entry. The exporter logs the count.
                skipped_no_elevation += 1
                continue
            layers.extend(
                self._column_layers(
                    contacts=contact_list,
                    location_x=cpt.location_x,
                    location_y=cpt.location_y,
                    surface_elevation_m=cpt.elevation_m,
                    total_depth_m=cpt.max_depth_m,
                    formation_by_id=formation_by_id,
                    formation_ids_in_use=formation_ids_in_use,
                )
            )

        for bh_id, contact_list in contacts_by_borehole.items():
            bh = bh_by_id.get(bh_id)
            if bh is None:
                continue
            if bh.elevation_m is None:
                skipped_no_elevation += 1
                continue
            layers.extend(
                self._column_layers(
                    contacts=contact_list,
                    location_x=bh.location_x,
                    location_y=bh.location_y,
                    surface_elevation_m=bh.elevation_m,
                    total_depth_m=bh.total_depth_m,
                    formation_by_id=formation_by_id,
                    formation_ids_in_use=formation_ids_in_use,
                )
            )

        # Formations — only those that appear in at least one layer
        formations: list[FormationDisplay] = []
        for fid in formation_ids_in_use:
            f = formation_by_id[fid]
            formations.append(
                FormationDisplay(
                    name=f.name,
                    code=f.code,
                    display_order=f.display_order,
                    color=f.color,
                    # Three-level unit identifiers (debt #104). NULL on a
                    # geological formation; the exporters read the null as
                    # "no machine identifier" and keep their display-name-
                    # only naming for that level.
                    nad_class=f.nad_class,
                    litho_main_soil_code=f.litho_main_soil_code,
                    formation_id=f.id,
                )
            )
        # Sort by display_order then name for stable output. Plaxis
        # exporter re-sorts descending; this is the canonical default.
        formations.sort(key=lambda f: (f.display_order, f.name))

        if skipped_no_elevation:
            self.warning(
                f"Snapshot dropped {skipped_no_elevation} investigation(s) "
                "without surface elevation — Plaxis 3D requires Z."
            )
        self.success(
            f"Ground-model snapshot built: layers={len(layers)} "
            f"formations={len(formations)} crs_epsg={crs_epsg}"
        )

        return GroundModelSnapshot(
            project_id=app_project_id,
            project_name=project.name,
            crs_epsg=crs_epsg,
            layers=layers,
            formations=formations,
        )

    def _column_layers(
        self,
        *,
        contacts: list[FormationContactOrm],
        location_x: float,
        location_y: float,
        surface_elevation_m: float,
        total_depth_m: float | None,
        formation_by_id: dict[UUID, GeologicalFormationOrm],
        formation_ids_in_use: set[UUID],
    ) -> list[LayerGeometry]:
        """Build the per-column ``LayerGeometry`` list for one investigation.

        Sorts contacts top-down by ``depth_top_m`` then derives each
        layer's ``base_depth_m`` from the next-deeper contact. The
        deepest layer uses the investigation's recorded total depth
        when known, otherwise ``top + _FALLBACK_BOTTOM_THICKNESS_M``.
        """
        if not contacts:
            return []
        ordered = sorted(contacts, key=lambda c: c.depth_top_m)
        result: list[LayerGeometry] = []
        for i, c in enumerate(ordered):
            top = c.depth_top_m
            if i + 1 < len(ordered):
                base = ordered[i + 1].depth_top_m
            elif total_depth_m is not None and total_depth_m > top:
                base = total_depth_m
            else:
                base = top + _FALLBACK_BOTTOM_THICKNESS_M
            if base <= top:
                # Degenerate — drop. LayerGeometry's contract says
                # equal-depth rows skip from assembly. Happens when
                # two contacts on the same column share the same
                # depth_top_m, which the dedupe pass should have
                # cleaned but we don't trust here.
                continue
            f = formation_by_id[c.formation_id]
            result.append(
                LayerGeometry(
                    formation_name=f.name,
                    formation_code=f.code,
                    top_depth_m=top,
                    base_depth_m=base,
                    location_x=location_x,
                    location_y=location_y,
                    surface_elevation_m=surface_elevation_m,
                )
            )
            formation_ids_in_use.add(c.formation_id)
        return result
