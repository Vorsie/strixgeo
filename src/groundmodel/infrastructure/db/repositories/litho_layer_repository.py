"""LithoLayerRepository — read-path for the unified litho boundary model.

Slice A1 of the unified litho boundary model
(spec ``docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md``).

Slice A1 ships read methods only — the write path (PATCH layer,
boundary-move, batch-status, bulk-create) lands in Slice A2 alongside
the dual-write transition. List queries are scoped by ``model_id`` +
optional ``borehole_id`` / ``cpt_id`` filters and always return rows
sorted by ``depth_top_m`` ascending, matching the dominant frontend
read pattern ("give me this anchor's layers in top-to-bottom order").

Methods added for the litho-3D solid cache (Task 4):
  * ``load_body_picks`` — builds ``BodyLayerPick`` tuples for all accepted
    layers in a model that have a non-null ``body_id`` and a resolvable
    anchor with valid (x, y, elevation_m).
  * ``mark_litho_solids_stale`` — bulk flips ``is_stale=True`` on the
    ``litho_body_solid`` cache rows for a model.
  * ``list_litho_solids`` — returns the cached solid rows for a model.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LithoLayerRepository(GroundModelLogger):
    """Read-path repository for ``litho_layer`` rows.

    Parameters
    ----------
    session : AsyncSession
        The active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session

    async def list_layers(
        self,
        model_id: UUID,
        *,
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        formation_id: UUID | None = None,
        status: str | None = None,
    ) -> list[LithoLayerOrm]:
        """List layers in a model, optionally filtered + sorted top-to-bottom.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to scope the query to.
        borehole_id : UUID | None
            Restrict to one borehole anchor's layers. Mutually
            exclusive with ``cpt_id``; caller is trusted (the XOR is
            enforced at the row level by the table CHECK, so combining
            both filters here would return zero rows safely).
        cpt_id : UUID | None
            Restrict to one CPT anchor's layers.
        formation_id : UUID | None
            Restrict to one formation's layers across all anchors.
        status : str | None
            Restrict to one status (``"pending"`` / ``"accepted"`` /
            ``"rejected"``). When absent, all three are returned.

        Returns
        -------
        list[LithoLayerOrm]
            Matching rows, ordered by ``depth_top_m`` ascending.
        """
        stmt = (
            select(LithoLayerOrm)
            .where(LithoLayerOrm.model_id == model_id)
            .order_by(LithoLayerOrm.depth_top_m)
        )
        if borehole_id is not None:
            stmt = stmt.where(LithoLayerOrm.borehole_id == borehole_id)
        if cpt_id is not None:
            stmt = stmt.where(LithoLayerOrm.cpt_id == cpt_id)
        if formation_id is not None:
            stmt = stmt.where(LithoLayerOrm.formation_id == formation_id)
        if status is not None:
            stmt = stmt.where(LithoLayerOrm.status == status)
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_layer(self, layer_id: UUID) -> LithoLayerOrm | None:
        """Load one layer by primary key.

        Returns
        -------
        LithoLayerOrm | None
            The row, or ``None`` when the id does not exist (or has
            been deleted via CASCADE).
        """
        return await self._session.get(LithoLayerOrm, layer_id)

    async def update_layer(
        self,
        layer_id: UUID,
        patch: dict[str, object],
        model_id: UUID | None = None,
    ) -> LithoLayerOrm | None:
        """Apply a partial update to a layer.

        Trust-the-caller: validation (depth ordering, status / source /
        confidence literals) lives in the Pydantic request schema +
        the DB CHECK constraints. This method just maps the dict onto
        the row and flushes.

        Parameters
        ----------
        layer_id : UUID
            Row to update.
        patch : dict
            Column-name → new-value pairs. Keys must be valid column
            names on ``LithoLayerOrm``.
        model_id : UUID, optional
            When given, the layer must belong to this model or the update
            is rejected as not-found (audit #2 IDOR guard for the
            single-layer write paths). The router always passes the URL's
            model id.

        Returns
        -------
        LithoLayerOrm | None
            The updated row, or ``None`` when the id does not exist (or is
            outside ``model_id`` when that scope is given).
        """
        layer = await self._session.get(LithoLayerOrm, layer_id)
        if layer is None:
            return None
        if model_id is not None and layer.model_id != model_id:
            return None
        for key, value in patch.items():
            setattr(layer, key, value)
        await self._session.flush()
        self.info(f"Layer updated: {layer_id}")
        return layer

    async def create_layer(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        depth_base_m: float,
        status: str,
        source: str,
        confidence: str = "medium",
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        observation_id: UUID | None = None,
        observation_layer_id: UUID | None = None,
        parent_geo_contact_id: UUID | None = None,
        notes: str | None = None,
    ) -> LithoLayerOrm:
        """Insert one ``litho_layer`` row and flush.

        The caller owns the id assignment (`uuid7()` is the project
        convention — see other repository write methods).
        """
        from uuid6 import uuid7

        layer = LithoLayerOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            depth_top_m=depth_top_m,
            depth_base_m=depth_base_m,
            status=status,
            source=source,
            confidence=confidence,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            observation_id=observation_id,
            observation_layer_id=observation_layer_id,
            parent_geo_contact_id=parent_geo_contact_id,
            notes=notes,
        )
        self._session.add(layer)
        await self._session.flush()
        self.success(
            f"Layer created: {layer.id} @ [{depth_top_m:.2f}, {depth_base_m:.2f}] m "
            f"status={status} source={source}"
        )
        return layer

    async def delete_layer(self, layer_id: UUID) -> bool:
        """Hard-delete a layer row.

        Returns
        -------
        bool
            ``True`` when the row existed and was removed, ``False``
            when it did not exist. (Idempotent.)
        """
        layer = await self._session.get(LithoLayerOrm, layer_id)
        if layer is None:
            return False
        await self._session.delete(layer)
        await self._session.flush()
        self.info(f"Layer deleted: {layer_id}")
        return True

    async def list_layers_by_ids(
        self, layer_ids: list[UUID], model_id: UUID | None = None
    ) -> list[LithoLayerOrm]:
        """Load layers by id in one IN-query.

        Used by the boundary-move + batch-status + batch-update use cases for
        the all-or-nothing scope check. Returns in arbitrary order; the caller
        indexes by id.

        Parameters
        ----------
        layer_ids : list[UUID]
            The layer ids to load.
        model_id : UUID, optional
            When given, restrict the result to layers belonging to this
            model. A foreign-model layer id then simply does not come back,
            which the caller's all-or-nothing guard reports as not-found
            (audit #2: closes an IDOR on the batch / boundary endpoints).

        Returns
        -------
        list[LithoLayerOrm]
            The matching layers (a subset of ``layer_ids``).
        """
        if not layer_ids:
            return []
        stmt = select(LithoLayerOrm).where(LithoLayerOrm.id.in_(layer_ids))
        if model_id is not None:
            stmt = stmt.where(LithoLayerOrm.model_id == model_id)
        return list((await self._session.execute(stmt)).scalars().all())

    # -----------------------------------------------------------------
    # Litho-3D solid cache support (voxel builder + geotech subdivision)
    # -----------------------------------------------------------------

    async def load_body_picks(
        self,
        model_id: UUID,
        *,
        restrict_to_investigation_ids: set[UUID] | None = None,
    ) -> list[BodyLayerPick]:
        """Load one ``BodyLayerPick`` per accepted litho layer with a resolved body.

        The pick carries the investigation's world coordinates and surface
        elevation, mirroring the ``ContactPoint3D`` assembly in
        ``RecomputeFormationSurface``.  Layers are skipped (and counted)
        when:

        * ``body_id`` is ``None`` — resolver has not run yet or the layer
          is an isolated singleton.
        * The anchor investigation row is missing.
        * Any of ``location_x``, ``location_y``, or ``elevation_m`` is
          ``None`` on the anchor.

        The (x, y, elevation_m) columns are on the same ``CptOrm`` /
        ``BoreholeOrm`` rows that ``RecomputeFormationSurface`` uses —
        ``location_x``, ``location_y``, ``elevation_m`` — ensuring
        the two pipelines share the same coordinate source.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to scope the query to.
        restrict_to_investigation_ids : set[UUID] | None, optional
            When given, only layers anchored to a CPT/borehole whose id is in
            this set are loaded — the section-scoped path (in-corridor
            investigations resolved via
            ``project_investigations_onto_section``).  ``None`` (the
            default) is the model-wide load every other caller uses.  An empty
            set returns no picks (no in-corridor investigations).

        Returns
        -------
        list[BodyLayerPick]
            One entry per accepted layer with a valid body + anchor.
            Order is deterministic (sorted by ``body_id`` then
            ``depth_top_m``) but callers must not depend on it.
        """
        self.debug(
            f"load_body_picks: model={model_id}"
            + (
                f" restricted to {len(restrict_to_investigation_ids)} investigation(s)"
                if restrict_to_investigation_ids is not None
                else ""
            )
        )

        # One query for all accepted layers with non-null body_id.
        stmt = (
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.body_id,
                LithoLayerOrm.formation_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.cpt_id,
            )
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.status == "accepted",
                LithoLayerOrm.body_id.is_not(None),
            )
            .order_by(LithoLayerOrm.body_id, LithoLayerOrm.depth_top_m)
        )
        if restrict_to_investigation_ids is not None:
            # Section-scoped: keep only layers anchored to an in-corridor
            # investigation.  The XOR anchor means exactly one of borehole_id /
            # cpt_id is non-null per row, so an OR over both columns matches the
            # right rows regardless of anchor kind.
            ids = restrict_to_investigation_ids
            stmt = stmt.where(LithoLayerOrm.borehole_id.in_(ids) | LithoLayerOrm.cpt_id.in_(ids))
        layer_rows = list((await self._session.execute(stmt)).all())

        if not layer_rows:
            self.debug(f"load_body_picks: no accepted body-assigned layers for model={model_id}")
            return []

        # Bulk-load the unique anchor ids (same pattern as
        # RecomputeFormationSurface to keep coordinate sources identical).
        bh_ids: set[UUID] = {r.borehole_id for r in layer_rows if r.borehole_id is not None}
        cpt_ids: set[UUID] = {r.cpt_id for r in layer_rows if r.cpt_id is not None}

        boreholes_by_id: dict[UUID, BoreholeOrm] = (
            {
                b.id: b
                for b in (
                    await self._session.execute(
                        select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids))
                    )
                )
                .scalars()
                .all()
            }
            if bh_ids
            else {}
        )
        cpts_by_id: dict[UUID, CptOrm] = (
            {
                c.id: c
                for c in (await self._session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids))))
                .scalars()
                .all()
            }
            if cpt_ids
            else {}
        )

        picks: list[BodyLayerPick] = []
        skipped_no_anchor = 0
        skipped_no_coords = 0

        for r in layer_rows:
            # Resolve anchor to a (location_x, location_y, elevation_m) triple.
            if r.borehole_id is not None:
                anchor = boreholes_by_id.get(r.borehole_id)
                anchor_id = str(r.borehole_id)
            else:
                anchor = cpts_by_id.get(r.cpt_id)
                anchor_id = str(r.cpt_id)

            if anchor is None:
                skipped_no_anchor += 1
                self.debug(
                    f"load_body_picks: layer {r.id} anchor {anchor_id!r} not found — skipping"
                )
                continue

            if anchor.location_x is None or anchor.location_y is None or anchor.elevation_m is None:
                skipped_no_coords += 1
                self.debug(
                    f"load_body_picks: layer {r.id} anchor {anchor_id!r} "
                    f"has incomplete coordinates "
                    f"(x={anchor.location_x} y={anchor.location_y} "
                    f"elev={anchor.elevation_m}) — skipping"
                )
                continue

            picks.append(
                BodyLayerPick(
                    investigation_id=anchor_id,
                    x_m=anchor.location_x,
                    y_m=anchor.location_y,
                    surface_elev_m=anchor.elevation_m,
                    body_id=str(r.body_id),
                    formation_id=str(r.formation_id),
                    top_depth_m=r.depth_top_m,
                    base_depth_m=r.depth_base_m,
                )
            )

        if skipped_no_anchor or skipped_no_coords:
            self.warning(
                f"load_body_picks: model={model_id} — skipped "
                f"{skipped_no_anchor} layer(s) with missing anchor, "
                f"{skipped_no_coords} layer(s) with incomplete coordinates; "
                f"{len(picks)} pick(s) produced"
            )
        else:
            self.debug(
                f"load_body_picks: model={model_id} — {len(picks)} pick(s) "
                f"from {len(layer_rows)} accepted body-assigned layer(s)"
            )

        return picks

    async def mark_litho_solids_stale(self, model_id: UUID) -> int:
        """Flip ``is_stale=True`` on every cached solid for a model.

        Called by every use case that mutates accepted litho layers or
        body membership so the on-click Build knows the 3-D cache is
        no longer valid.  No-ops when no solid rows exist yet (legal —
        the user hasn't clicked Build yet).

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model whose solids are invalidated.

        Returns
        -------
        int
            Number of rows actually flipped.  ``0`` means the model has
            no built solid cache to invalidate (not an error).
        """
        result = await self._session.execute(
            update(LithoBodySolidOrm)
            .where(LithoBodySolidOrm.model_id == model_id)
            .values(is_stale=True)
        )
        count = result.rowcount or 0
        if count:
            self.debug(f"mark_litho_solids_stale: {count} row(s) staled for model={model_id}")
        return count

    async def list_litho_solids(self, model_id: UUID) -> list[LithoBodySolidOrm]:
        """Return every cached solid for *model_id*.

        Used by the GET endpoint (Task 5) and the recompute use case.
        Order is arbitrary; callers index by ``body_id``.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to scope the query to.

        Returns
        -------
        list[LithoBodySolidOrm]
            All cached solid rows for the model (may be empty when no
            build has run yet).
        """
        stmt = select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
        return list((await self._session.execute(stmt)).scalars().all())
