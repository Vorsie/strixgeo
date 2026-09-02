"""Use case — materialise a ``SectionSnapshot`` from the DB.

Built for the section-scoped exporters (DXF first; future Plaxis-
section follows the same input contract). The use case owns:

1. Loading the section row + the active geological model's
   formations + contacts.
2. Loading every CPT + borehole in the project (lightweight list-
   item shape — we don't need lab tests or series for an export).
3. Projecting each investigation onto the section line, applying
   the buffer filter, dropping rows on the section's exclusion
   list.
4. Grouping contacts by anchor id to drop contacts whose anchor
   didn't pass the projection filter.
5. Assembling the value object exporters consume.

Per CLAUDE.md "Architecture": this lives in the application layer
so the infrastructure-layer DxfExporter never touches the DB. The
exporter consumes the snapshot through ``SectionExporter.export``.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.codelists.vertical_crs import (
    vertical_datum_label as _vertical_datum_label,
)
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_onto_section_corridor,
    section_length,
)
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BuildSectionSnapshot(GroundModelLogger):
    """Materialise the data needed to render or export one section."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active async session."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        app_project_id: UUID,
        section_id: UUID,
        model_id: UUID,
    ) -> SectionSnapshot:
        """Build a ``SectionSnapshot`` for the given (project, section, model).

        Parameters
        ----------
        app_project_id : UUID
            Project scope — used to load the right CPT / borehole /
            formation collections.
        section_id : UUID
            The cross-section to project against. Must belong to
            ``app_project_id`` (the section repo enforces the scope;
            we raise ``ParseError`` on mismatch).
        model_id : UUID
            Which geological model's contacts to include. Callers
            typically pass the active model id; the use case doesn't
            assume — multi-model exports work as soon as the API
            exposes the choice.

        Returns
        -------
        SectionSnapshot
            Materialised geometry. ``investigations`` sorted by
            ``along_distance_m``, ``formations`` by display_order
            then name.

        Raises
        ------
        ParseError
            When the section, project, or model doesn't exist, or
            when the section is degenerate (zero length).
        """
        # Section + project metadata --------------------------------
        section_repo = CrossSectionRepository(self._session)
        section = await section_repo.get(section_id)
        if section is None or section.app_project_id != app_project_id:
            raise ParseError(f"Cross-section {section_id} not found in project {app_project_id}")
        endpoints = SectionEndpoints(
            start_x=section.start_x,
            start_y=section.start_y,
            end_x=section.end_x,
            end_y=section.end_y,
        )
        length = section_length(endpoints)
        if length < 1e-6:
            raise ParseError(
                f"Cross-section {section_id} is degenerate (zero length) — cannot export"
            )

        project_repo = ProjectRepository(self._session)
        project = await project_repo.get_by_id(app_project_id)
        if project is None:
            raise ParseError(f"Project {app_project_id} not found")

        # Geological model + formations + contacts ------------------
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

        excluded_cpt_ids = set(section.excluded_cpt_ids or [])
        excluded_borehole_ids = set(section.excluded_borehole_ids or [])
        buffer_m = section.projection_buffer_m

        # Classification follows the test (owner directive 2026-06-08,
        # supersedes the 2026-05-17 explicit-content gate for classification):
        # a section shows the contacts of EVERY investigation that projects
        # into its corridor — there is no per-section seeded gate.  A test is
        # classified once and appears on every section through it.  The
        # in-corridor filter below (anchor must be a projected investigation)
        # is the only render gate; ``seeded_formation_contact_ids`` rides the
        # bundle for compat but no longer filters here.  The explicit-content
        # invariant now applies to correlations only.
        investigations: list[SectionInvestigationProjection] = []
        for cpt in cpts:
            if cpt.id in excluded_cpt_ids:
                continue
            proj = project_onto_section_corridor(
                endpoints, cpt.location_x, cpt.location_y, buffer_m
            )
            if proj is None:
                continue
            investigations.append(
                SectionInvestigationProjection(
                    investigation_id=cpt.id,
                    kind="cpt",
                    name=cpt.name,
                    along_distance_m=proj.along,
                    surface_elevation_m=cpt.elevation_m,
                    total_depth_m=cpt.max_depth_m,
                )
            )
        for bh in boreholes:
            if bh.id in excluded_borehole_ids:
                continue
            proj = project_onto_section_corridor(endpoints, bh.location_x, bh.location_y, buffer_m)
            if proj is None:
                continue
            investigations.append(
                SectionInvestigationProjection(
                    investigation_id=bh.id,
                    kind="borehole",
                    name=bh.name,
                    along_distance_m=proj.along,
                    surface_elevation_m=bh.elevation_m,
                    total_depth_m=bh.total_depth_m,
                )
            )
        investigations.sort(key=lambda i: i.along_distance_m)

        # Pre-index projected investigations by id so the contact
        # filter is O(K) per contact rather than O(N).
        projected_by_id = {i.investigation_id: i for i in investigations}

        # Contacts — keep only those whose anchor projects onto the section
        # (within the buffer, not excluded).  This is the in-corridor gate:
        # a contact belongs to the section iff its anchor investigation is a
        # projected column.  Stale-anchor tolerance is inherent — a contact
        # whose anchor didn't project (out of corridor, excluded, or absent)
        # resolves to ``inv is None`` below and is silently skipped.
        contacts: list[SectionFormationContact] = []
        formation_ids_in_use: set[UUID] = set()
        for c in contacts_orm:
            anchor_id = c.borehole_id if c.borehole_id is not None else c.cpt_id
            if anchor_id is None:
                continue
            inv = projected_by_id.get(anchor_id)
            if inv is None:
                continue
            if c.formation_id not in formation_by_id:
                # Stale formation reference — formation deleted from model;
                # silently skip so the section still opens cleanly.
                continue
            level_m: float | None
            if inv.surface_elevation_m is not None:
                level_m = inv.surface_elevation_m - c.depth_top_m
            else:
                level_m = None
            contacts.append(
                SectionFormationContact(
                    contact_id=c.id,
                    formation_id=c.formation_id,
                    investigation_id=anchor_id,
                    along_distance_m=inv.along_distance_m,
                    depth_m=c.depth_top_m,
                    level_m=level_m,
                )
            )
            formation_ids_in_use.add(c.formation_id)

        # Formations — only those that have at least one contact on
        # the section. Sorted by display_order, then name.
        formations: list[SectionFormation] = []
        for fid in formation_ids_in_use:
            f = formation_by_id[fid]
            formations.append(
                SectionFormation(
                    formation_id=f.id,
                    name=f.name,
                    code=f.code,
                    color=f.color,
                    display_order=f.display_order,
                    # Three-level unit identifiers (debt #104). NULL on a
                    # geological formation; the exporters read the null as
                    # "no machine identifier" and keep their display-name-
                    # only naming for that level.
                    nad_class=f.nad_class,
                    litho_main_soil_code=f.litho_main_soil_code,
                )
            )
        formations.sort(key=lambda f: (f.display_order, f.name))

        # Vertical datum label — pick the first investigation with a
        # known z_epsg as the section's datum (sections are typically
        # mono-CRS in v1; mixed-CRS guards land via debt #16). When
        # nothing has a z_epsg, the helper returns plain "m".
        first_cpt_with_z = next((c for c in cpts if c.z_epsg is not None), None)
        first_bh_with_z = next((b for b in boreholes if b.z_epsg is not None), None)
        z_epsg = (
            first_cpt_with_z.z_epsg
            if first_cpt_with_z is not None
            else (first_bh_with_z.z_epsg if first_bh_with_z is not None else None)
        )
        datum_label = _vertical_datum_label(z_epsg)

        # Identifier coverage on the success line (debt #104): an export
        # that silently carries display names only is the exact failure
        # this slice closed, so the counts state what WAS found — a
        # geotech-model snapshot reporting nad=0 means the units were
        # never classified, not that the exporter dropped them.
        with_nad = sum(1 for f in formations if f.nad_class is not None)
        with_soil = sum(1 for f in formations if f.litho_main_soil_code is not None)
        self.success(
            f"Section snapshot built: section={section_id} "
            f"investigations={len(investigations)} "
            f"contacts={len(contacts)} formations={len(formations)} "
            f"unit_identifiers=[nad={with_nad}/{len(formations)} "
            f"soil={with_soil}/{len(formations)}]"
        )

        return SectionSnapshot(
            project_id=app_project_id,
            project_name=project.name,
            section_id=section_id,
            section_name=section.name,
            section_length_m=length,
            crs_epsg=section.epsg,
            vertical_datum_label=datum_label,
            investigations=investigations,
            formations=formations,
            contacts=contacts,
            # debt #52: line endpoints for the PDF location-map inset.
            start_x=section.start_x,
            start_y=section.start_y,
            end_x=section.end_x,
            end_y=section.end_y,
        )
