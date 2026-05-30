"""Copy a parent geological model's contacts into a lithostratigraphic model.

.. note::
    **Frontend verb ORPHANED (2026-05-18, owner override #1, debt #60).**
    The Sections editor's litho-axis "Seed from geology" verb has been
    rewired to load the geological model's TIN surfaces as a read-only
    backdrop reference layer (``handleLoadBackdropSurfaces`` →
    ``GET .../surfaces``).  This use case + its backend endpoint
    (``POST .../contacts/seed-from-parent``) are retained for
    backwards-compatibility and future re-use, but NO frontend verb
    currently calls them.  The endpoint is safe to call directly (e.g.
    via an external script or a future automated workflow).

The Sections editor's "Seed from geology" button (litho axis) formerly
funnelled through this use case.  It walks every ``FormationContactOrm``
row under the parent geological model and creates a matching row under
the litho model:

* SAME ``formation_id`` and ``borehole_id`` (no formation find-or-create —
  ``geological_formation`` is project-scoped with no ``model_id`` column,
  so the same formation vocabulary is shared across all sibling models).
* ``depth_top_m`` copied verbatim.
* ``source='geological_model_seed'`` (opaque provenance literal;
  ``String(30)`` column in the ORM accommodates it — confirmed before
  coding).
* ``confidence='medium'`` (locked owner decision, 2026-05-18).
* ``observation_id=None``, ``observation_layer_id=None``,
  ``notes=None`` — the seed is model-derived, not observation-derived.

Scope filtering
---------------
* ``borehole_ids`` (optional) — when provided, only contacts whose
  ``borehole_id`` is in this set are seeded (mirrors
  ``AutoPopulateContactsFromStratigraphy``; the caller passes in-corridor
  boreholes).  ``None`` means "all boreholes".
* The litho model's own ``excluded_borehole_ids`` is applied after the
  ``borehole_ids`` filter.  Architect Risk 3: do NOT use the PARENT
  model's exclusion list here — the litho model may have a different set
  of exclusions.

Idempotency
-----------
Re-running is safe: the ``(model_id, formation_id, borehole_id)``
unique index (``uq_formation_contact_model_formation_borehole``) enforces
exactly-one-contact-per-triple at the DB layer.  The use case pre-checks
existing contacts and skips any ``(formation_id, borehole_id)`` pair that
already exists in the litho model, returning a ``skipped_existing`` count.
No rows are ever deleted.

On-click build contract
-----------------------
Contact creation marks the litho model's ``FormationSurfaceOrm`` rows
stale (same call as ``AutoPopulateContactsFromStratigraphy``) without
triggering Delaunay — the "Build model" button is the user's explicit
trigger.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class SeedLithoOutcome:
    """Result of a :class:`SeedLithoFromGeologicalModel` run.

    Attributes
    ----------
    created_contact_ids : list[UUID]
        IDs of freshly-created ``FormationContact`` rows under the litho model.
    found_contact_ids : list[UUID]
        IDs of contacts that **already existed** in the litho model for the
        in-scope (formation, borehole) pairs — skipped for idempotency.
        Used ONLY internally by the endpoint, which unions them with
        ``created_contact_ids`` to seed a section's
        ``seeded_formation_contact_ids``.  NOT surfaced in
        ``SeedLithoFromParentResponse`` — the frontend re-fetches the full
        contact list after Seed, so it never needs the found ids directly.
    skipped_existing : int
        Count of (formation, borehole) pairs skipped because a contact
        already existed in the litho model.
    """

    __slots__ = ("created_contact_ids", "found_contact_ids", "skipped_existing")

    def __init__(
        self,
        *,
        created_contact_ids: list[UUID],
        found_contact_ids: list[UUID],
        skipped_existing: int,
    ) -> None:
        """Store the three outcome fields."""
        self.created_contact_ids = created_contact_ids
        self.found_contact_ids = found_contact_ids
        self.skipped_existing = skipped_existing


class SeedLithoFromGeologicalModel(GroundModelLogger):
    """Copy a parent geological model's contacts into a lithostratigraphic model.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
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
        model_id: UUID,
        borehole_ids: list[UUID] | None = None,
    ) -> SeedLithoOutcome:
        """Copy parent geological model contacts into the litho model.

        Parameters
        ----------
        project_id : UUID
            Owning project — used for logging; the model's
            ``app_project_id`` is validated by the endpoint's scope guard
            before calling this use case.
        model_id : UUID
            Lithostratigraphic model to seed.  Must have
            ``kind='lithostratigraphic'`` and a non-null
            ``parent_geological_model_id``; validated here and raises
            ``ValueError`` on violation so the endpoint can map to 422.
        borehole_ids : list[UUID] or None, optional
            When provided, only contacts whose ``borehole_id`` is in this
            set are seeded (in-corridor scope from the Sections editor).
            When ``None``, all project boreholes are eligible subject to
            the litho model's own ``excluded_borehole_ids``.

        Returns
        -------
        SeedLithoOutcome
            Created/found counts + ids so the endpoint can build a
            meaningful response and seed the section's explicit-content set.

        Raises
        ------
        ValueError
            When the model is not ``kind='lithostratigraphic'``, has no
            ``parent_geological_model_id``, or when the parent model
            cannot be found.
        """
        self.info(
            f"SeedLithoFromGeologicalModel.execute: "
            f"project={project_id} litho_model={model_id} "
            f"borehole_ids={len(borehole_ids) if borehole_ids is not None else 'all'}"
        )

        # ----------------------------------------------------------------
        # 1. Load and validate the litho model
        # ----------------------------------------------------------------
        litho_model = await self._session.get(GeologicalModelOrm, model_id)
        if litho_model is None:
            raise ValueError(f"Model {model_id} not found")
        if litho_model.kind != "lithostratigraphic":
            raise ValueError(
                f"Model {model_id} has kind='{litho_model.kind}'; "
                "seed-from-parent requires kind='lithostratigraphic'"
            )
        if litho_model.parent_geological_model_id is None:
            raise ValueError(
                f"Lithostratigraphic model {model_id} has no parent_geological_model_id; "
                "it cannot be seeded from a geological model"
            )
        parent_model_id = litho_model.parent_geological_model_id

        # ----------------------------------------------------------------
        # 2. Build the effective borehole scope
        #    - Start with the caller-provided set (in-corridor boreholes),
        #      or None (all project boreholes).
        #    - Apply the LITHO model's own excluded_borehole_ids
        #      (Architect Risk 3 — NOT the parent's exclusion list).
        # ----------------------------------------------------------------
        litho_excluded: frozenset[UUID] = frozenset(litho_model.excluded_borehole_ids or [])

        if borehole_ids is not None:
            effective_bh_ids: frozenset[UUID] | None = frozenset(borehole_ids) - litho_excluded
        else:
            effective_bh_ids = None  # all boreholes; exclusions applied per-contact below

        effective_scope_label = (
            "all minus excluded" if effective_bh_ids is None else str(len(effective_bh_ids))
        )
        self.debug(
            f"SeedLithoFromGeologicalModel: parent={parent_model_id} "
            f"litho_excluded={len(litho_excluded)} "
            f"effective_scope={effective_scope_label}"
        )

        # ----------------------------------------------------------------
        # 3. Load parent geological model contacts
        # ----------------------------------------------------------------
        parent_contacts_stmt = select(FormationContactOrm).where(
            FormationContactOrm.model_id == parent_model_id,
            FormationContactOrm.borehole_id.is_not(
                None
            ),  # CPT contacts excluded (litho uses borehole anchors)
        )
        parent_contacts = list((await self._session.execute(parent_contacts_stmt)).scalars().all())
        self.info(
            f"SeedLithoFromGeologicalModel: loaded {len(parent_contacts)} "
            f"borehole-anchored contact(s) from parent model {parent_model_id}"
        )

        if not parent_contacts:
            self.info(
                "SeedLithoFromGeologicalModel: parent model has no borehole "
                "contacts — nothing to seed"
            )
            # No writes were issued — do NOT commit a read-only session
            # (mirrors AutoPopulateContactsFromStratigraphy's early-exit
            # behaviour; the get_session finalizer closes it cleanly).
            return SeedLithoOutcome(
                created_contact_ids=[],
                found_contact_ids=[],
                skipped_existing=0,
            )

        # ----------------------------------------------------------------
        # 4. Pre-load existing litho model contacts for idempotency check
        #    Index: (formation_id, borehole_id) → existing contact id
        # ----------------------------------------------------------------
        # A4 cleanup: idempotency index reads litho_layer (Shape A source
        # of truth, accepted rows only — pending suggestions don't count
        # as already-seeded; rejected layers neither).
        litho_contacts_stmt = select(
            LithoLayerOrm.id,
            LithoLayerOrm.formation_id,
            LithoLayerOrm.borehole_id,
        ).where(
            LithoLayerOrm.model_id == model_id,
            LithoLayerOrm.status == "accepted",
        )
        litho_contact_rows = list((await self._session.execute(litho_contacts_stmt)).all())
        # (formation_id, borehole_id) → existing layer id
        existing_pair_to_id: dict[tuple[UUID, UUID], UUID] = {
            (row[1], row[2]): row[0]
            for row in litho_contact_rows
            if row[1] is not None and row[2] is not None
        }
        self.debug(
            f"SeedLithoFromGeologicalModel: {len(existing_pair_to_id)} "
            f"existing contact pair(s) in litho model (idempotency index)"
        )

        # ----------------------------------------------------------------
        # 5. Walk parent contacts and create litho contacts
        # ----------------------------------------------------------------
        created_contact_ids: list[UUID] = []
        found_contact_ids: list[UUID] = []
        # Formations for which we actually CREATED at least one new contact.
        # Only these get their TIN surface marked stale — an idempotent
        # re-run that creates nothing must not stale a surface the user
        # just built (on-click build contract, CLAUDE.md). Accumulated in
        # the loop, NOT re-derived from parent_contacts (which would also
        # count skipped/already-existing pairs).
        created_formation_ids: set[UUID] = set()
        skipped_existing = 0
        skipped_scope = 0
        total = len(parent_contacts)

        for i, parent_contact in enumerate(parent_contacts, start=1):
            bh_id = parent_contact.borehole_id
            assert bh_id is not None  # filtered above

            # Scope filter — apply caller-provided borehole set
            if effective_bh_ids is not None and bh_id not in effective_bh_ids:
                skipped_scope += 1
                self.debug(
                    f"[{i}/{total}] SeedLitho: contact {parent_contact.id} "
                    f"borehole {bh_id} not in effective scope — skipped"
                )
                continue

            # Exclusion filter for the "all boreholes" path
            # (effective_bh_ids is None → check exclusion per-contact)
            if effective_bh_ids is None and bh_id in litho_excluded:
                skipped_scope += 1
                self.debug(
                    f"[{i}/{total}] SeedLitho: contact {parent_contact.id} "
                    f"borehole {bh_id} excluded by litho model — skipped"
                )
                continue

            formation_id = parent_contact.formation_id
            pair_key = (formation_id, bh_id)

            # Idempotency: skip if (formation, borehole) already in litho model
            if pair_key in existing_pair_to_id:
                existing_id = existing_pair_to_id[pair_key]
                skipped_existing += 1
                found_contact_ids.append(existing_id)
                self.debug(
                    f"[{i}/{total}] SeedLitho: (formation={formation_id}, "
                    f"borehole={bh_id}) already in litho model (id={existing_id}) — skipped"
                )
                continue

            # A4 cleanup — Shape A native write. The seeded boundary is
            # a single point in depth (the parent geo contact's
            # depth_top_m); the layer's depth_base_m is the next
            # contact down at the same borehole. Computing that
            # natively here would require sorting all seeded + existing
            # contacts at the anchor — non-trivial across borehole
            # groups. Instead, write the layer with a sentinel
            # depth_base_m = depth_top_m + 0.001 (satisfies the
            # depth-ordered CHECK) and let the FC↔LL trigger pair
            # correct it: the LL→FC trigger materialises the FC mirror;
            # the FC→LL trigger then recomputes depth_base_m via LEAD
            # over current FCs at the (model, anchor). End state has
            # the same depth_base_m derivation as the legacy path.
            new_layer = LithoLayerOrm(
                id=uuid7(),
                model_id=model_id,
                formation_id=formation_id,
                borehole_id=bh_id,
                cpt_id=None,
                depth_top_m=parent_contact.depth_top_m,
                depth_base_m=parent_contact.depth_top_m + 0.001,
                status="accepted",
                # Seed provenance — maps to FC.source='manual_pick' via the
                # LL→FC trigger. The original 'geological_model_seed' token
                # is preserved in this constant for archaeology; the LL
                # source enum is intentionally tighter (no seed-specific
                # value) and the FC mirror's source loses that distinction
                # by design.
                source="manual",
                confidence="medium",
                observation_id=None,
                observation_layer_id=None,
                notes=None,
            )
            self._session.add(new_layer)
            existing_pair_to_id[pair_key] = new_layer.id  # keep index current
            created_contact_ids.append(new_layer.id)
            if formation_id is not None:
                created_formation_ids.add(formation_id)
            self.debug(
                f"[{i}/{total}] SeedLitho: created layer {new_layer.id} "
                f"formation={formation_id} borehole={bh_id} "
                f"depth={parent_contact.depth_top_m:.3f}m"
            )

        self.info(
            f"SeedLithoFromGeologicalModel: contact loop done — "
            f"+{len(created_contact_ids)} created, "
            f"{skipped_existing} skipped existing, "
            f"{skipped_scope} skipped out-of-scope"
        )

        # ----------------------------------------------------------------
        # 6. Flush, mark surfaces stale, commit
        # ----------------------------------------------------------------
        await self._session.flush()

        # On-click build contract: mark stale ONLY the surfaces of
        # formations that actually gained a new contact this run.  An
        # idempotent re-run (zero creates) marks nothing stale.  Brand-new
        # formations have no surface row yet — mark_surfaces_stale no-ops
        # on them silently.
        stale_count = await self._repo.mark_surfaces_stale(
            (model_id, fid) for fid in created_formation_ids
        )

        await self._session.commit()
        self.success(
            f"SeedLithoFromGeologicalModel done: "
            f"project={project_id} litho_model={model_id} "
            f"+{len(created_contact_ids)} contacts, "
            f"{skipped_existing} skipped existing, "
            f"{skipped_scope} skipped out-of-scope, "
            f"{stale_count} surface(s) marked stale"
        )

        return SeedLithoOutcome(
            created_contact_ids=created_contact_ids,
            found_contact_ids=found_contact_ids,
            skipped_existing=skipped_existing,
        )
