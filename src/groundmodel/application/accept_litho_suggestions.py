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

        # --- Load investigation x/y for straddle sampling -------------------
        inv_x, inv_y = await self._load_investigation_xy(cpt_id=cpt_id, borehole_id=borehole_id)
        self.debug(
            f"Investigation xy: ({inv_x:.1f}, {inv_y:.1f}) "
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
                    formation = await self._create_litho_formation(
                        project_id=project_id,
                        parent_formation_id=interval_parent_fid,
                        litho_main_soil_code=sug.suggested_lithology,
                        admixtures=sug.suggested_admixtures,
                        sig=sig,
                    )
                    litho_formations[fkey] = formation
                    created_formation_ids.append(formation.id)
                    self.debug(
                        f"  Created litho formation {formation.id} — "
                        f"{sug.suggested_lithology} parent={interval_parent_fid}"
                    )
                else:
                    if formation.id not in found_formation_ids:
                        found_formation_ids.append(formation.id)
                    self.debug(
                        f"  Found litho formation {formation.id} — "
                        f"{sug.suggested_lithology} parent={interval_parent_fid}"
                    )

                # Find-or-create the contact.
                contact_id, was_created = await self._find_or_create_contact(
                    litho_model_id=litho_model_id,
                    formation_id=formation.id,
                    depth_top_m=interval_top,
                    borehole_id=borehole_id,
                    cpt_id=cpt_id,
                    confidence=sug.confidence.value.lower(),
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

        await self._session.commit()
        self.success(
            f"AcceptLithoSuggestions: litho_model={litho_model_id} — "
            f"{len(created_contact_ids)} contact(s) created, "
            f"{len(found_contact_ids)} found, "
            f"{straddle_split_count} straddle split(s), "
            f"{stale_tin_fallback_count} stale-TIN fallback(s)"
        )

        return AcceptLithoResult(
            created_formation_ids=created_formation_ids,
            found_formation_ids=found_formation_ids,
            created_contact_ids=created_contact_ids,
            found_contact_ids=found_contact_ids,
            straddle_split_count=straddle_split_count,
            stale_tin_fallback_count=stale_tin_fallback_count,
            updated_section_id=section_id,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_investigation_xy(
        self,
        *,
        cpt_id: UUID | None,
        borehole_id: UUID | None,
    ) -> tuple[float, float]:
        """Load raw (x, y) for the investigation.

        Parameters
        ----------
        cpt_id : UUID | None
        borehole_id : UUID | None

        Returns
        -------
        tuple[float, float]
            ``(location_x, location_y)`` in the source CRS.

        Raises
        ------
        ValueError
            When the investigation row does not exist.
        """
        if cpt_id is not None:
            row = await self._session.get(CptOrm, cpt_id)
            if row is None:
                raise ValueError(f"CPT {cpt_id} not found")
            return row.location_x, row.location_y
        else:
            row = await self._session.get(BoreholeOrm, borehole_id)
            if row is None:
                raise ValueError(f"Borehole {borehole_id} not found")
            return row.location_x, row.location_y

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
            # No geology context — return a single interval with no parent.
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
            return _StraddleResult(
                intervals=[(top, parent_fid)],
                stale_tin_fallback_count=stale_fallbacks,
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

    async def _create_litho_formation(
        self,
        *,
        project_id: UUID,
        parent_formation_id: UUID | None,
        litho_main_soil_code: str,
        admixtures: tuple[Admixture, ...],
        sig: str,
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

        Returns
        -------
        GeologicalFormationOrm
            The freshly flushed row (id assigned, not yet committed).
        """
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
            litho_main_soil_code=litho_main_soil_code,
            litho_admixtures=admixtures_json,
            instance_ordinal=None,  # Phase 2 assigns
            instance_ordinal_locked=False,
        )
        self._session.add(formation)
        await self._session.flush()
        return formation

    async def _find_or_create_contact(
        self,
        *,
        litho_model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        borehole_id: UUID | None,
        cpt_id: UUID | None,
        confidence: str,
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
        existing_stmt = select(FormationContactOrm.id).where(
            FormationContactOrm.model_id == litho_model_id,
            FormationContactOrm.formation_id == formation_id,
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
            source="borehole_observation" if borehole_id is not None else "cpt_robertson_2015",
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
    """

    intervals: list[tuple[float, UUID | None]]
    stale_tin_fallback_count: int
