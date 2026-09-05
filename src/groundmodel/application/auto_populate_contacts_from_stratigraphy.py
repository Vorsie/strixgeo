"""Auto-populate FormationContact rows from a borehole's stratigraphy.

The geological-model editor's "Seed from stratigraphy" button
funnels through this use case. Per borehole:

* Resolve both stratigraphy streams: FORMAL_STRATIGRAPHY (the
  standardized regional classification, e.g. ``HyEg - Lid van
  Egem``) and INFORMAL_STRATIGRAPHY (the engineer's working name,
  e.g. ``Boom Klei``).
* Walk the FORMAL stream as the primary layer source (formal is
  the authoritative regional model). Fall through to walking the
  INFORMAL stream only when the borehole carries no formal
  observation.
* For each primary layer (including the topmost — ``top_m == 0`` is
  a valid contact, the top of the topmost formation), find a
  counterpart in the OTHER stream by max-overlap of the two
  intervals.
* Build the formation with the split DOV convention:
    name         = informal description (working name)
    regional_ref = formal description   (regional reference)
  Falling back to the primary stream's own description on whichever
  field has no counterpart.
* Match formations across boreholes by ``regional_ref`` when
  present (stable cross-borehole key — same formal code = same
  formation), falling back to ``name`` otherwise.
* Create a FormationContact at the layer's top depth, linked to
  the source observation + layer via ``observation_layer_id`` so
  re-running the button is idempotent.

The use case owns transaction discipline: one commit for the whole
batch. A partial-failure (e.g. FK violation mid-loop) rolls
everything back via the session's auto-rollback.

Stable identity key
-------------------
Every layer resolves to a ``(name, regional_ref, key)`` triple via
``_derive_layer_names_and_key``.  The **stable key** is defined as:

    key = regional_ref  (when formal stratigraphy is present — stable
                         cross-borehole code independent of working name)
    key = name          (when informal-only — working name is the only
                         available identifier)

The discover scan (``scan_stratigraphy_candidates``) and the write
path (``AutoPopulateContactsFromStratigraphy.execute``) BOTH call
this single function, so the key used during candidate discovery is
provably identical to the key used during formation find-or-create.
The ``selected_keys`` filter on ``execute`` is expressed in these
stable keys, not in display names.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.application.auto_populate_outcome import AutoPopulateOutcome
from groundmodel.application.lumping_collision import LumpingCollision

# The bridge/resolution helpers and the candidate scan were extracted to
# ``stratigraphy_bridge`` / ``stratigraphy_scan`` (debt #178/#201). The names
# the class body and existing importers use are imported here (same facade
# pattern as ``normalize_formation_key`` above).
from groundmodel.application.stratigraphy_bridge import (
    _best_overlap,
    _derive_layer_names_and_key,
    _find_observation,
    _resolve_codelist_canonical,
    _resolve_lumped_key,
    build_formal_informal_bridge,
)
from groundmodel.application.stratigraphy_candidate import StratigraphyCandidate
from groundmodel.application.stratigraphy_scan import (
    _palette_colour_for,
    scan_stratigraphy_candidates,
)
from groundmodel.domain.services.formation_age_order_constants import is_anthropogenic
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.codelists.g3dv3_catalog import get_catalog
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.constants.auto_populate_mode import AutoPopulateMode
from groundmodel.shared.formation_key import normalize_formation_key
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Re-export value objects so existing importers that reference this module directly
# keep working without change — they imported StratigraphyCandidate, LumpingCollision,
# and AutoPopulateOutcome from here before the S3 extraction.
__all__ = [
    "AutoPopulateOutcome",
    "LumpingCollision",
    "StratigraphyCandidate",
    "normalize_formation_key",
    "build_formal_informal_bridge",
    "scan_stratigraphy_candidates",
    "AutoPopulateContactsFromStratigraphy",
]

_logger = LoggerFactory.get_logger(__name__)


# ``normalize_formation_key`` now lives in ``groundmodel.shared.formation_key``
# (relocated 2026-05-18 for #59 — the infra DOV-formal codelist is a second,
# cross-layer consumer; importing it upward from here would be an
# infrastructure→application violation + an import cycle). It is imported
# above and kept in ``__all__`` so existing API-/app-/test-layer importers
# of ``...auto_populate_contacts_from_stratigraphy.normalize_formation_key``
# keep working unchanged.


class AutoPopulateContactsFromStratigraphy(GroundModelLogger):
    """Seed a geological model with contacts derived from DOV stratigraphy."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        borehole_ids: Iterable[UUID],
        selected_keys: list[str] | None = None,
        manual_map: dict[str, str] | None = None,
        section_id: UUID | None = None,
        bridge: dict[str, str] | None = None,
        create_missing_formations: bool = True,
        mode: AutoPopulateMode | str = AutoPopulateMode.ADD,
    ) -> AutoPopulateOutcome:
        """Walk every borehole in scope and seed contacts.

        Parameters
        ----------
        project_id : UUID
            The owning project — bounds the formation-name lookup so
            we don't reuse a formation belonging to a different
            project.
        model_id : UUID
            Geological model under which the new contacts land.
        borehole_ids : Iterable[UUID]
            Boreholes to process. Typically the set projected onto
            the active cross-section. Caller is responsible for
            scoping; this use case doesn't filter further.
        selected_keys : list[str] or None, optional
            When provided, only layers whose effective key (after
            applying ``manual_map``) is in this set are processed.
            Layers for other keys are silently skipped.

            Whether the UNSELECTED formations are also deleted is decided
            by ``mode``, NOT by the presence of this list.  Until
            2026-08-03 the two were welded together, which is how a Fill
            run intended to add one unit silently deleted four saved ones.
            In ``overwrite`` mode this method deletes — in the same
            transaction — every formation that (a) already exists in this
            project, (b) has at least one contact in THIS model
            (model-scoped, never cross-model), and (c) whose canonical key
            is NOT in this set.  The delete is server-side so the client
            never needs to recompute canonical keys from raw names.

            When ``None`` (default), all layers are processed and NO
            formations are deleted regardless of ``mode`` — preserving the
            existing behaviour of ``handleAutoPopulateFromStratigraphy``
            (the Sections "Seed from stratigraphy" path), which is
            unaffected by this change.

            Orphan safety: when ``selected_keys`` is provided, any
            ``FormationContactOrm`` rows whose ``formation_id`` maps to a
            formation whose stable key is in ``selected_keys`` but whose
            ``observation_layer_id`` is NULL (orphaned from a prior failed
            run) are deleted before the idempotency check so they cannot
            suppress re-creation.
        manual_map : dict[str, str] or None, optional
            Optional ``{ normalize_formation_key(raw) -> target_formation_name }``
            mapping built by the user's lumping dialog.  When provided,
            layers whose raw key is in the map are folded into the target
            formation instead of creating a separate formation per raw name.

            The dialog sends the SAME map it used for the discover preview
            (``scan_stratigraphy_candidates``), which ensures the
            discover≡apply invariant: the user sees exactly the same
            effective keys, formation names, and collision warnings in the
            preview that the write path will produce.

            ``None`` (default) = no lumping; every raw key becomes its own
            formation (today's behaviour, fully backward-compatible).
        section_id : UUID or None, optional
            When provided (the "Seed from stratigraphy" path), the use case
            additionally collects ``found_contact_ids`` — ids of contacts
            that already existed in the model for the processed borehole
            scope and were skipped for idempotency.  The caller (the router)
            unions ``created_contact_ids ∪ found_contact_ids`` and PATCHes
            the section's ``seeded_formation_contact_ids`` so pre-existing
            contacts from a prior Fill or manual draw are also seeded.
            When ``None`` (the Fill-from-boreholes path), ``found_contact_ids``
            is always empty — Fill manages its own formation lifecycle and
            does not touch section seeds.
        bridge : dict[str, str] or None, optional
            Formal→informal equivalence map produced by
            ``build_formal_informal_bridge``.  When provided, formal-only
            layers whose code is in the map are resolved to the bridged
            informal key so they merge with informal-only layers for the same
            geological unit across boreholes.  ``None`` (default) = no bridge.
            The caller (``AutoPopulateContactsFromStratigraphy.execute`` callers
            in the API routers) computes this ONCE per request and passes it in
            so the discover≡apply≡seed invariant holds.  Precedence (revised
            2026-05-18, "lump wins over bridge"): a RAW-key lump wins outright;
            the bridge runs only for unlumped raw keys.  See
            ``_resolve_lumped_key``.
        create_missing_formations : bool, optional
            ``True`` (default, the Fill-from-boreholes path) — when a layer's
            resolved key has no existing project formation, MINT one. Fill is
            the model-definition step; creating is its job.

            ``False`` (the Sections "Seed from stratigraphy" path) — NEVER
            create a formation. A layer whose resolved key matches no existing
            project formation is skipped and counted in
            ``skipped_not_in_model``. This enforces the CLAUDE.md
            explicit-content invariant (owner directive 2026-05-17): Seed
            places contacts only for formations the user has already kept and
            never expands the model. Without this flag the unfiltered Seed
            path (``selected_keys=None``) created formations for any
            in-corridor borehole layer — the "Seed added Formatie van Ieper /
            a second Roubaix" bug.
        mode : AutoPopulateMode or str, optional
            ``AutoPopulateMode.ADD`` (default) — create / update the selected
            keys only; the deletion pass is SKIPPED entirely and no existing
            formation is ever removed.  ``AutoPopulateMode.OVERWRITE`` — the
            model becomes exactly the selection (the pre-2026-08-03
            behaviour).

            WHY add is the default: the destructive branch must be opted
            into.  An old client, a forgotten field, or a caller that only
            wanted to add a unit must not be able to delete the engineer's
            saved model by omission — that is exactly the failure this
            parameter exists to close.

        Returns
        -------
        AutoPopulateOutcome
            Counts + ids so the API layer can build a meaningful
            response and the frontend can patch local state by id.
        """
        borehole_id_list = list(borehole_ids)
        # Coerce the wire value ONCE, here, so every downstream branch reads a
        # real enum member. An unrecognised string is a programming error at
        # the API boundary (Pydantic rejects it first), so ValueError is the
        # right failure — silently falling back to a mode would either
        # under-delete or, far worse, over-delete.
        resolved_mode = AutoPopulateMode(mode)
        selected_key_set: frozenset[str] | None = (
            frozenset(selected_keys) if selected_keys is not None else None
        )
        # Normalise the incoming keys through the SAME function the scan
        # used to mint them, so the filter is robust even if a client
        # round-trips a raw description. Pre-computed once → the two
        # per-layer checks below stay O(N) total, not O(N²). None on the
        # all-keys path.
        selected_key_set_norm: frozenset[str] | None = (
            frozenset(normalize_formation_key(k) for k in selected_key_set)
            if selected_key_set is not None
            else None
        )
        self.info(
            f"Auto-populate: model={model_id} boreholes={len(borehole_id_list)} "
            f"selected_keys={len(selected_key_set) if selected_key_set is not None else 'all'} "
            f"manual_map={len(manual_map) if manual_map else 0} "
            f"bridge={len(bridge) if bridge else 0} "
            f"mode={resolved_mode.value}"
        )
        if not borehole_id_list and selected_key_set_norm is None:
            # No boreholes + no key filter → nothing to do (unfiltered Seed path).
            # When selected_keys IS provided we must still run the delete step
            # even with an empty borehole list (e.g. the user deselected all
            # formations after a prior Fill run).
            return AutoPopulateOutcome(
                created_contact_ids=[],
                created_formation_ids=[],
                deleted_formation_ids=[],
                skipped_existing=0,
                skipped_unmatched=0,
                skipped_no_stratigraphy=0,
                found_contact_ids=[],
                mode=resolved_mode.value,
            )

        # Eager-load every observation + every layer for every borehole
        # in scope in one round-trip. Stratigraphy streams are small
        # (typically <30 layers per borehole) so the up-front load
        # outweighs per-borehole lazy fetches.
        bh_stmt = (
            select(BoreholeOrm)
            .where(
                BoreholeOrm.id.in_(borehole_id_list),
                BoreholeOrm.app_project_id == project_id,
            )
            .options(selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers))
        )
        boreholes = list((await self._session.execute(bh_stmt)).scalars().all())

        # Pre-load every project formation. Two indices: stable
        # cross-borehole key (regional_ref — formal stratigraphy code)
        # and a fallback name index for informal-only formations.
        # Lookups are case-insensitive — DOV layer descriptions arrive
        # in mixed case across imports.
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.app_project_id == project_id
        )
        existing_formations = list((await self._session.execute(formations_stmt)).scalars().all())
        # Single normalised-key index. Keying on the SAME canonical key
        # the scan returns means two existing formations that differ
        # only by dash/space/case or chrono prefix collapse to one slot,
        # so the write path stops re-creating the duplicate the dialog
        # already merged. First-seen wins on collision.
        formations_by_key: dict[str, GeologicalFormationOrm] = {}
        for f in existing_formations:
            fkey = normalize_formation_key(f.regional_ref if f.regional_ref else f.name)
            formations_by_key.setdefault(fkey, f)
        # #59 existing-project reconciliation: a formation created BEFORE
        # the lexicon shipped is keyed by its raw DOV code (e.g. regional_ref
        # "KoRo" → key "koro"). New layers now resolve "KoRo" to the canonical
        # key. Without this, re-running Fill would create a SECOND formation
        # under the canonical key. Also index every raw-code formation under
        # its lexicon-canonical key so the existing row is FOUND and reused,
        # not duplicated. setdefault → a real canonical-named formation
        # already indexed wins; this only fills otherwise-empty canonical
        # slots. Resolution-time only — no row is renamed or migrated.
        for f in existing_formations:
            if not f.regional_ref:
                continue
            canonical = _resolve_codelist_canonical(normalize_formation_key(f.regional_ref))
            if canonical is not None:
                formations_by_key.setdefault(normalize_formation_key(canonical), f)
        next_display_order = (
            await self._session.execute(
                select(func.coalesce(func.max(GeologicalFormationOrm.display_order), -1)).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        ).scalar_one() + 1

        # When selected_keys is provided, purge orphaned FormationContactOrm
        # rows whose formation_id maps to a formation in the selected set and
        # whose observation_layer_id is NULL.  NULL-source contacts are created
        # only by prior incomplete runs (FK orphans from a crash/rollback); they
        # block re-creation via used_layer_ids / occupied_anchor_formation and
        # would permanently suppress the desired contacts on every subsequent
        # Fill run.  We only purge within the selected-key scope so we never
        # touch user-placed contacts on formations the caller did not request.
        surviving_formation_ids_for_selected: set[UUID] = set()
        if selected_key_set_norm is not None:
            for f in existing_formations:
                stable_key = normalize_formation_key(f.regional_ref if f.regional_ref else f.name)
                if stable_key in selected_key_set_norm:
                    surviving_formation_ids_for_selected.add(f.id)
            if surviving_formation_ids_for_selected:
                orphan_del = delete(FormationContactOrm).where(
                    FormationContactOrm.model_id == model_id,
                    FormationContactOrm.formation_id.in_(surviving_formation_ids_for_selected),
                    FormationContactOrm.observation_layer_id.is_(None),
                )
                orphan_result = await self._session.execute(orphan_del)
                orphan_count = orphan_result.rowcount
                if orphan_count:
                    self.debug(
                        f"Auto-populate: purged {orphan_count} orphaned contact(s) "
                        f"for selected formations (NULL observation_layer_id)"
                    )

        # Pre-load every existing contact in the model so the dedup
        # checks are O(1) per layer. Two indices needed:
        #
        # * ``used_layer_ids``: skip layers we've already auto-populated
        #   from (idempotency on observation_layer_id).
        # * ``occupied_anchor_formation``: skip layers whose
        #   (anchor, formation) tuple already has a contact, regardless
        #   of source. This is the "user overrides are absolute" rule —
        #   if the engineer manually placed a Boom Klei contact on
        #   borehole-X, re-running auto-populate must NOT add a second
        #   one alongside it.
        #
        # These indices are built AFTER the orphan purge above so the
        # orphan rows no longer block re-creation.
        contact_rows = list(
            (
                await self._session.execute(
                    select(
                        FormationContactOrm.id,
                        FormationContactOrm.observation_layer_id,
                        FormationContactOrm.borehole_id,
                        FormationContactOrm.formation_id,
                    ).where(FormationContactOrm.model_id == model_id)
                )
            ).all()
        )
        used_layer_ids: set[UUID] = {row[1] for row in contact_rows if row[1] is not None}
        occupied_anchor_formation: set[tuple[UUID, UUID]] = {
            (row[2], row[3]) for row in contact_rows if row[2] is not None
        }
        # When section_id is provided, build two reverse-lookup dicts so found_contact_ids
        # can be populated for BOTH skip paths (observation_layer_id idempotency AND
        # occupied_anchor_formation).  Built once before the borehole loop.
        # layer_id_to_contact_id: covers the used_layer_ids skip (idempotent auto-populate).
        # anchor_formation_to_contact_id: covers the occupied_anchor_formation skip (user-placed).
        layer_id_to_contact_id: dict[UUID, UUID] = (
            {row[1]: row[0] for row in contact_rows if row[1] is not None}
            if section_id is not None
            else {}
        )
        anchor_formation_to_contact_id: dict[tuple[UUID, UUID], UUID] = (
            {(row[2], row[3]): row[0] for row in contact_rows if row[2] is not None}
            if section_id is not None
            else {}
        )

        created_contact_ids: list[UUID] = []
        # Contacts that already existed in the model for the processed
        # borehole scope — skipped for idempotency.  The Seed router
        # unions these with created_contact_ids to build the section's
        # seeded set so pre-existing contacts are also seeded.  Empty
        # when section_id is None (the Fill path does not touch seeds).
        found_contact_ids: list[UUID] = []
        created_formation_ids: list[UUID] = []
        # O(1) membership check for the post-walk depth-based reorder
        # (parallels created_formation_ids; the list keeps insertion
        # order for the response payload).
        created_formation_ids_set: set[UUID] = set()
        # Per newly-created formation, the list of contact top-depths
        # observed during this run. Used post-walk to assign
        # display_order so deepest-top = lowest order = oldest, per
        # the "Modelling hierarchy" convention in CLAUDE.md.
        new_formation_top_depths: dict[UUID, list[float]] = {}
        # Tracks every formation that received a new contact in this
        # run. Used to scope the post-batch stale-flip to just the
        # affected pairs — only formations that already have a built
        # surface row can go stale; brand-new formations have no row.
        touched_formations: set[UUID] = set()
        skipped_existing = 0
        skipped_unmatched = 0
        skipped_no_stratigraphy = 0
        skipped_not_in_model = 0
        skipped_key_filter = 0
        skipped_collision = 0
        # Per-borehole collision tracking: borehole_id → effective_key → shallowest top_m seen.
        # When a second layer in the SAME borehole resolves to an already-occupied
        # (borehole, effective_key) slot, it is a duplicate top — keep only the
        # shallowest one (per the owner-specified shallowest-wins rule).
        borehole_occupied_keys: dict[UUID, dict[str, float]] = {}
        # Collision accumulator for the outcome; mirrors the structure produced by
        # scan_stratigraphy_candidates so discover≡apply holds.
        write_collisions: list[LumpingCollision] = []
        # Staging dict for collision assembly: per (borehole, effective_key), collect
        # every raw_desc that contributed so the LumpingCollision can report them all.
        collision_raw_names: dict[tuple[UUID, str], list[str]] = {}

        for borehole in boreholes:
            # Resolve both streams. Formal is the authoritative regional
            # source for layer boundaries when present; informal is
            # walked only when no formal observation exists.
            formal_obs = self._find_observation(
                borehole.observations, ObservationType.FORMAL_STRATIGRAPHY
            )
            informal_obs = self._find_observation(
                borehole.observations, ObservationType.INFORMAL_STRATIGRAPHY
            )
            if formal_obs is None and informal_obs is None:
                skipped_no_stratigraphy += 1
                self.debug(f"Borehole {borehole.id}: no stratigraphy observation, skipped")
                continue

            primary_obs = formal_obs if formal_obs is not None else informal_obs
            other_obs = informal_obs if formal_obs is not None else None
            assert primary_obs is not None  # narrowed by the guard above
            primary_is_formal = formal_obs is not None
            other_layers = list(other_obs.layers) if other_obs is not None else []

            # Sort primary layers ascending by top_m before processing so
            # the first-encountered layer in the collision guard is always the
            # SHALLOWEST one.  Without this sort, an ORM result ordering that
            # happens to deliver the deeper layer first would record the wrong
            # depth in bh_keys[effective_key] and violate the discover≡apply
            # invariant on the kept_top_m reported in LumpingCollision.
            sorted_primary_layers = sorted(primary_obs.layers, key=lambda lay: lay.top_m)

            for layer in sorted_primary_layers:
                # Negative depth is invalid (parser bug or corrupt
                # source). top_m == 0 IS allowed — that's the topmost
                # formation's top, which the user explicitly wants.
                if layer.top_m < 0.0:
                    continue
                if layer.id in used_layer_ids:
                    skipped_existing += 1
                    # When the Seed handler needs found ids (section_id provided),
                    # record the contact that sourced from this layer so the router
                    # can union it into the section's seeded set.
                    if section_id is not None:
                        existing_id = layer_id_to_contact_id.get(layer.id)
                        if existing_id is not None:
                            found_contact_ids.append(existing_id)
                    continue
                primary_desc = (layer.description or "").strip()
                if not primary_desc:
                    skipped_unmatched += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: empty description, skipped"
                    )
                    continue

                # Find counterpart layer in the other stream by max
                # interval-overlap. Returns None when no other stream,
                # or when no overlapping layer exists.
                counterpart = self._best_overlap(layer.top_m, layer.base_m, other_layers)
                counterpart_desc = (counterpart.description or "").strip() if counterpart else None

                # Single shared derivation — same function as scan_stratigraphy_candidates
                # so the stable key used here is provably identical to the key returned
                # to the dialog.  This was the root cause of the bug fixed here.
                name, regional_ref, stable_key = _derive_layer_names_and_key(
                    primary_is_formal=primary_is_formal,
                    primary_desc=primary_desc,
                    counterpart_desc=counterpart_desc,
                )

                # Lump-wins-over-bridge resolution (revised 2026-05-18 — see
                # _resolve_lumped_key).  Mirrors scan_stratigraphy_candidates
                # verbatim via the SAME shared helper — same bridge dict, same
                # precedence — so discover≡apply≡seed holds and the original
                # scan/execute key-divergence bug class cannot recur.
                effective_key, effective_name, was_lumped = _resolve_lumped_key(
                    stable_key,
                    primary_is_formal=primary_is_formal,
                    bridge=bridge,
                    manual_map=manual_map,
                )
                display_name = effective_name if was_lumped else name

                # Apply the selected-key filter when the caller provided one.
                # Compare effective_key (post-lump) against the normalised set so
                # the filter sees the same keys the discover preview returned.
                if selected_key_set_norm is not None and effective_key not in selected_key_set_norm:
                    skipped_key_filter += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: "
                        f"key '{effective_key}' not in selected_keys, skipped"
                    )
                    continue

                # Per-borehole collision safeguard (data-integrity critical, owner-specified).
                # After manual lumping, ≥2 layers in the SAME borehole may resolve to the
                # SAME effective_key — e.g. "Quartair: Holoceen veen" and "Quartair: Vlaamse
                # Vallei" both lumped to "Holoceen".  Two tops for one formation corrupt the
                # TIN.  Rule: keep only the SHALLOWEST top (smallest top_m); drop deeper ones.
                # WHY shallowest wins: the shallowest contact is the formation's first
                # appearance; deeper redundant boundaries are interior detail, not a new top.
                bh_keys = borehole_occupied_keys.setdefault(borehole.id, {})
                collision_slot = (borehole.id, effective_key)
                # Always record this raw description for potential collision reporting.
                collision_raw_names.setdefault(collision_slot, []).append(primary_desc)
                if effective_key in bh_keys:
                    # Collision: this (borehole, effective_key) already has a contact.
                    skipped_collision += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: "
                        f"collision on effective_key '{effective_key}' "
                        f"(kept top={bh_keys[effective_key]:.3f}m, "
                        f"dropping top={layer.top_m:.3f}m), skipped"
                    )
                    continue
                bh_keys[effective_key] = layer.top_m

                # Find or create on the effective key. Same canonical identity as the
                # scan + the existing-formation index → dash/space/case/chrono-prefix
                # variants and manually lumped names resolve to ONE formation.
                formation: GeologicalFormationOrm | None = formations_by_key.get(effective_key)
                if formation is None and not create_missing_formations:
                    # Explicit-content invariant (CLAUDE.md, owner directive
                    # 2026-05-17): the Sections "Seed from stratigraphy" path
                    # places contacts ONLY for formations the user already
                    # curated — it never creates one. An in-corridor borehole
                    # layer whose resolved formation isn't in the project is
                    # reported, not minted (the "Seed added Formatie van Ieper"
                    # bug). The Fill-from-boreholes path passes
                    # create_missing_formations=True and is unaffected.
                    skipped_not_in_model += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: "
                        f"key '{effective_key}' has no curated formation; "
                        f"Seed skips (no create)"
                    )
                    continue
                if formation is None:
                    formation = GeologicalFormationOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        name=display_name,
                        regional_ref=regional_ref,
                        color=_palette_colour_for(regional_ref or display_name),
                        display_order=next_display_order,
                    )
                    next_display_order += 1
                    self._session.add(formation)
                    formations_by_key[effective_key] = formation
                    created_formation_ids.append(formation.id)
                    created_formation_ids_set.add(formation.id)

                # USER OVERRIDES ARE ABSOLUTE — if a contact already
                # exists for this (borehole, formation) pair (whether
                # the user placed it manually, dragged an old auto-pick
                # to a different depth, or it survives from a previous
                # auto-populate), do NOT create a second one alongside
                # it. The user's existing pick wins.
                anchor_formation_key = (borehole.id, formation.id)
                if anchor_formation_key in occupied_anchor_formation:
                    skipped_existing += 1
                    self.debug(
                        f"Borehole {borehole.id} formation {formation.id}: "
                        f"existing contact preserved, layer auto-create skipped"
                    )
                    # When the Seed handler needs found ids (section_id provided),
                    # record the existing contact so the router can union it into
                    # the section's seeded set alongside created_contact_ids.
                    if section_id is not None:
                        existing_id = anchor_formation_to_contact_id.get(anchor_formation_key)
                        if existing_id is not None:
                            found_contact_ids.append(existing_id)
                    continue

                contact = FormationContactOrm(
                    id=uuid7(),
                    model_id=model_id,
                    formation_id=formation.id,
                    borehole_id=borehole.id,
                    depth_top_m=layer.top_m,
                    source="borehole_observation",
                    confidence="high",
                    observation_id=primary_obs.id,
                    observation_layer_id=layer.id,
                )
                self._session.add(contact)
                used_layer_ids.add(layer.id)
                occupied_anchor_formation.add(anchor_formation_key)
                touched_formations.add(formation.id)
                created_contact_ids.append(contact.id)
                # Track for the post-walk depth-based reorder of newly-
                # created formations (see below). Existing formations
                # keep whatever display_order the user gave them; only
                # the ones we just created get sorted by depth.
                if formation.id in created_formation_ids_set:
                    new_formation_top_depths.setdefault(formation.id, []).append(layer.top_m)

        # Newly-created formations were assigned display_order in
        # encounter order (top-down through each borehole = youngest-
        # first). Per CLAUDE.md "Modelling hierarchy", lower
        # display_order = OLDER formation, so we'd be inverting the
        # geological superposition convention.
        #
        # Reorder strategy is all-or-nothing per batch:
        #
        # * If EVERY newly-created formation resolves in the G3Dv3
        #   catalog (by name or regional_ref, alias-aware), assign
        #   display_order from the authoritative age_rank. This is
        #   location-independent — comparing two Belgian formations
        #   answers the "older or younger?" question the same way on
        #   either side of Flanders.
        # * Otherwise (any unknowns in the batch), fall back to the
        #   depth-derived heuristic so all new formations share a
        #   single consistent ordering space. Mixing G3Dv3 ages with
        #   depth-derived ranks gives inconsistent results when the
        #   two disagree, so we don't try.
        #
        # Existing project formations stay where they were either way.
        if new_formation_top_depths:
            base_order = next_display_order - len(new_formation_top_depths)
            catalog = get_catalog()
            formation_by_id: dict[UUID, GeologicalFormationOrm] = {
                f.id: f
                for f in self._session.new
                if isinstance(f, GeologicalFormationOrm) and f.id in new_formation_top_depths
            }
            g3d_age_ranks: dict[UUID, int] = {}
            for fid, formation in formation_by_id.items():
                unit = catalog.lookup_by_name(formation.name)
                if unit is None and formation.regional_ref:
                    unit = catalog.lookup_by_name(formation.regional_ref)
                if unit is not None:
                    g3d_age_ranks[fid] = unit.age_rank

            if g3d_age_ranks and len(g3d_age_ranks) == len(new_formation_top_depths):
                # Higher age_rank = older = lower display_order, so sort
                # by age_rank DESCENDING (oldest first).
                sorted_new_fids = sorted(
                    g3d_age_ranks, key=lambda fid: g3d_age_ranks[fid], reverse=True
                )
                ordering_source = "G3Dv3 age"
            else:
                mean_depth = {
                    fid: sum(depths) / len(depths)
                    for fid, depths in new_formation_top_depths.items()
                }
                sorted_new_fids = sorted(mean_depth, key=lambda fid: mean_depth[fid], reverse=True)
                ordering_source = (
                    f"mean depth (G3Dv3 covered "
                    f"{len(g3d_age_ranks)}/{len(new_formation_top_depths)})"
                )

            # Anthropogenic pin (owner ruling 2026-09-05): man-made fill
            # (Antropogeen / DOV code "A") is younger than every natural
            # formation, so it must land at the youngest end whatever the
            # ordering source decided. sorted_new_fids is OLDEST-first, so
            # move every anthropogenic formation to the END (highest
            # display_order = youngest). WHY this is needed: the G3Dv3
            # branch runs only when EVERY new formation resolves in the
            # catalog; a single sibling with no catalog entry (e.g.
            # Pleistoceen/Quartair, absent by name) drops the whole batch
            # to the mean-depth heuristic, discarding Antropogeen's known
            # age_rank 0 — which is how Antropogeen landed below Pleistoceen
            # after "Fill from boreholes".
            anthropogenic_new = [
                fid
                for fid in sorted_new_fids
                if (formation_row := formation_by_id.get(fid)) is not None
                and is_anthropogenic(formation_row.regional_ref, formation_row.name)
            ]
            if anthropogenic_new:
                anthro_new_set = set(anthropogenic_new)
                sorted_new_fids = [
                    fid for fid in sorted_new_fids if fid not in anthro_new_set
                ] + anthropogenic_new
                ordering_source = f"{ordering_source} + Antropogeen pinned youngest"

            new_orders = {fid: base_order + i for i, fid in enumerate(sorted_new_fids)}
            # Apply via setattr on the in-session ORM rows (they're
            # still in the unit-of-work). One UPDATE per row at flush
            # time; for v1 cardinality (≤ ~30 new formations per run)
            # this is trivial.
            for f in self._session.new:
                if isinstance(f, GeologicalFormationOrm) and f.id in new_orders:
                    f.display_order = new_orders[f.id]
            self.debug(
                f"Auto-populate: re-sorted {len(sorted_new_fids)} new formation(s) "
                f"by {ordering_source} (oldest first)"
            )

        # §10 on-click build contract: auto-populate (Seed / Fill) must NOT
        # trigger Delaunay. Only POST .../surfaces/rebuild clears is_stale.
        # For touched formations that already have a built surface row, flip
        # is_stale=True so the section view renders them dashed + faded —
        # prompting the engineer to click "Build model".  Brand-new formations
        # have no surface row yet (nothing to mark stale); they render via the
        # connect-the-dots fallback until the first Build fires.
        await self._session.flush()
        stale_count = await self._repo.mark_surfaces_stale(
            (model_id, fid) for fid in touched_formations
        )
        # Mirror to the 3-D solid cache — geological model ids never match
        # litho_body_solid.model_id rows, so the call is a safe unconditional
        # no-op for geological models and fires correctly for lithostratigraphic
        # ones (the FC→LL trigger re-derives layer geometry from new contacts).
        await LithoLayerRepository(self._session).mark_litho_solids_stale(model_id)

        # In OVERWRITE mode, delete every project formation whose stable key
        # is NOT in the selected set.  This runs server-side so
        # the client never has to recompute canonical keys from raw names —
        # the divergent-client-key freeze bug (da98053) was exactly that mismatch.
        # DB CASCADE handles formation_contact and formation_surface
        # rows that reference the deleted formations.
        #
        # MODEL-SCOPED DELETE — critical correctness constraint (B1):
        # GeologicalFormation has NO model FK (formations are a project-wide
        # vocabulary shared across the geological/litho/geotechnical sibling
        # models — see CLAUDE.md "Modelling hierarchy").  Scoping to
        # app_project_id == project_id alone would include formations that
        # belong exclusively to OTHER models in the same project, causing
        # silent cross-model data loss via CASCADE on formation_contact and
        # formation_surface.  The delete candidate set is therefore restricted
        # to formations that have at least one contact row in THIS model —
        # i.e. ``formation_id in model_formation_ids``.  Formations that only
        # appear in sibling models are invisible to this delete and are never
        # touched.  Newly-created formations are always in selected_key_set_norm
        # by construction (the write loop only creates within the selected set)
        # and are excluded by the fkey check; the explicit created_set guard is
        # a belt-and-suspenders safety net.
        #
        # MODE GATE (2026-08-03): in ``add`` mode this whole pass is skipped.
        # Not "computed then discarded" — skipped, so there is no code path on
        # which an add-mode run can issue a DELETE. That is the invariant the
        # data-loss incident demands; a filter that merely returns an empty
        # list would be one bad condition away from deleting again.
        deleted_formation_ids: list[UUID] = []
        deleted_formation_names: list[str] = []
        if selected_key_set_norm is not None and resolved_mode is AutoPopulateMode.OVERWRITE:
            # Derive the set of formation IDs that belong to THIS model from the
            # contact_rows already loaded above (index 2 = formation_id).  This
            # reuses the existing round-trip instead of issuing a second query.
            # Newly-created formations are added here too: they have contacts in
            # this model by construction (created in the write loop above), and
            # must be in scope so the created_set guard below is consistent.
            model_formation_ids: frozenset[UUID] = frozenset(
                row[3] for row in contact_rows if row[3] is not None
            ) | frozenset(created_formation_ids)
            to_delete: list[GeologicalFormationOrm] = []
            for f in existing_formations:
                fkey = normalize_formation_key(f.regional_ref if f.regional_ref else f.name)
                if fkey not in selected_key_set_norm and f.id in model_formation_ids:
                    to_delete.append(f)
            # Also exclude newly-created formations (they ARE in selected_key_set_norm
            # by construction — the write loop only creates within the selected set —
            # but guard explicitly to avoid deleting a formation we just added in this
            # same session, which would turn the transaction into a no-op.
            created_set: frozenset[UUID] = frozenset(created_formation_ids)
            to_delete = [f for f in to_delete if f.id not in created_set]
            if to_delete:
                delete_ids = [f.id for f in to_delete]
                await self._session.execute(
                    delete(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(delete_ids))
                )
                deleted_formation_ids = delete_ids
                # Names, not ids — this is the line an engineer reads in the
                # log after "where did my units go?", and a UUID answers
                # nothing. Captured BEFORE the flush so the expired ORM rows
                # cannot make the attribute unreadable.
                deleted_formation_names = [f.name for f in to_delete]
                self.info(
                    f"Auto-populate (overwrite): deleted {len(delete_ids)} "
                    f"unselected formation(s): "
                    + ", ".join(deleted_formation_names[:5])
                    + ("..." if len(delete_ids) > 5 else "")
                )
        elif selected_key_set_norm is not None:
            # Add mode with a selection — say out loud that the destructive
            # half was declined, so a future "it deleted nothing" report can
            # be answered from the log instead of a repro.
            self.info(
                "Auto-populate (add): deletion pass skipped — "
                "unselected formations are left untouched"
            )

        # Build collision warnings from the per-borehole tracking accumulated
        # in the write loop.  Any (borehole, effective_key) slot with > 1
        # raw description contributed means a collision occurred.  The first
        # entry in collision_raw_names is always the KEPT layer (the loop
        # adds descriptions in walk order; the kept layer's description is
        # the first one recorded for each slot because the collision guard
        # skips subsequent entries without creating a contact).
        for (bh_id, eff_key), raw_names in collision_raw_names.items():
            if len(raw_names) < 2:
                continue
            kept_top_m = borehole_occupied_keys.get(bh_id, {}).get(eff_key, 0.0)
            target_name = (
                formations_by_key[eff_key].name if eff_key in formations_by_key else eff_key
            )
            write_collisions.append(
                LumpingCollision(
                    borehole_id=bh_id,
                    target_formation_key=eff_key,
                    target_formation_name=target_name,
                    # tuple: LumpingCollision.colliding_raw_names is tuple[str, ...]
                    # so the frozen dataclass is truly shallow-frozen.
                    colliding_raw_names=tuple(raw_names),
                    kept_top_m=kept_top_m,
                    dropped_count=len(raw_names) - 1,
                )
            )

        await self._session.commit()
        self.success(
            f"Auto-populate done: model={model_id} mode={resolved_mode.value} "
            f"+{len(created_contact_ids)} contacts, "
            f"+{len(created_formation_ids)} formations, "
            f"-{len(deleted_formation_ids)} unselected formations, "
            f"marked {stale_count} surface(s) stale, "
            f"skipped {skipped_existing} existing / "
            f"{skipped_unmatched} unmatched / "
            f"{skipped_no_stratigraphy} no-stratigraphy / "
            f"{skipped_not_in_model} not-in-model / "
            f"{skipped_key_filter} key-filtered / "
            f"{skipped_collision} collision-dropped, "
            f"{len(write_collisions)} collision warning(s)"
        )
        return AutoPopulateOutcome(
            created_contact_ids=created_contact_ids,
            created_formation_ids=created_formation_ids,
            deleted_formation_ids=deleted_formation_ids,
            skipped_existing=skipped_existing,
            skipped_unmatched=skipped_unmatched,
            skipped_no_stratigraphy=skipped_no_stratigraphy,
            skipped_not_in_model=skipped_not_in_model,
            collisions=write_collisions,
            found_contact_ids=found_contact_ids,
            deleted_formation_names=deleted_formation_names,
            mode=resolved_mode.value,
        )

    # Delegate to module-level helpers shared with scan_stratigraphy_candidates.
    _find_observation = staticmethod(_find_observation)
    _best_overlap = staticmethod(_best_overlap)
