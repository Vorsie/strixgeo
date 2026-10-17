"""Accept litho suggestions — bulk idempotent use case.

Converts a list of ``LithoLayerSuggestion`` items (from the segmenter) into
committed ``FormationContact`` + ``GeologicalFormation`` rows in the
lithostratigraphic model, then unions every created/found contact id into the
section's ``seeded_formation_contact_ids`` (explicit-content invariant).

A2 BEHAVIOUR (geo-agnostic litho units)
----------------------------------------
Under A2 a suggestion that crosses a geological-formation boundary stays as ONE
litho layer spanning the full [top, base] interval.  Litho units are keyed on
lithology + admixture composition only; ``parent_formation_id`` is always
``None`` on every created row.  The geological name is a derived body-level
label resolved at display time — it is NOT stored per litho unit.

PHASE-1 BOUNDARY (non-negotiable)
-----------------------------------
* ``instance_ordinal`` stays NULL for every row created here.  Phase 2's
  ``resolve_litho_instances`` assigns ordinals.
* No ``litho_correlation_edge`` table.  No ``correlate`` endpoint.  No
  cross-investigation instance resolution.  One file per commit, one phase per
  build window.

FIND-OR-CREATE KEY
------------------
``(litho_main_soil_code, canonical_admixture_signature)``

The *canonical admixture signature* is a deterministic string built from the
admixtures' ``canonical_key()`` pairs (excludes ``locally`` so two otherwise-
identical units that differ only in local/global presence stay in the same
bucket by owner decision).  Signature = ``"|".join(sorted([a.canonical_key()
for a in admixtures]))`` — empty string when no admixtures.

NON-NEGOTIABLE TRAP (recurred 3 × in prior builds)
---------------------------------------------------
Every created AND found contact id MUST be unioned into the section's
``seeded_formation_contact_ids`` before this use case returns.  The caller must
forward ``applyUpdatedSection`` (explicit-content invariant).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.application.litho_formation_lookup import (
    build_litho_formation_lookup,
    canonical_admixture_signature,
    create_litho_formation,
)
from groundmodel.application.litho_geo_link_helpers import (
    load_geo_contacts_at_investigation,
    nearest_geo_contact_within_tolerance,
)
from groundmodel.application.materialize_wedge_tips_for_formation import (
    MaterializeWedgeTipsForFormation,
)
from groundmodel.application.recompute_formation_absences_for_formation import (
    RecomputeFormationAbsencesForFormation,
)
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _map_contact_source_to_layer(contact_source: str) -> str:
    """Map a FormationContact ``source`` token to the litho_layer ``source`` enum.

    The contact-side source set is open (segmenter paths use
    ``'cpt_robertson_2015'`` / ``'borehole_observation'``; manual gestures
    use ``'manual_pick'``). The layer-side set is tighter — see
    ``LithoLayerOrm.source`` CHECK constraint. The mapping preserves the
    "this came from a borehole observation" intent and collapses every
    other provenance into ``'segmenter'`` (still distinct from a
    handheld-drawn ``'manual'`` layer).

    The LL→FC trigger maps back via a similar CASE statement; the
    round-trip is lossy for non-canonical contact sources but the
    intent (observation vs derived) is preserved.
    """
    if contact_source == "borehole_observation":
        return "observation_layer"
    if contact_source == "manual_pick":
        return "manual"
    # Segmenter outputs ('cpt_robertson_2015', 'cpt_robertson_2009', and any
    # future cone-classification token) all collapse here.
    return "segmenter"


@dataclass(frozen=True)
class AcceptLithoResult:
    """Return value of :meth:`AcceptLithoSuggestions.execute`.

    Attributes
    ----------
    created_formation_ids : list[UUID]
        Litho ``GeologicalFormation`` rows created (never already existed).
    found_formation_ids : list[UUID]
        Litho formation rows that already existed and were re-used.
    created_contact_ids : list[UUID]
        ``FormationContact`` rows inserted in this call.
    found_contact_ids : list[UUID]
        ``FormationContact`` rows that already existed (idempotent re-accept).
    updated_section_id : UUID | None
        The section whose seeded set was updated, or ``None`` when no
        ``section_id`` was provided.
    touched_geo_formation_ids : list[UUID]
        Geological formation ids whose geo contacts were snapped to a litho
        depth during this accept (#162 Task 3).  Sorted.  Empty when no
        coupling occurred.  Task 4 consumes this to trigger a surface rebuild
        for every affected geo formation.
    """

    created_formation_ids: list[UUID]
    found_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    found_contact_ids: list[UUID]
    updated_section_id: UUID | None
    touched_geo_formation_ids: list[UUID] = field(default_factory=list)


@dataclass
class BatchAcceptContext:
    """Shared, pre-loaded state for a multi-anchor batch accept (#153 hoist).

    The single-accept path re-loads all of this on every call.  When a batch
    accepts N anchors, the litho-formation lookup is identical across anchors,
    the existing-layer set is loaded once instead of one existence ``SELECT``
    per layer, and the display-order recompute runs once after the batch instead
    of per anchor.  ``BatchAcceptLithoSuggestions`` builds this once and passes
    it to every ``AcceptLithoSuggestions.execute`` call.

    The dicts are MUTATED as the batch proceeds (a formation/contact created for
    anchor *k* is visible to anchor *k+1*), which also dedupes shared litho units
    across anchors for free.

    Attributes
    ----------
    geology_model_id : UUID | None
        Parent geological model id (constant for the batch).
    litho_formations : dict[tuple[str, str], GeologicalFormationOrm]
        Find-or-create lookup keyed by
        ``(litho_main_soil_code, canonical_sig)`` — geo-agnostic under A2.
    existing_layers : dict[tuple, UUID]
        Existing contacts keyed by
        ``(model_id, formation_id, depth_top_m, borehole_id, cpt_id)`` → id.
        Lets ``_find_or_create_contact`` answer in memory instead of a per-layer
        ``SELECT``.  Newly-created contacts are inserted here.
    """

    geology_model_id: UUID | None
    litho_formations: dict[tuple[str, str], GeologicalFormationOrm]
    existing_layers: dict[tuple[UUID, UUID, float, UUID | None, UUID | None], UUID]


class AcceptLithoSuggestions(GroundModelLogger):
    """Bulk idempotent use case: commit litho suggestions to the litho model.

    Supports CPT-anchored and borehole-anchored suggestions.  Both share the
    same find-or-create logic for ``GeologicalFormation`` (litho unit) rows
    and ``FormationContact`` rows.

    The use case is bulk + idempotent by design: re-accepting an investigation
    whose suggestions have not changed is a read-heavy no-op (formation found,
    contact found, nothing inserted).

    Raises
    ------
    ValueError
        When neither ``cpt_id`` nor ``borehole_id`` is provided, or when the
        litho model does not exist in the project, or when the parent geological
        model cannot be found.
    """

    # Half-mm tolerance for the find-or-create layer dedup SQL match.  The
    # stored ``depth_top_m`` is mm-rounded by the contiguity trigger, so an
    # exact ``==`` against a freshly-computed (arithmetic-derived) depth can
    # miss the existing row and double-insert near-identical layers — which
    # the no-overlap CHECK constraint will not catch (debt #218).
    _DEDUP_DEPTH_EPSILON_M = 0.0005

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)
        self._litho_repo = LithoLayerRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        suggestions: list[LithoLayerSuggestion],
        cpt_id: UUID | None = None,
        borehole_id: UUID | None = None,
        section_id: UUID | None = None,
        defer_inference: bool = False,
        commit: bool = True,
        batch_ctx: BatchAcceptContext | None = None,
        couple_tolerance_m: float = 0.20,
    ) -> AcceptLithoResult:
        """Accept a list of litho suggestions for one investigation.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — litho model + investigation must both belong
            to this project.
        litho_model_id : UUID
            Lithostratigraphic model to write contacts into.  Must be
            ``kind='lithostratigraphic'`` (the caller validates this via the
            router).
        suggestions : list[LithoLayerSuggestion]
            Ordered list of suggestions from the segmenter (top → bottom).
        cpt_id : UUID | None
            CPT to anchor contacts on.  Mutually exclusive with
            ``borehole_id``.
        borehole_id : UUID | None
            Borehole to anchor contacts on.  Mutually exclusive with
            ``cpt_id``.
        section_id : UUID | None
            When provided, union all created + found contact ids into this
            section's ``seeded_formation_contact_ids`` (explicit-content
            invariant).
        defer_inference : bool
            When ``True``, skip the R7 inference + wedge-tip pass at the end
            of this call.  Contact-commit and section-seed still run.  The
            caller is responsible for calling
            ``RecomputeAllAbsencesForModel`` once after the full batch of
            deferred accepts.  Defaults to ``False`` (original per-accept
            behaviour).
        commit : bool
            When ``True`` (the default) the session is committed at the end of
            this call.  Pass ``False`` when a caller wraps multiple accepts in
            one transaction (``BatchAcceptLithoSuggestions``) and commits once
            after the whole batch — collapsing N per-anchor commits into one.
        batch_ctx : BatchAcceptContext | None
            Pre-loaded shared state for a batch accept (#153 hoist).  When
            given: the litho-formation lookup is reused (not re-loaded), contact
            find-or-create answers from the in-memory existing-layers dict (no
            per-layer ``SELECT``), and the display-order recompute is skipped
            (the batch caller runs it once after all anchors).  ``None``
            (default) is the self-loading single-accept path.
        couple_tolerance_m : float
            Maximum depth difference (metres) for linking a litho contact to a
            geological contact at the same investigation (#162 Task 3).  When the
            nearest geo contact is within this tolerance, the litho contact's
            ``parent_geo_contact_id`` is set and the geo contact snaps to the
            litho depth.  Default 0.20 m.  Task 7 will expose this in Settings.

        Returns
        -------
        AcceptLithoResult
            Ids of created/found formations and contacts, split statistics, and
            the updated section id if applicable.

        Raises
        ------
        ValueError
            When neither or both of ``cpt_id`` / ``borehole_id`` are set, or
            the litho model is missing / out-of-project.
        """
        if (cpt_id is None) == (borehole_id is None):
            raise ValueError("Exactly one of cpt_id or borehole_id must be set.")

        # Scope-guard the investigation anchor (VULN-10): raises ValueError
        # when the investigation does not exist or belongs to a different project.
        await self._verify_investigation_scope(
            project_id=project_id, cpt_id=cpt_id, borehole_id=borehole_id
        )

        self.info(
            f"AcceptLithoSuggestions.execute: litho_model={litho_model_id}, "
            f"{'cpt' if cpt_id else 'borehole'}={cpt_id or borehole_id}, "
            f"{len(suggestions)} suggestion(s)"
        )

        # Accept is a verbatim copy of the suggestion shape (#149 v2,
        # owner directive 2026-05-27): the pending-ghost view IS the
        # user's intent and accept must not reshape it.  Two adjacent
        # same-litho ghosts produce two contacts; a single merged ghost
        # produces one contact.  The ``merge_adjacent_same_lithology``
        # pass belongs to suggestion-time (segmenter); running it here
        # would silently undo any post-Suggest user editing (split /
        # insert / absorb) the user did before accepting.

        # --- Load litho model + resolve parent geology model id -------------
        # In batch mode the model was validated once when the context was built;
        # reuse the resolved parent id instead of a per-anchor scope read.
        if batch_ctx is not None:
            geology_model_id: UUID | None = batch_ctx.geology_model_id
        else:
            litho_model = await load_scoped_or_raise(
                self._session, GeologicalModelOrm, litho_model_id, project_id, label="Litho model"
            )
            geology_model_id = litho_model.parent_model_id

            # Serialise this accept's writes with a concurrent ``bodies/recompute``
            # on the same model: the formation + layer INSERTs below take FOR-KEY-
            # SHARE row locks on the ``body`` rows recompute re-stamps under the
            # per-model advisory lock, so without the shared lock this writer and
            # recompute deadlock ABBA (BP-2/BP-4). Take the advisory lock (own litho,
            # then the sibling geotech children — a no-op when the model has no
            # geotech child) BEFORE the first write, in the resolver's canonical
            # order. ONLY on the single-accept path: in batch mode
            # ``BatchAcceptLithoSuggestions`` has already taken this same lock once
            # for the whole batch (advisory xact locks are re-entrant, but taking it
            # once keeps the contention log clean — mirrors how ``_run_resolver``
            # reuses its sibling ids without re-locking).
            await lock_body_partition(
                self._session, model_id=litho_model_id, operation="accept-litho-suggestions"
            )
            await lock_sibling_geotech_partitions(
                self._session, litho_model_id=litho_model_id, operation="accept-litho-suggestions"
            )

        # --- Load existing geology contacts at this investigation (#162) ------
        # Used for litho↔geo coupling (#162 Task 3).
        # Each entry is (depth_top_m, formation_id, contact_id).
        geology_contacts_at_inv: list[tuple[float, UUID, UUID]] = []
        if geology_model_id is not None:
            geology_contacts_at_inv = await load_geo_contacts_at_investigation(
                self._session, geology_model_id, cpt_id=cpt_id, borehole_id=borehole_id
            )
            self.debug(
                f"Loaded {len(geology_contacts_at_inv)} geology contact(s) for litho↔geo coupling"
            )

        # --- Load all project formations for lookup --------------------------
        # Keyed by (litho_main_soil_code, canonical_sig) — geo-agnostic under A2.
        # In batch mode the lookup is shared + mutated across anchors (loaded
        # once, and a unit created for one anchor is found by the next).
        litho_formations: dict[tuple[str, str], GeologicalFormationOrm]
        if batch_ctx is not None:
            litho_formations = batch_ctx.litho_formations
        else:
            litho_formations = self._build_litho_formation_lookup(
                await self._repo.list_formations(project_id)
            )

        # --- Main loop: one contact per suggestion ----------------------------
        # A2: each suggestion produces exactly ONE litho layer — no straddle
        # split.  Litho units are keyed by lithology + admixture only;
        # parent_formation_id is always None.
        created_formation_ids: list[UUID] = []
        found_formation_ids: list[UUID] = []
        created_contact_ids: list[UUID] = []
        found_contact_ids: list[UUID] = []
        # Geo formations whose contacts were snapped during coupling (#162 T3).
        touched_geo_formation_ids_set: set[UUID] = set()

        for idx, sug in enumerate(suggestions):
            self.debug(
                f"[{idx + 1}/{len(suggestions)}] suggestion: {sug.suggested_lithology} "
                f"depth={sug.depth_top_m:.2f}–{sug.depth_base_m:.2f}m"
            )

            # Find-or-create the litho formation unit (geo-agnostic key).
            sig = canonical_admixture_signature(sug.suggested_admixtures)
            fkey = (sug.suggested_lithology, sig)
            formation = litho_formations.get(fkey)
            if formation is None:
                formation = await self._create_litho_formation(
                    project_id=project_id,
                    litho_main_soil_code=sug.suggested_lithology,
                    admixtures=sug.suggested_admixtures,
                    sig=sig,
                )
                litho_formations[fkey] = formation
                created_formation_ids.append(formation.id)
                self.debug(
                    f"  Created litho formation {formation.id} — "
                    f"{sug.suggested_lithology} sig='{sig}'"
                )
            else:
                # A formation created earlier in THIS request is in
                # litho_formations + created_formation_ids already — do
                # NOT also list it as "found" (review S1, bookkeeping).
                if (
                    formation.id not in found_formation_ids
                    and formation.id not in created_formation_ids
                ):
                    found_formation_ids.append(formation.id)
                self.debug(
                    f"  Found litho formation {formation.id} — "
                    f"{sug.suggested_lithology} sig='{sig}'"
                )

            # A4 cleanup — native LithoLayer write. The LL→FC trigger
            # mirrors an accepted layer into formation_contact so legacy
            # readers stay coherent. Source enum maps to the litho_layer
            # source set: contact 'borehole_observation' ↔ layer
            # 'observation_layer'; everything else maps to 'segmenter'.
            # ``layer_id`` is the LithoLayer PK; the LL→FC trigger mirrors
            # it onto a formation_contact row with the SAME UUID, so it
            # doubles as the contact id that seeds the section
            # (created_contact_ids / found_contact_ids).
            layer_id, was_created = await self._find_or_create_layer(
                litho_model_id=litho_model_id,
                formation_id=formation.id,
                depth_top_m=sug.depth_top_m,
                depth_base_m=sug.depth_base_m,
                borehole_id=borehole_id,
                cpt_id=cpt_id,
                confidence=sug.confidence.value.lower(),
                source=_map_contact_source_to_layer(sug.source),
                existing_layers=batch_ctx.existing_layers if batch_ctx else None,
            )
            if was_created:
                created_contact_ids.append(layer_id)
            else:
                found_contact_ids.append(layer_id)

            # Litho↔geo coupling (#162 Task 3): link the litho contact
            # to the nearest geo contact within couple_tolerance_m and
            # snap the geo contact's depth to match the litho depth.
            # Only new contacts are coupled — re-accepts that found an
            # existing contact leave its existing coupling unchanged so
            # a re-accept never silently snaps a geo contact a second
            # time if the litho depth has since been dragged.
            #
            # BUT a re-accept that finds the layer with NO coupling restores
            # the LINK — snap still skipped (owner ruling 2026-08-11, audit
            # F34: "it shouldn't be that easy to unlink them"). The old skip
            # threw the link out with the snap: delete + re-accept was enough
            # to leave a litho row sitting bit-for-bit on a geological contact
            # with no parent_geo_contact_id, and the dev model grew two.
            if not was_created and geology_contacts_at_inv:
                existing_layer = await self._session.get(LithoLayerOrm, layer_id)
                if existing_layer is not None and existing_layer.parent_geo_contact_id is None:
                    relink_id = nearest_geo_contact_within_tolerance(
                        existing_layer.depth_top_m, geology_contacts_at_inv, couple_tolerance_m
                    )
                    if relink_id is not None:
                        existing_layer.parent_geo_contact_id = relink_id
                        self.info(
                            f"  Restored severed litho→geo link: layer {layer_id} "
                            f"re-coupled to {relink_id} (no snap)"
                        )
            if was_created and geology_contacts_at_inv:
                geo_contact_id = nearest_geo_contact_within_tolerance(
                    sug.depth_top_m, geology_contacts_at_inv, couple_tolerance_m
                )
                if geo_contact_id is not None:
                    # Set parent_geo_contact_id on the LITHO LAYER row
                    # (A4 cleanup — LL is the source of truth). The
                    # LL→FC trigger mirrors the coupling label onto the
                    # FC mirror.
                    litho_layer = await self._session.get(LithoLayerOrm, layer_id)
                    if litho_layer is not None:
                        litho_layer.parent_geo_contact_id = geo_contact_id
                        geo_contact = await self._session.get(FormationContactOrm, geo_contact_id)
                        if geo_contact is not None and geo_contact.depth_top_m != sug.depth_top_m:
                            # Geo follows litho: snap the geological
                            # contact's depth to the litho boundary so
                            # both levels agree at the same physical
                            # surface (#162).
                            old_geo_depth = geo_contact.depth_top_m
                            geo_contact.depth_top_m = sug.depth_top_m
                            touched_geo_formation_ids_set.add(geo_contact.formation_id)
                            self.debug(
                                f"  Coupled litho contact {layer_id} → "
                                f"geo contact {geo_contact_id} "
                                f"(snapped geo depth {old_geo_depth:.3f}m → "
                                f"{sug.depth_top_m:.3f}m, "
                                f"geo formation {geo_contact.formation_id})"
                            )
                        else:
                            self.debug(
                                f"  Coupled litho contact {layer_id} → "
                                f"geo contact {geo_contact_id} (depths already match)"
                            )

        # Stale-flag surfaces for affected (litho_model, formation) pairs.
        if created_contact_ids:
            all_formation_ids = set(created_formation_ids) | set(found_formation_ids)
            await self._repo.mark_surfaces_stale(
                [(litho_model_id, fid) for fid in all_formation_ids]
            )
            await self._litho_repo.mark_litho_solids_stale(litho_model_id)

        # Recompute display_order for litho formations whenever new formation
        # rows OR new contacts were created.  The sort encodes the superposition
        # rule: lower display_order = older = deeper (matches the geological
        # model convention and the section/3D paint order in ContactsLayer +
        # Geology3DViewer).
        #
        # The gate includes new CONTACTS, not just new FORMATION rows: a new
        # shallower contact for an EXISTING formation lowers that formation's
        # min-depth (the recompute ranks by shallowest contact, deeper = lower
        # rank), which can flip its rank against its neighbours WITHOUT creating
        # a formation row.  Gating on formations alone left that rank stale
        # . Re-accepts that create neither a formation
        # nor a contact (found_* only) skip the recompute — existing ranks are
        # already correct.
        #
        # In batch mode the display-order recompute is deferred to a single
        # pass after every anchor commits (the per-anchor recompute scans the
        # whole — growing — contact set, so running it N times is O(N²)).
        if (created_formation_ids or created_contact_ids) and batch_ctx is None:
            await self._recompute_litho_display_orders(litho_model_id=litho_model_id)

        # Trigger inference engine for every formation that received a new
        # contact.  New contacts change the corridor's observation-data
        # snapshot so existing inferred absences may need updating.
        # Re-accepts (found_contact_ids) are included: the user may be
        # re-accepting after a re-segmentation, and the prior inference may
        # be stale.  commit=False defers the commit so all accept mutations
        # and absence deltas share one atomic transaction.
        #
        # defer_inference=True: skip the R7 inference + wedge-tip pass so
        # bulk-accept loops (N anchors) do not each re-run inference across
        # all formations.  The caller calls RecomputeAllAbsencesForModel once
        # after the batch instead.
        #
        if defer_inference:
            self.debug(
                "AcceptLithoSuggestions: skipping inference — deferred inference "
                "(batch mode) — caller must call RecomputeAllAbsencesForModel "
                "after the batch"
            )
        elif created_contact_ids or found_contact_ids:
            affected_formation_ids = set(created_formation_ids) | set(found_formation_ids)
            inference_uc = RecomputeFormationAbsencesForFormation(self._session)
            materialize_uc = MaterializeWedgeTipsForFormation(self._session)
            total_affected = len(affected_formation_ids)
            for i, fid in enumerate(sorted(affected_formation_ids), start=1):
                self.debug(
                    f"[{i}/{total_affected}] AcceptLithoSuggestions: "
                    f"triggering absence inference for formation {fid}"
                )
                await inference_uc.execute(
                    project_id=project_id,
                    model_id=litho_model_id,
                    formation_id=fid,
                    commit=False,
                )
                self.debug(
                    f"[{i}/{total_affected}] AcceptLithoSuggestions: "
                    f"materialising wedge tips for formation {fid}"
                )
                await materialize_uc.execute(
                    project_id=project_id,
                    model_id=litho_model_id,
                    formation_id=fid,
                    commit=False,
                )

        touched_geo_formation_ids = sorted(touched_geo_formation_ids_set)
        if commit:
            await self._session.commit()
        self.success(
            f"AcceptLithoSuggestions: litho_model={litho_model_id} — "
            f"{len(created_contact_ids)} contact(s) created, "
            f"{len(found_contact_ids)} found, "
            f"{len(touched_geo_formation_ids)} geo formation(s) snapped"
        )

        return AcceptLithoResult(
            created_formation_ids=created_formation_ids,
            found_formation_ids=found_formation_ids,
            created_contact_ids=created_contact_ids,
            found_contact_ids=found_contact_ids,
            updated_section_id=section_id,
            touched_geo_formation_ids=touched_geo_formation_ids,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_litho_formation_lookup(
        self,
        project_formations: list[GeologicalFormationOrm],
    ) -> dict[tuple[str, str], GeologicalFormationOrm]:
        """Build the find-or-create lookup from a project's formation rows.

        Keyed by ``(litho_main_soil_code, canonical_admixture_signature)`` —
        geo-agnostic under A2.  Geological (non-litho) rows are skipped.
        Shared by the single-accept load path and :meth:`build_batch_context`
        so both index identically.

        Under A2, two old rows that differ only in ``parent_formation_id``
        collapse to one bucket; the later row wins.  In practice the DB is
        cleared on schema change (pre-ship amnesty) so no silent collision
        occurs.

        Parameters
        ----------
        project_formations : list[GeologicalFormationOrm]
            All formation rows for the project.

        Returns
        -------
        dict[tuple[str, str], GeologicalFormationOrm]
            The find-or-create lookup keyed by
            ``(litho_main_soil_code, canonical_admixture_sig)``.
        """
        # Delegates to the shared helper (CLAUDE.md "extract on the second copy":
        # EditLithoLayerComposition is the second user of this find-or-create).
        return build_litho_formation_lookup(project_formations)

    async def _verify_investigation_scope(
        self,
        *,
        project_id: UUID,
        cpt_id: UUID | None,
        borehole_id: UUID | None,
    ) -> None:
        """Assert the investigation anchor belongs to ``project_id`` (VULN-10).

        Raises ``ValueError`` when the investigation row does not exist or
        belongs to a different project.  No data is returned — the check is
        purely a scope guard before any contact is written.

        Parameters
        ----------
        project_id : UUID
            Expected owning project.
        cpt_id : UUID | None
        borehole_id : UUID | None
        """
        if cpt_id is not None:
            await load_scoped_or_raise(self._session, CptOrm, cpt_id, project_id, label="CPT")
        else:
            # execute() refuses neither / both before calling this, so the else
            # arm always carries a borehole id.
            assert borehole_id is not None
            await load_scoped_or_raise(
                self._session, BoreholeOrm, borehole_id, project_id, label="Borehole"
            )

    async def _load_existing_layers(
        self,
        litho_model_id: UUID,
    ) -> dict[tuple[UUID, UUID, float, UUID | None, UUID | None], UUID]:
        """Load all accepted layers in a model as a find-or-create idempotency map.

        Keyed by ``(model_id, formation_id, depth_top_m, borehole_id, cpt_id)``
        → layer id, matching the key :meth:`_find_or_create_layer` uses. A
        batch loads this once instead of issuing one existence ``SELECT`` per
        layer.

        A4 cleanup: queries ``litho_layer`` (the Shape A source of truth)
        rather than ``formation_contact`` (the legacy mirror, still kept in
        sync via the LL↔FC trigger pair). The returned layer id doubles as
        the mirrored contact id (same UUID end-to-end), so the seed path
        consumes these values directly as contact ids.

        Parameters
        ----------
        litho_model_id : UUID
            The lithostratigraphic model to load layers for.

        Returns
        -------
        dict
            ``key → layer_id`` for every accepted layer currently in the
            model. Pending / rejected layers are excluded — only committed
            boundaries count for the find-or-create idempotency check.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.formation_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.cpt_id,
                ).where(
                    LithoLayerOrm.model_id == litho_model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        return {
            (litho_model_id, r.formation_id, r.depth_top_m, r.borehole_id, r.cpt_id): r.id
            for r in rows
        }

    async def build_batch_context(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
    ) -> BatchAcceptContext:
        """Load the shared state a multi-anchor batch accept reuses (#153 hoist).

        Reads, once: the parent geology model id (+ scope guard), the
        litho-formation find-or-create lookup, and the existing-layer
        idempotency map.  Pass the result as ``batch_ctx`` to each
        :meth:`execute` call so none of these is re-loaded per anchor.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        litho_model_id : UUID
            The lithostratigraphic model the batch writes into.

        Returns
        -------
        BatchAcceptContext

        Raises
        ------
        ValueError
            When the litho model is missing / out of project.
        """
        litho_model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, litho_model_id, project_id, label="Litho model"
        )
        geology_model_id: UUID | None = litho_model.parent_model_id

        litho_formations = self._build_litho_formation_lookup(
            await self._repo.list_formations(project_id)
        )
        existing_layers = await self._load_existing_layers(litho_model_id)

        return BatchAcceptContext(
            geology_model_id=geology_model_id,
            litho_formations=litho_formations,
            existing_layers=existing_layers,
        )

    async def _create_litho_formation(
        self,
        *,
        project_id: UUID,
        litho_main_soil_code: str,
        admixtures: tuple[Admixture, ...],
        sig: str,
    ) -> GeologicalFormationOrm:
        """Insert a new lithostratigraphic formation (unit) row.

        Under A2 all litho units are geo-agnostic: ``parent_formation_id`` is
        always ``None`` and ``parent_extrapolated`` is always ``False``.

        The name is auto-derived from the soil code + admixtures so the user
        can distinguish units in the inspector before Phase 2 ordinal resolution.
        ``instance_ordinal`` stays NULL (Phase 2 assigns).

        Parameters
        ----------
        project_id : UUID
        litho_main_soil_code : str
            BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
        admixtures : tuple[Admixture, ...]
        sig : str
            Canonical admixture signature (pre-computed by caller).

        Returns
        -------
        GeologicalFormationOrm
            The freshly flushed row (id assigned, not yet committed).
        """
        # Entry log (DoD §1): a private helper that flushes a real row logs
        # its key params so a failed flush correlates to the inputs.
        self.debug(f"  _create_litho_formation: soil={litho_main_soil_code} sig='{sig}'")

        # Delegates to the shared helper (CLAUDE.md "extract on the second copy":
        # EditLithoLayerComposition creates litho units by the same rule).
        return await create_litho_formation(
            self._session,
            project_id=project_id,
            litho_main_soil_code=litho_main_soil_code,
            admixtures=admixtures,
            sig=sig,
        )

    async def _recompute_litho_display_orders(
        self,
        *,
        litho_model_id: UUID,
    ) -> None:
        """Assign compact, stratigraphically-ordered display_order values to
        all litho formations that have at least one contact in ``litho_model_id``.

        **Encoding (why this shape):**
        Lower ``display_order`` = older = deeper — the project-wide superposition
        convention used by ``ContactsLayer.tsx`` (paint order) and
        ``Geology3DViewer.tsx`` (z-offset per unit).  Keeping values compact
        (0 … N-1) is load-bearing for the 3D viewer: it multiplies
        ``display_order`` by ``Z_OFFSET_PER_ORDER = 0.2 m`` — a large integer
        would visually displace surfaces by tens of metres.

        **Sort key:**

        1. ``parent_geo.display_order ASC`` — older geological parent occupies
           the lower band (the parent's own age-axis position is the coarse key).
        2. ``min_contact_depth DESC`` — within a parent band, the deeper unit
           (larger depth value) is older and gets the lower rank.

        **Idempotency:** the same set of contacts always produces the same
        sorted order, so a re-accept with unchanged suggestions is a no-op on
        every formation's ``display_order``.

        **Geological/non-litho rows untouched:** only formations that have
        a contact in ``litho_model_id`` are touched; geological-model
        formations have no contacts in the litho model and are never loaded
        or mutated here.

        Parameters
        ----------
        litho_model_id : UUID
            The lithostratigraphic model whose formation display orders are
            being recomputed.  Only formations with contacts in this model
            are considered.
        """
        # -- Step 1: collect formation ids + shallowest layer depth ----------
        # A4 cleanup: query litho_layer (Shape A source of truth, accepted
        # rows only — pending suggestions don't carry display-order intent).
        contacts_stmt = select(
            LithoLayerOrm.formation_id,
            LithoLayerOrm.depth_top_m,
        ).where(
            LithoLayerOrm.model_id == litho_model_id,
            LithoLayerOrm.status == "accepted",
        )
        contact_rows = (await self._session.execute(contacts_stmt)).all()

        if not contact_rows:
            self.debug(
                f"_recompute_litho_display_orders: no layers in model {litho_model_id}, skip"
            )
            return

        # Shallowest contact depth per formation (= the formation's top in
        # this model).  Deeper formations will have a larger minimum depth.
        min_depth_by_fid: dict[UUID, float] = {}
        for row in contact_rows:
            fid: UUID = row.formation_id
            if fid not in min_depth_by_fid or row.depth_top_m < min_depth_by_fid[fid]:
                min_depth_by_fid[fid] = row.depth_top_m

        # -- Step 2: load the litho formation ORM rows ------------------------
        formation_ids = list(min_depth_by_fid.keys())
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.id.in_(formation_ids)
        )
        formations: list[GeologicalFormationOrm] = list(
            (await self._session.execute(formations_stmt)).scalars().all()
        )
        self.debug(
            f"_recompute_litho_display_orders: {len(formations)} formation(s) in model "
            f"{litho_model_id}"
        )

        # -- Step 3: load parent geological formation display_orders -----------
        parent_ids = {
            f.parent_formation_id for f in formations if f.parent_formation_id is not None
        }
        parent_order: dict[UUID, int] = {}
        if parent_ids:
            parents_stmt = select(
                GeologicalFormationOrm.id,
                GeologicalFormationOrm.display_order,
            ).where(GeologicalFormationOrm.id.in_(parent_ids))
            for prow in (await self._session.execute(parents_stmt)).all():
                parent_order[prow.id] = prow.display_order

        # -- Step 4: sort by (parent age ASC, unit depth DESC) ----------------
        # parent_order ASC  = older geological parent first (lower band number)
        # -min_depth        = deeper (larger depth) sorts before shallower →
        #                     deeper unit gets lower rank index → lower
        #                     display_order → correctly "older"
        def _sort_key(f: GeologicalFormationOrm) -> tuple[int, float, str]:
            # Parentless rows (geological parent deleted under ON DELETE
            # SET NULL) fall back to band 0 — they interleave with the
            # oldest parent's band. Acceptable today (deleting a parent
            # with live litho children is a UI-blocked path); if that
            # path ever opens, segregate them with float('inf') instead.
            p_order = (
                parent_order.get(f.parent_formation_id, 0)
                if f.parent_formation_id is not None
                else 0
            )
            # Negate depth so a deeper unit (larger depth) sorts first,
            # receiving a lower rank index (= lower display_order = older).
            # `f.name` is the deterministic tiebreak (review S1): two units
            # sharing a min depth (e.g. ZAND + KLEI both topping at 0.0 m
            # on different boreholes of one investigation) must NOT depend
            # on SQLAlchemy/Postgres row order — that is unstable across
            # sessions and would flip ranks between accepts, defeating
            # idempotency.
            return (p_order, -min_depth_by_fid[f.id], f.name)

        formations_sorted = sorted(formations, key=_sort_key)

        # -- Step 5: write compact ranks (update only changed rows) -----------
        updated = 0
        for rank, formation in enumerate(formations_sorted):
            if formation.display_order != rank:
                p_ord = (
                    parent_order.get(formation.parent_formation_id, 0)
                    if formation.parent_formation_id is not None
                    else 0
                )
                self.debug(
                    f"  display_order: formation={formation.id} name={formation.name!r} "
                    f"{formation.display_order} → {rank} "
                    f"(parent_order={p_ord}, "
                    f"min_depth={min_depth_by_fid[formation.id]:.2f}m)"
                )
                formation.display_order = rank
                updated += 1

        if updated:
            await self._session.flush()
            self.info(
                f"_recompute_litho_display_orders: updated display_order for "
                f"{updated}/{len(formations)} formation(s) in model {litho_model_id}"
            )
        else:
            self.debug(
                f"_recompute_litho_display_orders: all {len(formations)} formation(s) "
                "already at correct display_order (no-op)"
            )

    async def _find_or_create_layer(
        self,
        *,
        litho_model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        depth_base_m: float,
        borehole_id: UUID | None,
        cpt_id: UUID | None,
        confidence: str,
        source: str,
        existing_layers: dict[tuple[UUID, UUID, float, UUID | None, UUID | None], UUID]
        | None = None,
    ) -> tuple[UUID, bool]:
        """Idempotent layer find-or-create (A4 cleanup — was contact).

        Writes ``LithoLayerOrm`` with ``status='accepted'`` rather than
        ``FormationContactOrm`` — Shape A native. The LL→FC trigger mirrors
        the accepted layer into formation_contact so legacy /contacts
        readers + correlation FK (now on litho_layer post 4a) stay coherent.

        Parameters
        ----------
        litho_model_id : UUID
        formation_id : UUID
        depth_top_m : float
        depth_base_m : float
            Layer base depth.  Required by the LL CHECK (top < base); the
            LL→FC trigger ignores it on the FC mirror (FC has no base concept).
        borehole_id : UUID | None
        cpt_id : UUID | None
        confidence : str
            Lowercased confidence string (``"high"`` / ``"medium"`` / ``"low"``).
        source : str
            Layer provenance token in the LL source enum
            (``"segmenter"``, ``"manual"``, ``"observation_layer"``,
            ``"observation_interpretation"``). The caller maps the original
            contact source via ``_map_contact_source_to_layer``.
        existing_layers : dict | None
            Batch mode (#153): a pre-loaded
            ``key → layer_id`` map for the model, keyed by
            ``(model_id, formation_id, depth_top_m, borehole_id, cpt_id)``.
            When given, the idempotency check is answered in memory
            (no per-layer ``SELECT``) and a newly-created layer's id is
            added back to the map.  When ``None`` the single-accept path
            runs the existence ``SELECT`` against ``litho_layer``.

        Returns
        -------
        tuple[UUID, bool]
            ``(layer_id, was_created)``. The id doubles as the contact id
            for the trigger-mirrored FC row (UUID preserved end-to-end).
        """
        # ``depth_top_m`` is part of the idempotency key. Without it, a
        # re-accept after a re-segmentation that moved the boundary would
        # match the OLD layer on (model, formation, anchor) alone and
        # silently keep the stale depth (review B1). Float match is safe
        # for the idempotent path: an unchanged suggestion yields a
        # bit-identical depth from the same pipeline.
        key = (litho_model_id, formation_id, depth_top_m, borehole_id, cpt_id)

        if existing_layers is not None:
            hit = existing_layers.get(key)
            if hit is not None:
                return hit, False
        else:
            anchor_filter = (
                LithoLayerOrm.borehole_id == borehole_id
                if borehole_id is not None
                else LithoLayerOrm.cpt_id == cpt_id
            )
            existing_stmt = select(LithoLayerOrm.id).where(
                LithoLayerOrm.model_id == litho_model_id,
                LithoLayerOrm.formation_id == formation_id,
                # ±half-mm window, not ``==`` — the stored depth is mm-rounded
                # while ``depth_top_m`` here is arithmetic-derived (debt #218).
                LithoLayerOrm.depth_top_m.between(
                    depth_top_m - self._DEDUP_DEPTH_EPSILON_M,
                    depth_top_m + self._DEDUP_DEPTH_EPSILON_M,
                ),
                LithoLayerOrm.status == "accepted",
                anchor_filter,
            )
            existing_id = (await self._session.execute(existing_stmt)).scalar_one_or_none()
            if existing_id is not None:
                self.trace(
                    f"  Layer already exists: {existing_id} "
                    f"(formation={formation_id}, depth={depth_top_m:.2f}–{depth_base_m:.2f}m)"
                )
                return existing_id, False

        layer = LithoLayerOrm(
            id=uuid7(),
            model_id=litho_model_id,
            formation_id=formation_id,
            depth_top_m=depth_top_m,
            depth_base_m=depth_base_m,
            status="accepted",
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            source=source,
            confidence=confidence,
        )
        self._session.add(layer)
        if existing_layers is not None:
            existing_layers[key] = layer.id
        else:
            await self._session.flush()
            self.trace(
                f"  Layer created: {layer.id} "
                f"(formation={formation_id}, depth={depth_top_m:.2f}–{depth_base_m:.2f}m)"
            )
        return layer.id, True
