"""Accept litho suggestions — bulk idempotent use case.

Converts a list of ``LithoLayerSuggestion`` items (from the segmenter) into
committed ``FormationContact`` + ``GeologicalFormation`` rows in the
lithostratigraphic model, then unions every created/found contact id into the
section's ``seeded_formation_contact_ids`` (explicit-content invariant).

PHASE-1 BOUNDARY (non-negotiable)
-----------------------------------
* ``instance_ordinal`` stays NULL for every row created here.  Phase 2's
  ``resolve_litho_instances`` assigns ordinals.
* No ``litho_correlation_edge`` table.  No ``correlate`` endpoint.  No
  cross-investigation instance resolution.  One file per commit, one phase per
  build window.

FIND-OR-CREATE KEY
------------------
``(litho_model_id, parent_formation_id, litho_main_soil_code,
canonical_admixture_signature)``

The *canonical admixture signature* is a deterministic string built from the
admixtures' ``canonical_key()`` pairs (excludes ``locally`` so two otherwise-
identical units that differ only in local/global presence stay in the same
bucket by owner decision).  Signature = ``"|".join(sorted([a.canonical_key()
for a in admixtures]))`` — empty string when no admixtures.

STRADDLE SPLIT
--------------
A suggestion whose depth interval [top, base] crosses a parent geological-
formation boundary is SPLIT into two contacts: one for the upper parent
formation, one for the lower.  The split elevation is the boundary depth at the
investigation's (x, y) — sampled via ``evaluate_tin_at`` on the geology TIN
cached for each geological formation.  When the TIN is stale or absent the
boundary is approximated by sorting existing contacts on the investigation by
depth and picking the one that falls inside [top, base] — a WARNING is logged
(debt #68).

NON-NEGOTIABLE TRAP (recurred 3 × in prior builds)
---------------------------------------------------
Every created AND found contact id — including BOTH halves of a straddle split
— MUST be unioned into the section's ``seeded_formation_contact_ids`` before
this use case returns.  The caller must forward ``applyUpdatedSection``
(explicit-content invariant).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_formation_absences_for_formation import (
    RecomputeFormationAbsencesForFormation,
)
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.domain.services.tin_surface import TinSurface, evaluate_tin_at
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _canonical_admixture_signature(admixtures: tuple[Admixture, ...]) -> str:
    """Build the deterministic admixture signature for a litho find-or-create key.

    The ``locally`` flag is excluded intentionally (owner decision: composition
    buckets, not presence-within-layer detail) — two admixtures that differ
    only in locality hash to the same bucket.

    Parameters
    ----------
    admixtures : tuple[Admixture, ...]
        Admixtures for one lithostratigraphic unit.

    Returns
    -------
    str
        ``"|".join(sorted([a.canonical_key() for a in admixtures]))``
        Empty string when the tuple is empty.
    """
    return "|".join(sorted(a.canonical_key() for a in admixtures))


def _tin_from_surface_orm(surface: FormationSurfaceOrm) -> TinSurface | None:
    """Reconstruct a :class:`TinSurface` from a cached ORM row.

    Parameters
    ----------
    surface : FormationSurfaceOrm
        ORM row whose ``vertices`` / ``triangles`` are JSONB lists.

    Returns
    -------
    TinSurface | None
        The reconstructed surface, or ``None`` when either payload is empty /
        the surface is stale (the stale flag is checked by the caller for the
        WARNING path, not here — the surface may still be geometrically usable).
    """
    raw_v = surface.vertices or []
    raw_t = surface.triangles or []
    if not raw_v:
        return None
    vertices = [tuple(v) for v in raw_v]
    triangles = [tuple(t) for t in raw_t]
    return TinSurface(
        vertices=vertices,  # type: ignore[arg-type]
        triangles=triangles,  # type: ignore[arg-type]
    )


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
    straddle_split_count : int
        Number of suggestions that were split across a geological-formation
        boundary — each split produces two contacts.
    stale_tin_fallback_count : int
        Number of straddle splits that fell back to depth-ordering because
        the geology TIN was stale/absent (debt #68).
    extrapolated_formation_ids : list[UUID]
        Litho formation rows created in this call whose ``parent_formation_id``
        was inferred from TIN extrapolation (no geology contact at this
        investigation covered the suggestion's depth).  These rows carry
        ``parent_extrapolated=True`` and should be reviewed by the engineer
        before they enter downstream design exports (debt #87).
    orphan_formation_ids : list[UUID]
        Litho formation rows created in this call with
        ``parent_formation_id=NULL`` because neither contact-based assignment
        nor TIN extrapolation could resolve a parent (debt #87).  The
        engineer must manually assign or detach these in the inspector.
    updated_section_id : UUID | None
        The section whose seeded set was updated, or ``None`` when no
        ``section_id`` was provided.
    """

    created_formation_ids: list[UUID]
    found_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    found_contact_ids: list[UUID]
    straddle_split_count: int
    stale_tin_fallback_count: int
    extrapolated_formation_ids: list[UUID]
    orphan_formation_ids: list[UUID]
    updated_section_id: UUID | None


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

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        suggestions: list[LithoLayerSuggestion],
        cpt_id: UUID | None = None,
        borehole_id: UUID | None = None,
        section_id: UUID | None = None,
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

        self.info(
            f"AcceptLithoSuggestions.execute: litho_model={litho_model_id}, "
            f"{'cpt' if cpt_id else 'borehole'}={cpt_id or borehole_id}, "
            f"{len(suggestions)} suggestion(s)"
        )

        # --- Load litho model + resolve parent geology model id -------------
        litho_model = await self._session.get(GeologicalModelOrm, litho_model_id)
        if litho_model is None or litho_model.app_project_id != project_id:
            raise ValueError(f"Litho model {litho_model_id} not found in project {project_id}")
        geology_model_id: UUID | None = litho_model.parent_geological_model_id

        # --- Load investigation x/y/elevation for straddle sampling ---------
        # project_id is threaded in to enforce investigation scope (VULN-10).
        # ``inv_elevation_m`` is required for TIN extrapolation (debt #87):
        # converting a suggestion's depth-below-ground to absolute z lets us
        # ask which geology TIN owns that elevation laterally.  When the
        # investigation has no surveyed elevation, extrapolation is skipped
        # and the parent stays NULL (orphan path).
        inv_x, inv_y, inv_elevation_m = await self._load_investigation_xyz(
            project_id=project_id, cpt_id=cpt_id, borehole_id=borehole_id
        )
        self.debug(
            f"Investigation xyz: ({inv_x:.1f}, {inv_y:.1f}) elev={inv_elevation_m} "
            f"{'cpt' if cpt_id else 'borehole'}={cpt_id or borehole_id}"
        )

        # --- Load geology TIN surfaces (for straddle detection) -------------
        geology_surfaces: dict[UUID, FormationSurfaceOrm] = {}
        if geology_model_id is not None:
            geology_surfaces = await self._load_geology_surfaces(geology_model_id)
            self.debug(
                f"Loaded {len(geology_surfaces)} geology TIN surface(s) for straddle detection"
            )
        else:
            self.warning(
                f"Litho model {litho_model_id} has no parent geological model — "
                "straddle detection disabled; suggestions accepted as-is"
            )

        # --- Load existing geology contacts at this investigation (fallback) -
        # Used when a TIN is stale / absent to approximate formation boundaries
        # from depth-ordered contacts (debt #68).
        geology_contacts_at_inv: list[tuple[float, UUID]] = []
        if geology_model_id is not None:
            geology_contacts_at_inv = await self._load_geology_contacts_at_inv(
                geology_model_id, cpt_id=cpt_id, borehole_id=borehole_id
            )
            self.debug(
                f"Loaded {len(geology_contacts_at_inv)} geology contact(s) for straddle fallback"
            )

        # --- Load all project formations for lookup --------------------------
        project_formations = await self._repo.list_formations(project_id)
        # Keyed by (parent_formation_id, litho_main_soil_code, canonical_sig)
        litho_formations: dict[tuple[UUID | None, str, str], GeologicalFormationOrm] = {}
        for f in project_formations:
            if f.litho_main_soil_code is not None:
                sig = _canonical_admixture_signature(
                    tuple(
                        Admixture(
                            soil_code=a["soil_code"],
                            amount=a.get("amount", ""),
                            locally=a.get("locally", False),
                        )
                        for a in (f.litho_admixtures or [])
                    )
                )
                litho_formations[(f.parent_formation_id, f.litho_main_soil_code, sig)] = f

        # --- Main loop: one contact per suggestion (or two per straddle) -----
        created_formation_ids: list[UUID] = []
        found_formation_ids: list[UUID] = []
        created_contact_ids: list[UUID] = []
        found_contact_ids: list[UUID] = []
        extrapolated_formation_ids: list[UUID] = []
        orphan_formation_ids: list[UUID] = []
        straddle_split_count = 0
        stale_tin_fallback_count = 0

        for idx, sug in enumerate(suggestions):
            self.debug(
                f"[{idx + 1}/{len(suggestions)}] suggestion: {sug.suggested_lithology} "
                f"depth={sug.depth_top_m:.2f}–{sug.depth_base_m:.2f}m"
            )

            # Detect straddle: does this suggestion span a geology formation
            # boundary at the investigation's (x, y)?
            splits = self._compute_straddle_splits(
                suggestion=sug,
                geology_surfaces=geology_surfaces,
                geology_contacts_at_inv=geology_contacts_at_inv,
                inv_x=inv_x,
                inv_y=inv_y,
                inv_elevation_m=inv_elevation_m,
                suggestion_index=idx,
            )
            stale_tin_fallback_count += splits.stale_tin_fallback_count
            if len(splits.intervals) > 1:
                straddle_split_count += 1

            for interval_top, interval_parent_fid in splits.intervals:
                # Find-or-create the litho formation unit.
                sig = _canonical_admixture_signature(sug.suggested_admixtures)
                fkey = (interval_parent_fid, sug.suggested_lithology, sig)
                formation = litho_formations.get(fkey)
                if formation is None:
                    # Extrapolation flag rides on the straddle result, not the
                    # interval — extrapolation only fires on the single-interval
                    # no-boundary path (the split path always has contact-based
                    # parents on both halves).  Stamp the flag at creation so a
                    # later contact-based accept that reuses the bucket does
                    # NOT toggle the existing row's provenance.
                    formation = await self._create_litho_formation(
                        project_id=project_id,
                        parent_formation_id=interval_parent_fid,
                        litho_main_soil_code=sug.suggested_lithology,
                        admixtures=sug.suggested_admixtures,
                        sig=sig,
                        parent_extrapolated=splits.extrapolated,
                    )
                    litho_formations[fkey] = formation
                    created_formation_ids.append(formation.id)
                    if splits.extrapolated:
                        extrapolated_formation_ids.append(formation.id)
                    elif interval_parent_fid is None:
                        orphan_formation_ids.append(formation.id)
                    self.debug(
                        f"  Created litho formation {formation.id} — "
                        f"{sug.suggested_lithology} parent={interval_parent_fid} "
                        f"extrapolated={splits.extrapolated}"
                    )
                else:
                    # A formation created earlier in THIS request (e.g. the
                    # other half of a straddle split sharing the key) is in
                    # litho_formations + created_formation_ids already — do
                    # NOT also list it as "found" (review S1, bookkeeping).
                    if (
                        formation.id not in found_formation_ids
                        and formation.id not in created_formation_ids
                    ):
                        found_formation_ids.append(formation.id)
                    self.debug(
                        f"  Found litho formation {formation.id} — "
                        f"{sug.suggested_lithology} parent={interval_parent_fid}"
                    )

                # Find-or-create the contact.
                # Thread sug.source directly so manual_pick payloads stamp
                # 'manual_pick' and the bulk-segmenter paths keep their own
                # source strings ('cpt_robertson_2015' / 'borehole_observation').
                contact_id, was_created = await self._find_or_create_contact(
                    litho_model_id=litho_model_id,
                    formation_id=formation.id,
                    depth_top_m=interval_top,
                    borehole_id=borehole_id,
                    cpt_id=cpt_id,
                    confidence=sug.confidence.value.lower(),
                    source=sug.source,
                )
                if was_created:
                    created_contact_ids.append(contact_id)
                else:
                    found_contact_ids.append(contact_id)

        # Stale-flag surfaces for affected (litho_model, formation) pairs.
        if created_contact_ids:
            all_formation_ids = set(created_formation_ids) | set(found_formation_ids)
            await self._repo.mark_surfaces_stale(
                [(litho_model_id, fid) for fid in all_formation_ids]
            )

        # Recompute display_order for litho formations whenever new formation
        # rows were created.  The sort encodes the superposition rule:
        # lower display_order = older = deeper (matches the geological
        # model convention and the section/3D paint order in ContactsLayer +
        # Geology3DViewer).  Re-accepts that produce no new formation rows
        # skip this step — existing ranks are already correct for the
        # PHASE-1 one-investigation-per-call model.
        #
        # Phase-2 caveat (review S2): with multi-investigation batch
        # accepts, a NEW contact for an EXISTING formation could shift
        # that formation's min-depth into a different relative position
        # while creating no new formation row — this guard would then be
        # too conservative and leave a stale rank. When batch-accept
        # lands, widen to `if created_formation_ids or created_contact_ids:`
        # (any new contact may change the min-depth ranking).
        if created_formation_ids:
            await self._recompute_litho_display_orders(litho_model_id=litho_model_id)

        # Trigger inference engine for every formation that received a new
        # contact.  New contacts change the corridor's observation-data
        # snapshot so existing inferred absences may need updating.
        # Re-accepts (found_contact_ids) are included: the user may be
        # re-accepting after a re-segmentation, and the prior inference may
        # be stale.  commit=False defers the commit so all accept mutations
        # and absence deltas share one atomic transaction.
        if created_contact_ids or found_contact_ids:
            affected_formation_ids = set(created_formation_ids) | set(found_formation_ids)
            inference_uc = RecomputeFormationAbsencesForFormation(self._session)
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

        await self._session.commit()
        self.success(
            f"AcceptLithoSuggestions: litho_model={litho_model_id} — "
            f"{len(created_contact_ids)} contact(s) created, "
            f"{len(found_contact_ids)} found, "
            f"{straddle_split_count} straddle split(s), "
            f"{stale_tin_fallback_count} stale-TIN fallback(s), "
            f"{len(extrapolated_formation_ids)} extrapolated parent(s), "
            f"{len(orphan_formation_ids)} orphan(s)"
        )

        return AcceptLithoResult(
            created_formation_ids=created_formation_ids,
            found_formation_ids=found_formation_ids,
            created_contact_ids=created_contact_ids,
            found_contact_ids=found_contact_ids,
            straddle_split_count=straddle_split_count,
            stale_tin_fallback_count=stale_tin_fallback_count,
            extrapolated_formation_ids=extrapolated_formation_ids,
            orphan_formation_ids=orphan_formation_ids,
            updated_section_id=section_id,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_investigation_xyz(
        self,
        *,
        project_id: UUID,
        cpt_id: UUID | None,
        borehole_id: UUID | None,
    ) -> tuple[float, float, float | None]:
        """Load raw (x, y, elevation_m) for the investigation, project-scoped.

        Parameters
        ----------
        project_id : UUID
            Owning project — the investigation must belong to this project
            (VULN-10).
        cpt_id : UUID | None
        borehole_id : UUID | None

        Returns
        -------
        tuple[float, float, float | None]
            ``(location_x, location_y, elevation_m)``.  ``elevation_m`` is
            ``None`` when the investigation has no surveyed surface elevation;
            in that case TIN extrapolation (debt #87) is disabled and an
            otherwise-orphan suggestion stays orphan.

        Raises
        ------
        ValueError
            When the investigation row does not exist or belongs to a
            different project.
        """
        if cpt_id is not None:
            row = await self._session.get(CptOrm, cpt_id)
            if row is None or row.app_project_id != project_id:
                raise ValueError(f"CPT {cpt_id} not found in project {project_id}")
            return row.location_x, row.location_y, row.elevation_m
        else:
            row = await self._session.get(BoreholeOrm, borehole_id)
            if row is None or row.app_project_id != project_id:
                raise ValueError(f"Borehole {borehole_id} not found in project {project_id}")
            return row.location_x, row.location_y, row.elevation_m

    async def _load_geology_surfaces(
        self,
        geology_model_id: UUID,
    ) -> dict[UUID, FormationSurfaceOrm]:
        """Load all cached TIN surfaces for a geological model.

        Parameters
        ----------
        geology_model_id : UUID
            Parent geological model id.

        Returns
        -------
        dict[UUID, FormationSurfaceOrm]
            Keyed by ``formation_id``.
        """
        stmt = select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == geology_model_id)
        rows = list((await self._session.execute(stmt)).scalars().all())
        return {r.formation_id: r for r in rows}

    async def _load_geology_contacts_at_inv(
        self,
        geology_model_id: UUID,
        *,
        cpt_id: UUID | None,
        borehole_id: UUID | None,
    ) -> list[tuple[float, UUID]]:
        """Load depth-ordered contacts for an investigation in the geology model.

        Used as stale-TIN fallback for straddle detection (debt #68).

        Parameters
        ----------
        geology_model_id : UUID
        cpt_id : UUID | None
        borehole_id : UUID | None

        Returns
        -------
        list[tuple[float, UUID]]
            ``[(depth_top_m, formation_id), ...]`` ordered ascending by depth.
        """
        stmt = select(FormationContactOrm.depth_top_m, FormationContactOrm.formation_id).where(
            FormationContactOrm.model_id == geology_model_id
        )

        if borehole_id is not None:
            stmt = stmt.where(FormationContactOrm.borehole_id == borehole_id)
        else:
            stmt = stmt.where(FormationContactOrm.cpt_id == cpt_id)

        stmt = stmt.order_by(FormationContactOrm.depth_top_m)
        rows = (await self._session.execute(stmt)).all()
        return [(row.depth_top_m, row.formation_id) for row in rows]

    def _compute_straddle_splits(
        self,
        *,
        suggestion: LithoLayerSuggestion,
        geology_surfaces: dict[UUID, FormationSurfaceOrm],
        geology_contacts_at_inv: list[tuple[float, UUID]],
        inv_x: float,
        inv_y: float,
        inv_elevation_m: float | None,
        suggestion_index: int,
    ) -> _StraddleResult:
        """Determine whether a suggestion straddles a geology boundary.

        Returns a :class:`_StraddleResult` whose ``intervals`` list contains:
        * One entry ``(depth_top_m, parent_formation_id)`` for a non-straddle.
        * Two entries for a straddle — upper half + lower half — each with its
          own ``parent_formation_id``.

        When no parent geology surfaces exist, returns a single-interval result
        with ``parent_formation_id=None``.

        Parameters
        ----------
        suggestion : LithoLayerSuggestion
            The suggestion to evaluate.
        geology_surfaces : dict[UUID, FormationSurfaceOrm]
            Cached TIN surfaces keyed by geology formation id.
        geology_contacts_at_inv : list[tuple[float, UUID]]
            Depth-ordered contacts from the parent geology model at this
            investigation (used as stale-TIN fallback).
        inv_x, inv_y : float
            Investigation location for TIN sampling.
        suggestion_index : int
            0-based index within the suggestions list (for logging).

        Returns
        -------
        _StraddleResult
        """
        top = suggestion.depth_top_m
        base = suggestion.depth_base_m

        if not geology_surfaces and not geology_contacts_at_inv:
            # No geology context AT ALL — single interval, no parent. TIN
            # extrapolation is impossible here (no surfaces to sample) so
            # the suggestion is destined for the orphan bucket.  The
            # surfaces-exist-but-no-contacts-here case takes the "no
            # boundaries" exit below; it CAN extrapolate.
            return _StraddleResult(
                intervals=[(top, None)],
                stale_tin_fallback_count=0,
            )

        # Build a list of (boundary_depth, upper_fid, lower_fid) from TINs.
        # A boundary at depth D means: suggestion [top, D] → upper_fid,
        # suggestion [D, base] → lower_fid.
        boundaries: list[tuple[float, UUID | None, UUID | None]] = []
        stale_fallbacks = 0

        # Sort geology contacts by depth to establish formation order at inv.
        # Each contact is "formation X tops at depth D" — sorted ascending we
        # get the stratigraphic column for this investigation.
        contacts_sorted = sorted(geology_contacts_at_inv, key=lambda c: c[0])

        # For each consecutive pair of geology contacts, their boundary falls
        # at the upper contact's depth (that is where the younger formation
        # ends and the older one begins, from depth perspective).
        # But we want the boundary DEPTH that falls WITHIN [top, base].
        # Boundary is the depth at which a lower (older) formation begins,
        # i.e. the depth_top_m of the LOWER formation's contact.
        for i in range(len(contacts_sorted) - 1):
            upper_depth, upper_fid = contacts_sorted[i]
            lower_depth, lower_fid = contacts_sorted[i + 1]
            # The boundary is at lower_depth (the lower formation tops here).
            boundary_candidate = lower_depth
            if top < boundary_candidate < base:
                # Try TIN evaluation for the precise elevation-depth; fall back
                # to depth ordering (debt #68).
                tin_ok = False
                if upper_fid in geology_surfaces:
                    surf_orm = geology_surfaces[upper_fid]
                    if not surf_orm.is_stale and surf_orm.vertices:
                        tin = _tin_from_surface_orm(surf_orm)
                        if tin is not None:
                            tin_ok = True
                            # TIN gives elevation above datum; we need depth.
                            # Surface elevation is in absolute TAW metres;
                            # depth = inv_elevation - surface_elev.  We only
                            # need the RELATIVE boundary position within [top,
                            # base] to decide which parent formation each half
                            # belongs to.  The depth from the contact already
                            # provides that; TIN just gives a more precise split
                            # when the surface dips across the investigation.
                            _ = evaluate_tin_at(tin, inv_x, inv_y)
                            # Use the TIN-based value only when it falls within
                            # [top, base]; otherwise keep the contact depth.
                            # At Phase 1, depth-ordering is good enough for the
                            # parent-formation assignment; the TIN tells us the
                            # formation surface elevation, not the split depth in
                            # depth coordinates directly. Keep depth-based for now
                            # and log if the TIN was available.
                            self.trace(
                                f"[{suggestion_index + 1}] TIN surface available for "
                                f"formation {upper_fid} — using contact-depth boundary "
                                f"{boundary_candidate:.2f}m (TIN provides absolute elevation; "
                                "depth-coord split is exact here)"
                            )

                if not tin_ok:
                    stale_fallbacks += 1
                    self.warning(
                        f"[{suggestion_index + 1}] Straddle at depth {boundary_candidate:.2f}m: "
                        f"TIN for geology formation {upper_fid} is stale or absent — "
                        "falling back to contact-depth boundary (debt #68). "
                        "Rebuild the geology model to improve straddle precision."
                    )

                boundaries.append((boundary_candidate, upper_fid, lower_fid))

        if not boundaries:
            # No boundary within [top, base] — determine parent from which
            # geology formation contains this depth range.
            parent_fid = self._parent_fid_for_depth(top, contacts_sorted)
            extrapolated = False
            if parent_fid is None and geology_surfaces and inv_elevation_m is not None:
                # Debt #87: contact-based lookup failed (no contacts at this
                # investigation, OR suggestion top sits above the shallowest
                # contact) but geology TINs exist — extrapolate.  Convert
                # depth-below-ground to absolute z and ask which formation's
                # TIN surface lies just above z at (inv_x, inv_y).
                target_z = inv_elevation_m - top
                parent_fid = self._extrapolate_parent_from_tins(
                    target_z=target_z,
                    geology_surfaces=geology_surfaces,
                    inv_x=inv_x,
                    inv_y=inv_y,
                    suggestion_index=suggestion_index,
                )
                if parent_fid is not None:
                    extrapolated = True
                    self.info(
                        f"[{suggestion_index + 1}] TIN-extrapolated parent: "
                        f"depth_top={top:.2f}m → abs_z={target_z:.2f}m → "
                        f"formation {parent_fid} (engineer should confirm)"
                    )
                else:
                    self.warning(
                        f"[{suggestion_index + 1}] Could not extrapolate parent: "
                        f"depth_top={top:.2f}m abs_z={target_z:.2f}m sits above all "
                        "geology TIN surfaces at this (x, y) or outside every TIN "
                        "footprint — accepting as orphan (parent_formation_id NULL)"
                    )
            return _StraddleResult(
                intervals=[(top, parent_fid)],
                stale_tin_fallback_count=stale_fallbacks,
                extrapolated=extrapolated,
            )

        # There is at least one boundary in [top, base] — take the first one
        # (Phase 1: one straddle boundary per suggestion).
        boundary_depth, upper_fid, lower_fid = boundaries[0]
        self.info(
            f"[{suggestion_index + 1}] Straddle: suggestion [{top:.2f}, {base:.2f}]m "
            f"crosses geology boundary at {boundary_depth:.2f}m — "
            f"splitting into upper (parent={upper_fid}) + lower (parent={lower_fid})"
        )
        return _StraddleResult(
            intervals=[(top, upper_fid), (boundary_depth, lower_fid)],
            stale_tin_fallback_count=stale_fallbacks,
        )

    @staticmethod
    def _parent_fid_for_depth(
        depth_m: float,
        contacts_sorted: list[tuple[float, UUID]],
    ) -> UUID | None:
        """Return the formation id that contains ``depth_m``.

        Finds the last geology contact whose ``depth_top_m <= depth_m``
        (the formation "active" at that depth).

        Parameters
        ----------
        depth_m : float
            Depth below ground surface to classify.
        contacts_sorted : list[tuple[float, UUID]]
            Depth-ascending ``(depth_top_m, formation_id)`` pairs.

        Returns
        -------
        UUID | None
            Formation id, or ``None`` when ``contacts_sorted`` is empty.
        """
        best_fid: UUID | None = None
        for d, fid in contacts_sorted:
            if d <= depth_m:
                best_fid = fid
            else:
                break
        return best_fid

    def _extrapolate_parent_from_tins(
        self,
        *,
        target_z: float,
        geology_surfaces: dict[UUID, FormationSurfaceOrm],
        inv_x: float,
        inv_y: float,
        suggestion_index: int,
    ) -> UUID | None:
        """Pick the geology formation owning ``target_z`` from TIN surfaces.

        Samples each non-stale TIN at ``(inv_x, inv_y)`` and returns the
        formation whose surface elevation is the smallest value still
        ``>= target_z`` (i.e. the youngest formation whose top sits above
        the target elevation — the formation "active" at that elevation
        because no younger formation reaches that deep here).

        Returns ``None`` when:

        * ``target_z`` sits above every TIN surface at this (x, y) — the
          suggestion is shallower than the youngest formation here.
        * ``(inv_x, inv_y)`` falls outside every TIN footprint — no surface
          covers this location.
        * Every cached TIN is stale or has no vertices.

        Stale TINs are skipped (the safer answer "no parent" over a
        possibly-wrong extrapolation) — the engineer rebuilds the geology
        model and re-accepts to get the precise assignment.

        Parameters
        ----------
        target_z : float
            Absolute elevation (metres TAW or matching CRS) at which to
            classify.  Computed as ``inv_elevation_m - depth_top_m``.
        geology_surfaces : dict[UUID, FormationSurfaceOrm]
            Cached TIN surfaces keyed by geology formation id.
        inv_x, inv_y : float
            Investigation (x, y) in the surfaces' horizontal CRS.
        suggestion_index : int
            0-based index within the suggestions list (for trace logging).

        Returns
        -------
        UUID | None
            Geology formation id whose surface owns ``target_z``, or
            ``None`` when extrapolation cannot be performed.
        """
        candidates: list[tuple[float, UUID]] = []
        for fid, surf_orm in geology_surfaces.items():
            if surf_orm.is_stale or not surf_orm.vertices:
                self.trace(
                    f"[{suggestion_index + 1}] extrapolation: skipping surface for "
                    f"formation {fid} (stale or empty)"
                )
                continue
            tin = _tin_from_surface_orm(surf_orm)
            if tin is None:
                continue
            surf_z = evaluate_tin_at(tin, inv_x, inv_y)
            if surf_z is None:
                continue  # (inv_x, inv_y) outside this TIN's footprint
            if surf_z >= target_z:
                candidates.append((surf_z, fid))
        if not candidates:
            return None
        # min(surf_z) among candidates = closest surface above target_z =
        # youngest formation whose top is above the target elevation.
        return min(candidates, key=lambda c: c[0])[1]

    async def _create_litho_formation(
        self,
        *,
        project_id: UUID,
        parent_formation_id: UUID | None,
        litho_main_soil_code: str,
        admixtures: tuple[Admixture, ...],
        sig: str,
        parent_extrapolated: bool = False,
    ) -> GeologicalFormationOrm:
        """Insert a new lithostratigraphic formation (unit) row.

        The name is auto-derived from the soil code + admixtures so the user
        can distinguish units in the inspector before Phase 2 ordinal resolution.
        ``instance_ordinal`` stays NULL (Phase 2 assigns).

        Parameters
        ----------
        project_id : UUID
        parent_formation_id : UUID | None
        litho_main_soil_code : str
            BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
        admixtures : tuple[Admixture, ...]
        sig : str
            Canonical admixture signature (pre-computed by caller).
        parent_extrapolated : bool
            ``True`` when ``parent_formation_id`` was inferred via TIN
            extrapolation (debt #87) — no geology contact at this
            investigation covered the suggestion's depth.  Stamps the
            column so the LithologyInspector can flag the row for engineer
            confirmation.  ``False`` for contact-based parents and for
            orphans (``parent_formation_id=None``).

        Returns
        -------
        GeologicalFormationOrm
            The freshly flushed row (id assigned, not yet committed).
        """
        # Entry log (DoD §1): a private helper that flushes a real row logs
        # its key params so a failed flush correlates to the inputs (S5).
        self.debug(
            f"  _create_litho_formation: soil={litho_main_soil_code} "
            f"parent={parent_formation_id} sig='{sig}' "
            f"extrapolated={parent_extrapolated}"
        )

        # Auto-name: e.g. "ZAND" or "KLEI (KL:Z)" — readable in the inspector.
        admix_label = f" ({sig})" if sig else ""
        name = f"{litho_main_soil_code}{admix_label}"

        admixtures_json = [
            {"soil_code": a.soil_code, "amount": a.amount, "locally": a.locally} for a in admixtures
        ]

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=name,
            color="#9ca3af",  # neutral grey placeholder; Phase 2 assigns per lithology
            display_order=0,
            parent_formation_id=parent_formation_id,
            parent_extrapolated=parent_extrapolated,
            litho_main_soil_code=litho_main_soil_code,
            litho_admixtures=admixtures_json,
            instance_ordinal=None,  # Phase 2 assigns
            instance_ordinal_locked=False,
        )
        self._session.add(formation)
        await self._session.flush()
        return formation

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
        # -- Step 1: collect formation ids + shallowest contact depth ----------
        contacts_stmt = select(
            FormationContactOrm.formation_id,
            FormationContactOrm.depth_top_m,
        ).where(FormationContactOrm.model_id == litho_model_id)
        contact_rows = (await self._session.execute(contacts_stmt)).all()

        if not contact_rows:
            self.debug(
                f"_recompute_litho_display_orders: no contacts in model {litho_model_id}, skip"
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

    async def _find_or_create_contact(
        self,
        *,
        litho_model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        borehole_id: UUID | None,
        cpt_id: UUID | None,
        confidence: str,
        source: str,
    ) -> tuple[UUID, bool]:
        """Idempotent contact find-or-create.

        Parameters
        ----------
        litho_model_id : UUID
        formation_id : UUID
        depth_top_m : float
        borehole_id : UUID | None
        cpt_id : UUID | None
        confidence : str
            Lowercased confidence string (``"high"`` / ``"medium"`` / ``"low"``).
        source : str
            Contact provenance token — passed through from the suggestion item
            so the caller controls the value.  The bulk segmenter paths carry
            ``"cpt_robertson_2015"`` or ``"borehole_observation"``; the manual-
            pick path sends ``"manual_pick"``.

        Returns
        -------
        tuple[UUID, bool]
            ``(contact_id, was_created)`` — ``True`` when a new row was
            inserted, ``False`` when an existing row was found.
        """
        # Check for an existing contact (idempotent path).
        anchor_filter = (
            FormationContactOrm.borehole_id == borehole_id
            if borehole_id is not None
            else FormationContactOrm.cpt_id == cpt_id
        )
        # ``depth_top_m`` is part of the idempotency key. Without it, a
        # re-accept after a re-segmentation that moved the boundary (param
        # change, or a straddle re-split at a different geology-TIN depth)
        # would match the OLD contact on (model, formation, anchor) alone
        # and silently keep the stale depth (review B1). With it, the same
        # suggestion re-accepts as a no-op; a moved boundary creates a new
        # contact. Phase 1 limitation: re-segmenting at new depths leaves
        # the old contacts — Clear the litho axis before re-accepting to
        # avoid accumulation (Phase 2 adds boundary-move reconciliation).
        # Float match is safe for the idempotent path: an unchanged
        # suggestion yields a bit-identical depth from the same pipeline.
        existing_stmt = select(FormationContactOrm.id).where(
            FormationContactOrm.model_id == litho_model_id,
            FormationContactOrm.formation_id == formation_id,
            FormationContactOrm.depth_top_m == depth_top_m,
            anchor_filter,
        )
        existing_id = (await self._session.execute(existing_stmt)).scalar_one_or_none()
        if existing_id is not None:
            self.trace(
                f"  Contact already exists: {existing_id} "
                f"(formation={formation_id}, depth={depth_top_m:.2f}m)"
            )
            return existing_id, False

        contact = FormationContactOrm(
            id=uuid7(),
            model_id=litho_model_id,
            formation_id=formation_id,
            depth_top_m=depth_top_m,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            source=source,
            confidence=confidence,
        )
        self._session.add(contact)
        await self._session.flush()
        self.trace(
            f"  Contact created: {contact.id} (formation={formation_id}, depth={depth_top_m:.2f}m)"
        )
        return contact.id, True


@dataclass(frozen=True)
class _StraddleResult:
    """Internal result from straddle detection.

    Attributes
    ----------
    intervals : list[tuple[float, UUID | None]]
        ``[(depth_top_m, parent_formation_id), ...]`` — one entry per contact
        to create. Two entries mean the suggestion was split.
    stale_tin_fallback_count : int
        How many splits fell back to depth-ordering (debt #68).
    extrapolated : bool
        ``True`` when ``parent_formation_id`` was inferred from TIN
        extrapolation rather than from a contact at this investigation
        (debt #87).  Always ``False`` on the split path (both halves are
        always contact-based) and on the no-geology-at-all path (no TINs
        to sample).
    """

    intervals: list[tuple[float, UUID | None]]
    stale_tin_fallback_count: int
    extrapolated: bool = False
