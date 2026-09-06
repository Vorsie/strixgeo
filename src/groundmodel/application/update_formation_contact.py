"""Update-formation-contact use case.

The router has already established scope (the contact's
``model_id`` matches the URL and the model belongs to the project)
before this use case is called. The use case applies the patch,
commits, and returns the refreshed row.

The anchor (``borehole_id`` / ``cpt_id``) IS updatable — the
section editor's drag-re-anchor flow PATCHes both anchor fields
together (one with the new value, the other set to null) and the
schema's XOR validator enforces invariant safety. The repository's
``update_contact`` already setattrs whatever keys the patch dict
carries, so anchor changes flow through without a use-case change.

Cross-merge behaviour (drag-to-boundary)
-----------------------------------------
When ``depth_top_m`` is the only field in the patch, the use case
detects contacts on the *same anchor* (same ``model_id`` + same
``borehole_id`` or ``cpt_id``) that the dragger has crossed and
removes them:

* **Drag UP** (``new_depth < old_depth``): the dragger survives.
  Peer contacts in ``[new_depth, old_depth)`` are deleted.
* **Drag DOWN** (``new_depth > old_depth``): the formation above the
  dragger absorbs it. Peer contacts in ``(old_depth, new_depth]`` are
  deleted. If any such peers exist the dragger itself is also deleted
  and ``execute`` returns ``None`` (the router maps this to 200 with
  ``absorbed=True``).

Cross-merge is skipped when the patch also touches ``formation_id``,
``borehole_id``, or ``cpt_id`` — those are re-anchor / formation-swap
operations with different semantics.

For lithostratigraphic models, any cross-merge that deletes contacts
triggers ``ResolveLithoInstances`` before commit to keep ordinals
consistent.  Body detection is NOT fired here (owner directive
2026-05-31) — stale ``BodyOrm`` rows survive until the startup /
bundle-restore body sweep reconciles them.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.domain.value_objects.formation_contact_result import (
    FormationContactResult,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UpdateFormationContact(GroundModelLogger):
    """Apply a partial update to one formation contact and commit."""

    # Half-mm tolerance for the litho↔geo propagation loop-guard.  An exact
    # ``==`` defeats the guard on a single ULP of drift (mm-rounding on the
    # depth, or an ORM round-trip), risking a propagation loop / missed
    # termination (debt #218).  Coupled depths are equal in intent well
    # within this band; a real distinct depth differs by far more.
    _DEPTH_EPSILON_M = 0.0005

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        contact_id: UUID,
        patch: dict[str, Any],
    ) -> FormationContactResult | None:
        """Apply ``patch`` to ``contact_id``.

        When ``depth_top_m`` is the only changing field and the dragger
        crosses peer contacts on the same anchor, the crossed contacts
        are deleted atomically.  On drag-down with crossings the dragger
        itself is absorbed and ``None`` is returned.  The router maps
        ``None`` with a cross-merge origin to 200 + ``absorbed=True``
        rather than the normal 404 path.

        Parameters
        ----------
        contact_id : UUID
            Row to update.
        patch : dict[str, Any]
            ``exclude_unset`` dump from the Pydantic request — only
            keys present here are written.

        Returns
        -------
        FormationContactResult | None
            Immutable snapshot of the refreshed row after a normal update,
            or ``None`` when:

            * the row vanished between the router's scope check and this
              call (TOCTOU race) — router maps to 404; or
            * a drag-down cross-merge absorbed the dragger — the router
              maps this to 200 with ``absorbed=True``.

        Notes
        -----
        The caller distinguishes the two ``None`` origins via the
        ``absorbed`` attribute injected onto the use-case instance after
        ``execute`` returns (``True`` on absorption, ``False`` on TOCTOU).

        ``deleted_contact_ids`` (also injected on the instance) lists every
        PEER contact a cross-merge deleted — for both the drag-up survivor
        path and the drag-down absorbed path.  The absorbed dragger's own id
        is not included (its death is signalled by ``absorbed``).  The router
        forwards this list so the renderer prunes the crossed boundaries from
        the section at once.
        """
        self.info(f"Updating formation contact: {contact_id} ({len(patch)} field(s))")
        # Initialise the absorption sentinel so the router can inspect it
        # even when execute returns a non-None ORM row.
        self.absorbed = False
        # Record every PEER contact this cross-merge deletes so the router can
        # name them in the response and the renderer can drop them from the
        # section at once (installer #20 dogfeed 2026-09-06: crossed boundaries
        # lingered client-side and a second delete of them 404'd).  The absorbed
        # dragger's own id is NOT recorded here — its death is signalled by
        # ``absorbed`` and its id is already known to the caller from the URL.
        self.deleted_contact_ids: list[UUID] = []

        # Capture the pre-update state.  The post-update formation IS
        # always affected; the pre-update formation is also affected
        # when the patch flipped formation_id (that surface just lost
        # a contact).
        pre = await self._session.get(FormationContactOrm, contact_id)
        if pre is None:
            self.warning(f"Formation contact vanished pre-update: {contact_id}")
            return None

        old_model_id = pre.model_id
        old_formation_id = pre.formation_id

        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it — here the
        # model id is only knowable from ``pre``, so this is the first point it can
        # be taken (and the row-vanished 404 above has already returned). Every
        # write below mirrors into ``litho_layer`` through the FC→LL trigger — the
        # cross-merge deletes, the patch, the coupled-depth propagation — and the
        # cross-merge path only reaches ``ResolveLithoInstances``, which takes this
        # same lock, once those deletes are done. Unguarded they race the debounced
        # background ``bodies/recompute`` stamping ``litho_layer.body_id`` over the
        # same rows in a different order (owner dogfeed 2026-08-23:
        # DeadlockDetectedError on ``DELETE FROM litho_layer``). Re-entrant per
        # session, so the resolver's later acquisition stays free.
        await lock_body_partition(
            self._session, model_id=old_model_id, operation="update-formation-contact"
        )

        # Fetch the model kind once.  Cross-merge runs on the geological
        # axis only; litho contacts skip it per owner directive
        # 2026-05-27: "delete the merge/collapse on accepted lithos
        # (when dragging one boundary over another) — quick-and-dirty
        # merging is for suggestions; once accepted, the user must
        # remove/add via explicit right-click verbs".  The model row
        # is still needed downstream for the litho-cascade gate, so
        # this fetch replaces the later one at line ~225.
        model = await self._session.get(GeologicalModelOrm, old_model_id)
        # ``getattr`` guards against test mocks that stub ``GeologicalModelOrm``
        # with a SimpleNamespace lacking ``kind``; production rows always have it.
        is_litho_model = getattr(model, "kind", None) == "lithostratigraphic"

        # ------------------------------------------------------------------ #
        # Cross-merge: depth-only patches that cross peer contacts on the    #
        # same anchor are resolved by deleting the crossed contacts.          #
        # Re-anchor patches (borehole_id / cpt_id / formation_id changing)   #
        # skip this block entirely.                                            #
        #                                                                      #
        # Litho contacts skip cross-merge entirely (owner directive            #
        # 2026-05-27).  The user can drag past peers but no auto-delete       #
        # fires; explicit right-click "Remove" is the destructive verb.       #
        # ------------------------------------------------------------------ #
        patch_keys = set(patch.keys())
        is_depth_only = "depth_top_m" in patch_keys and not patch_keys & {
            "formation_id",
            "borehole_id",
            "cpt_id",
        }

        deleted_any = False  # True when any peer was deleted by cross-merge.

        if is_depth_only and patch["depth_top_m"] != pre.depth_top_m and not is_litho_model:
            old_depth = pre.depth_top_m
            new_depth = float(patch["depth_top_m"])

            # Build the anchor filter for peer contacts on the same column.
            if pre.borehole_id is not None:
                anchor_filter = FormationContactOrm.borehole_id == pre.borehole_id
            elif pre.cpt_id is not None:
                anchor_filter = FormationContactOrm.cpt_id == pre.cpt_id
            else:
                # Synthetic contact — no physical peers to cross.
                anchor_filter = None

            if anchor_filter is not None:
                peers_stmt = select(FormationContactOrm).where(
                    FormationContactOrm.model_id == pre.model_id,
                    FormationContactOrm.id != pre.id,
                    anchor_filter,
                )
                peers = (await self._session.execute(peers_stmt)).scalars().all()

                # Diagnostic: drag-up cross-merge regression repro
                # (2026-05-26). Records the BE's view of direction and
                # crossed-peer count BEFORE any deletion fires, so the
                # branch taken is visible without scraping the INFO
                # cross-merge lines below.
                if new_depth < old_depth:
                    _crossed_preview = [c for c in peers if new_depth <= c.depth_top_m < old_depth]
                    _direction = "UP"
                    _branch = "UP" if _crossed_preview else "UP-no-cross"
                else:
                    _crossed_preview = [c for c in peers if old_depth < c.depth_top_m <= new_depth]
                    _direction = "DOWN"
                    _branch = "DOWN-with-cross" if _crossed_preview else "DOWN-no-cross"
                self.debug(
                    "cross-merge decision: "
                    f"old_depth={old_depth}m new_depth={new_depth}m "
                    f"direction={_direction} peers_count={len(peers)} "
                    f"crossed_count={len(_crossed_preview)} "
                    f"branch_taken={_branch}"
                )

                if new_depth < old_depth:
                    # Drag UP — dragger wins; delete everything crossed.
                    crossed = [c for c in peers if new_depth <= c.depth_top_m < old_depth]
                    _peer_deleted_count = 0
                    for c in crossed:
                        self.info(
                            f"Cross-merge UP: deleting contact {c.id} "
                            f"at {c.depth_top_m}m (dragger {contact_id} "
                            f"moved from {old_depth}m to {new_depth}m)"
                        )
                        await self._session.delete(c)
                        self.deleted_contact_ids.append(c.id)
                        _peer_deleted_count += 1
                    if crossed:
                        deleted_any = True
                    self.debug(
                        f"cross-merge UP delete-loop done: deleted={_peer_deleted_count} peers"
                    )
                else:
                    # Drag DOWN — formation above absorbs; dragger dies if
                    # any peer was crossed.
                    crossed = [c for c in peers if old_depth < c.depth_top_m <= new_depth]
                    _peer_deleted_count = 0
                    if crossed:
                        for c in crossed:
                            self.info(
                                f"Cross-merge DOWN: deleting contact {c.id} at {c.depth_top_m}m"
                            )
                            await self._session.delete(c)
                            self.deleted_contact_ids.append(c.id)
                            _peer_deleted_count += 1
                        self.info(
                            f"Cross-merge DOWN: deleting dragger {contact_id} "
                            f"(formation above absorbs; moved from {old_depth}m to {new_depth}m)"
                        )
                        await self._session.delete(pre)
                        deleted_any = True
                        self.absorbed = True
                    self.debug(
                        f"cross-merge DOWN delete-loop done: "
                        f"deleted={_peer_deleted_count} peers, "
                        f"absorbed_dragger={self.absorbed}"
                    )

        # ------------------------------------------------------------------ #
        # Litho cascade (resolver only) when contacts were deleted.  Runs   #
        # before commit so it is part of the same transaction.              #
        # Body detection is NOT fired here (owner directive 2026-05-31) —    #
        # stale ``BodyOrm`` rows survive cross-merge until the startup /     #
        # bundle-restore body sweep reconciles them.                         #
        # ------------------------------------------------------------------ #
        if deleted_any:
            # ``model`` was fetched at the top of execute for the
            # cross-merge gate; reuse it here.
            if is_litho_model:
                assert model is not None  # is_litho_model implies non-None
                # Import lazily to avoid circular-import at module load (both
                # use cases import from groundmodel.application).
                from groundmodel.application.resolve_litho_instances_use_case import (
                    ResolveLithoInstances,
                )

                await ResolveLithoInstances(self._session).execute(
                    model_id=old_model_id, commit=False
                )

        # ------------------------------------------------------------------ #
        # Absorbed path: dragger row is gone; commit + return None.           #
        # ------------------------------------------------------------------ #
        if self.absorbed:
            await self._repo.mark_surfaces_stale([(old_model_id, old_formation_id)])
            if is_litho_model:
                # Mirror the surfaces-stale signal to the 3D solid cache so the
                # on-click Build knows the geometry is out of date.  The absorbed
                # path is structurally unreachable for litho contacts today (litho
                # cross-merge is disabled per owner directive 2026-05-27), but the
                # stale call is harmless and guards against future re-enablement.
                await LithoLayerRepository(self._session).mark_litho_solids_stale(old_model_id)
            await self._session.commit()
            self.success(
                f"Formation contact {contact_id} absorbed by formation above (drag-down cross)"
            )
            return None

        # ------------------------------------------------------------------ #
        # Normal update path.                                                  #
        # ------------------------------------------------------------------ #
        updated = await self._repo.update_contact(contact_id, patch)
        if updated is None:
            self.warning(f"Formation contact vanished mid-update: {contact_id}")
            return None

        # Bidirectional depth propagation (#162): keep coupled geo↔litho
        # contacts in sync.  Only runs on the depth-only change path.
        if is_depth_only:
            new_depth = float(patch["depth_top_m"])
            # Pass the project_id from the already-loaded model so the
            # propagation query can scope its children lookup to this
            # project (defence-in-depth, debt #211-c).
            model_project_id: UUID | None = getattr(model, "app_project_id", None)
            await self._propagate_coupled_depth(updated, new_depth, project_id=model_project_id)

        # On-click build pivot: mark stale rather than recompute. The
        # post-update formation is always affected; the pre-update
        # formation is also affected when the patch flipped formation_id
        # (that surface just lost a contact).
        pairs: list[tuple[UUID, UUID]] = [(updated.model_id, updated.formation_id)]
        if old_model_id == updated.model_id and old_formation_id != updated.formation_id:
            pairs.append((old_model_id, old_formation_id))
        await self._repo.mark_surfaces_stale(pairs)
        if is_litho_model:
            # Mirror the surfaces-stale signal to the 3D solid cache so the
            # on-click Build knows the geometry is out of date.  Covers the
            # geometry-only edit path (no topology change, no resolver) that
            # was the gap identified in the Task-4 stale-cascade audit.
            await LithoLayerRepository(self._session).mark_litho_solids_stale(updated.model_id)
        await self._session.commit()
        await self._session.refresh(updated)
        self.success(f"Formation contact updated: {contact_id}")
        # Diagnostic: drag-up cross-merge regression repro (2026-05-26).
        # Records the exact response shape the FE will see so we can
        # confirm BE truth vs FE-rendered state on a buggy drag.
        # Defensive getattr — unit-test stubs may omit fields, and a
        # diagnostic log must never crash the use case.
        self.debug(
            f"response shape: id={getattr(updated, 'id', '?')} "
            f"depth_top_m={getattr(updated, 'depth_top_m', '?')} "
            f"formation_id={getattr(updated, 'formation_id', '?')}"
        )
        return FormationContactResult.from_orm(updated)

    async def _propagate_coupled_depth(
        self,
        updated_contact: FormationContactOrm,
        new_depth: float,
        *,
        project_id: UUID | None = None,
    ) -> None:
        """Propagate a depth change to the coupled partner contact.

        Keeps geo↔litho coupled contacts in sync: moving either end moves
        the other.  Direct session writes only — never re-enters
        ``UpdateFormationContact.execute`` to avoid cross-merge and
        re-propagation.

        **Loop guard:** only writes a target whose ``depth_top_m`` already
        differs from ``new_depth``.  Equal depth → skip.  This terminates
        the cycle: geo→litho sets litho=new; if litho's own execute fires,
        it sees geo already at ``new_depth`` and skips, stopping the cycle.

        When a geo contact is updated as a result of a litho move, the geo
        formation's surface is marked stale so the TIN remains consistent.

        Parameters
        ----------
        updated_contact : FormationContactOrm
            The contact that was just written by ``update_contact``.
        new_depth : float
            The depth value that was applied to ``updated_contact``.
        project_id : UUID | None
            When provided, the geo→litho children query is scoped to models
            that belong to this project (defence-in-depth, debt #211-c).
            The FK already enforces referential integrity; this adds an
            explicit scope filter matching every sibling query in the codebase.
            When ``None`` the scope filter is omitted (backwards-compatible
            with callers that do not supply a project — the FK saves it).
        """
        parent_id = getattr(updated_contact, "parent_geo_contact_id", None)

        if parent_id is not None:
            # ---- LITHO → GEO path ----
            # The updated contact is a litho contact.  Sync its geo parent.
            self.debug(
                f"propagate litho→geo: litho {getattr(updated_contact, 'id', '?')} "
                f"→ geo {parent_id} (new_depth={new_depth}m)"
            )
            geo_contact = await self._session.get(FormationContactOrm, parent_id)
            if geo_contact is None:
                self.debug(f"propagate litho→geo: geo parent {parent_id} not found — skip")
                return
            if abs(geo_contact.depth_top_m - new_depth) <= self._DEPTH_EPSILON_M:
                # Loop guard: geo already at target depth — nothing to write.
                self.debug(f"propagate litho→geo: geo {parent_id} already at {new_depth}m — skip")
                return
            geo_contact.depth_top_m = new_depth
            # Mark the geo formation's surface stale so the TIN is rebuilt
            # on the next explicit "Build" action.
            await self._repo.mark_surfaces_stale([(geo_contact.model_id, geo_contact.formation_id)])
            self.success(f"propagate litho→geo: geo contact {parent_id} depth set to {new_depth}m")
        else:
            # ---- GEO → LITHO path ----
            # The updated contact is a geo contact (or an uncoupled litho
            # contact).  Find all litho children that point at it.
            self.debug(
                f"propagate geo→litho: geo {getattr(updated_contact, 'id', '?')} "
                f"(new_depth={new_depth}m) — scanning for coupled litho children"
            )
            contact_id = getattr(updated_contact, "id", None)
            if contact_id is None:
                # No id available — cannot look up children; skip propagation.
                self.debug("propagate geo→litho: updated_contact has no id — skip")
                return
            children_filters = [FormationContactOrm.parent_geo_contact_id == contact_id]
            if project_id is not None:
                # Defence-in-depth scope filter (debt #211-c): restrict the
                # children lookup to litho contacts in models that belong to
                # this project.  The FK on parent_geo_contact_id already
                # enforces referential integrity; this explicit filter matches
                # the pattern every sibling query in the codebase carries.
                children_filters.append(
                    FormationContactOrm.model_id.in_(
                        select(GeologicalModelOrm.id).where(
                            GeologicalModelOrm.app_project_id == project_id
                        )
                    )
                )
            children_stmt = select(FormationContactOrm).where(*children_filters)
            children = (await self._session.execute(children_stmt)).scalars().all()
            written = 0
            for child in children:
                if abs(child.depth_top_m - new_depth) <= self._DEPTH_EPSILON_M:
                    # Loop guard: already at target depth — skip.
                    self.debug(
                        f"propagate geo→litho: litho {child.id} already at {new_depth}m — skip"
                    )
                    continue
                child.depth_top_m = new_depth
                written += 1
                self.debug(f"propagate geo→litho: litho {child.id} depth set to {new_depth}m")
            if written:
                self.success(
                    f"propagate geo→litho: {written} litho child(ren) depth set to {new_depth}m"
                )
