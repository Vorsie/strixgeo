"""Link a lithostratigraphic contact to the nearest geological contact (#162).

This is the manual inverse of the auto-link that fires on accept.  It lets the
user reconnect a litho contact after an auto-link was wrong or missing.

COUPLING LOGIC
--------------
The use case loads the litho contact, resolves its parent geological model,
queries the geo contacts on the **same investigation** (borehole or CPT), and
picks the nearest one within ``tolerance_m`` of the litho contact's
``depth_top_m``.  If found:

1. ``parent_geo_contact_id`` is set on the litho contact (the coupling label).
2. The geo contact's ``depth_top_m`` is snapped to the litho depth so both
   levels agree at the same physical surface (mirrors the accept-time snap).
3. The geo formation's surface is marked **stale** via
   :meth:`_mark_geo_surface_stale`.  The surface is NOT rebuilt — the owner
   directive is that only the explicit "Build 3D model" button triggers
   Delaunay; drags and manual edits mark stale.
4. The updated litho contact is returned.

If no geo contact is within ``tolerance_m``, ``None`` is returned and no
mutation is committed.

PROJECT-SCOPE GUARD
-------------------
Mirrors :class:`UnlinkLithoFromGeo`: load the contact, load its model, check
``model.app_project_id == project_id``.  A mismatch raises ``ValueError``
before any mutation.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.litho_geo_link_helpers import (
    load_geo_contacts_at_investigation,
    nearest_geo_contact_within_tolerance,
)
from groundmodel.domain.value_objects.formation_contact_result import FormationContactResult
from groundmodel.infrastructure.db.dml_rowcount import dml_rowcount
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LinkLithoToGeo(GroundModelLogger):
    """Use case: manually link a lithostratigraphic contact to the nearest
    geological contact within tolerance (#162).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        contact_id: UUID,
        tolerance_m: float = 0.20,
    ) -> FormationContactResult | None:
        """Link the litho contact to the nearest geo contact within tolerance.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the contact's model must belong to this
            project.  Raises ``ValueError`` when the guard fails.
        contact_id : UUID
            The lithostratigraphic contact to link.
        tolerance_m : float
            Maximum depth difference (metres) for linking.  Defaults to
            0.20 m — matches the accept-time coupling tolerance.

        Returns
        -------
        FormationContactResult | None
            Immutable snapshot of the updated litho contact with
            ``parent_geo_contact_id`` set, or ``None`` when no geo contact
            is within ``tolerance_m`` or when the litho model has no parent
            geological model.

        Raises
        ------
        ValueError
            When the contact is not found or its model does not belong to
            ``project_id``.
        """
        self.info(
            f"LinkLithoToGeo.execute: contact_id={contact_id} "
            f"project={project_id} tolerance={tolerance_m}m"
        )

        # --- Project-scope guard (mirrors UnlinkLithoFromGeo) ---
        contact = await self._session.get(FormationContactOrm, contact_id)
        if contact is None:
            raise ValueError(f"Contact {contact_id} not found in project {project_id}")

        model = await self._session.get(GeologicalModelOrm, contact.model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Contact {contact_id} not found in project {project_id}")

        # --- Resolve parent geological model ---
        geology_model_id: UUID | None = model.parent_model_id
        if geology_model_id is None:
            self.warning(
                f"LinkLithoToGeo: litho model {contact.model_id} has no parent "
                "geological model — cannot link; returning None"
            )
            return None

        # --- Load geo contacts at the same investigation ---
        geo_contacts = await load_geo_contacts_at_investigation(
            self._session,
            geology_model_id,
            borehole_id=contact.borehole_id,
            cpt_id=contact.cpt_id,
        )
        self.debug(
            f"LinkLithoToGeo: found {len(geo_contacts)} geo contact(s) "
            f"at investigation for contact {contact_id}"
        )

        # --- Pick the nearest within tolerance (shared with accept-time link) ---
        geo_contact_id = nearest_geo_contact_within_tolerance(
            contact.depth_top_m, geo_contacts, tolerance_m
        )
        if geo_contact_id is None:
            self.info(
                f"LinkLithoToGeo: no geo contact within {tolerance_m}m of "
                f"litho depth {contact.depth_top_m:.3f}m — returning None"
            )
            return None

        # --- Apply coupling: set parent_geo_contact_id + snap geo depth ---
        contact.parent_geo_contact_id = geo_contact_id

        geo_contact = await self._session.get(FormationContactOrm, geo_contact_id)
        if geo_contact is not None and geo_contact.depth_top_m != contact.depth_top_m:
            old_geo_depth = geo_contact.depth_top_m
            geo_contact.depth_top_m = contact.depth_top_m
            self.debug(
                f"LinkLithoToGeo: snapped geo contact {geo_contact_id} depth "
                f"{old_geo_depth:.3f}m → {contact.depth_top_m:.3f}m"
            )

        # --- Mark the geo formation's surface stale (do NOT auto-rebuild) ---
        # Owner directive: only the explicit "Build 3D model" button triggers
        # Delaunay.  Manual link/unlink/drag all mark stale.
        if geo_contact is not None:
            await self._mark_geo_surface_stale(
                geology_model_id=geology_model_id,
                formation_id=geo_contact.formation_id,
            )

        await self._session.commit()
        await self._session.refresh(contact)
        self.success(
            f"LinkLithoToGeo: contact {contact_id} linked to geo contact "
            f"{geo_contact_id} (depth {contact.depth_top_m:.3f}m)"
        )
        return FormationContactResult.from_orm(contact)

    async def _mark_geo_surface_stale(
        self,
        *,
        geology_model_id: UUID,
        formation_id: UUID,
    ) -> None:
        """Flip ``is_stale=True`` on the surface row for (geology_model_id, formation_id).

        Does NOT rebuild — stale-marking is the caller's signal; the user
        triggers Delaunay explicitly via "Build 3D model".  Missing surface
        rows are silently ignored (no built TIN to mark stale).

        Parameters
        ----------
        geology_model_id : UUID
            The parent geological model.
        formation_id : UUID
            The geo formation whose surface to mark stale.
        """
        from sqlalchemy import update  # local import avoids top-level pollution

        result = await self._session.execute(
            update(FormationSurfaceOrm)
            .where(
                FormationSurfaceOrm.model_id == geology_model_id,
                FormationSurfaceOrm.formation_id == formation_id,
            )
            .values(is_stale=True)
        )
        count = dml_rowcount(result) or 0
        if count:
            self.debug(
                f"LinkLithoToGeo: marked surface stale for "
                f"(model={geology_model_id}, formation={formation_id})"
            )
