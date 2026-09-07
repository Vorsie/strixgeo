"""Build the 3-D litho-solid cache from the validated 2-D voxel partitions.

This use case replaced the retired implicit strat-field builder
(``RecomputeLithoSolids``, deleted with the ``strat_field`` package — #237;
git history has both).  Where the implicit builder fit a stratigraphic field
through the DB picks, this builder takes the frontend's already-validated 2-D
section partitions (``computeSectionFill``) as the SOURCE OF TRUTH and:

1. Builds a :class:`~groundmodel.domain.services.model_domain.ModelDomain` from
   the section columns' world positions (the footprint that gates labelling) —
   via ``build_domain_from_sections``.  The payload is self-contained; NO
   database picks are loaded for the domain.
2. Labels a regular 3-D voxel grid from the partitions
   (:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`):
   every voxel carries the body that fills it.  A labelling of space is itself a
   partition, so the extracted boundaries are watertight AND faithful by
   construction (interfingering / pinch-out is representable — the implicit
   field could not do this).
3. Extracts each body's greedy-meshed watertight boundary
   (:func:`~groundmodel.domain.services.voxel_litho.extract_body_solids.extract_body_solids`).
4. Upserts each mesh into ``litho_body_solid`` (method ``"voxel"``) via the
   shared :class:`~groundmodel.application.litho_solid_persistence.LithoSolidPersistenceMixin`,
   orphan-deletes rows no longer built, and commits once.

Checksum
--------
The build is GLOBAL (one labelling of the whole grid), so the checksum is
model-level: a single digest over the section partition payload (every region's
formation / body / polygon / gap + every column's world position) plus the grid
spacing.  When the digest matches every stored row AND ``force`` is False the
whole rebuild is skipped.  The on-click Build passes ``force=True``.

Honor-borehole
--------------
The section blend at an investigation's TRUE map ``(x, y)`` can disagree with
the investigation's own observed log, because a borehole feeds a section at its
PROJECTED foot on the section line — usually metres off its true position.  So
this use case ALSO loads the model's resolved picks
(:meth:`LithoLayerRepository.load_body_picks`) and builds one
:class:`~groundmodel.domain.services.voxel_litho.voxel_types.InvestigationColumn`
per investigation; ``label_voxels`` then labels each investigation's own grid
column from its OWN log within its observed depth range (the section blend still
fills above the log's top / below its base, so a shallow log punches no hole).
The picks' ``body_id`` is the resolved value, so the honored voxels group with
the matching section-partition bodies.

What this use case deliberately does NOT do
------------------------------------------
* It does NOT run ``ResolveLithoInstances`` (unlike the retired implicit
  builder): the payload's ``body_id`` values — and the picks' ``body_id`` (which
  ``load_body_picks`` reflects from the resolver) — ALREADY reflect the resolved
  state, so re-resolving could desync the 3-D model from the 2-D partition the
  user validated.  The frontend is the single source of body identity here.

Domain-layer purity is preserved: the API converts its Pydantic request into the
frozen domain value objects (``SectionPartitionInput``) before calling
``execute``; this use case only sees value objects.
"""

from __future__ import annotations

import asyncio
import hashlib
import struct
import time
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import asdict
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.gapless_build_report_assembler import GaplessBuildReportAssembler
from groundmodel.application.litho_solid_persistence import (
    LithoSolidPersistenceMixin,
    LithoSolidsOutcome,
    _SolidMeta,
    storage_body_id,
)
from groundmodel.application.load_bed_overrides import load_bed_override_polygons
from groundmodel.application.packing_class_key_loader import load_packing_class_key
from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.bed_override import bed_level_at
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    apply_body_aliases,
    plan_body_aliases,
)
from groundmodel.domain.services.voxel_litho.packing_class_key import packing_class_key_of
from groundmodel.domain.services.voxel_litho.section_reconciliation import reconcile_sections
from groundmodel.domain.services.voxel_litho.true_column_positions import (
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_constants import HAIRLINE_LIMIT_M
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    LabelReport,
    SectionPartitionInput,
    SectionReconciliation,
)
from groundmodel.domain.value_objects.bed_override_polygon import BedOverridePolygon
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
from groundmodel.shared.exceptions import BuildCancelled
from groundmodel.shared.timing import phase_timer

_BUILD_CPU_LOCK = asyncio.Lock()
"""Serialises the two CPU phases so the voxel grid budget stays a PER-PROCESS bound.

``voxel_grid_budget.MAX_VOXEL_CELLS`` is sized on the peak memory of ONE build
(~550 MB: the int32 label grid plus the mesher's full-grid bool arrays). Before
those phases moved to ``asyncio.to_thread`` the single event loop serialised them
for free; off the loop they can run side by side in the default thread pool, and
nothing re-checks the budget for a second occupant. A second Build therefore
WAITS here — which is also the behaviour engineers already experienced.

If concurrency is ever wanted, the budget constant has to be divided by the
permitted concurrency; say so in ``voxel_grid_budget`` before changing this.
"""


def _generation_payload(sections: list[SectionPartitionInput]) -> dict[str, object]:
    """Serialise the partitions exactly as the build received them.

    The stored generation is what ``--reproduce`` replays and what every build
    diagnostic reads, so it must not be a lossy view of the build's own input.
    Fields are taken from the value objects rather than listed by hand: writing the
    names out is what silently dropped the 2-D classification here, at the payload
    boundary, and in ``apply_body_aliases`` — three times in one pipeline (#256).

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The partitions the build labelled, after aliasing and seating.

    Returns
    -------
    dict
        JSON-ready payload. Polygon points become lists so the stored shape is
        unchanged for readers written before the classification existed.
    """
    return {
        "sections": [
            {
                "start_x": sec.start_x,
                "start_y": sec.start_y,
                "end_x": sec.end_x,
                "end_y": sec.end_y,
                "columns": [asdict(c) for c in sec.columns],
                "regions": [
                    {**asdict(r), "polygon": [[f, e] for f, e in r.polygon]} for r in sec.regions
                ],
            }
            for sec in sections
        ]
    }


def _partition_checksum(
    sections: list[SectionPartitionInput],
    grid_spacing_m: float,
    investigation_columns: tuple[InvestigationColumn, ...] = (),
    *,
    vertical_spacing_m: float | None = None,
    honor_radius_m: float = 0.0,
    bed_overrides: Sequence[BedOverridePolygon] = (),
) -> bytes:
    """Model-wide BLAKE2b-16 digest over the voxel build inputs.

    The voxel build is a single global labelling of the grid, so the digest is
    model-level (not per-body): any change to a region's lithology / body /
    polygon, a column's world position, the section line, the grid spacing, OR
    a honored investigation's observed log moves the labelling and must bust the
    cache.

    The digest folds in, deterministically (sections in payload order, regions
    and columns in their payload order — both are stable for an unchanged
    payload; investigation columns pre-sorted by ``investigation_id``):

    * the (horizontal / cubic) grid spacing,
    * the vertical spacing, ONLY when an anisotropic build is requested
      (``vertical_spacing_m`` is not ``None``) — so a cubic build's digest is
      byte-stable with the pre-anisotropy form (no one-time cache bust), while
      switching the vertical spacing or toggling anisotropy busts the cache,
    * each section's line endpoints,
    * each column's investigation id + world position,
    * each region's formation id + body id (the empty string for ``None``) +
      gap index + every polygon ``(fraction, elevation)`` point,
    * each honored investigation column's id + world position + observed
      intervals (so a pick change rebuilds — see
      :func:`_investigation_columns_checksum`).

    The parent geological model's surfaces are NOT folded in: since 2026-07-30 the
    voxel builder does not consume them at all, so a geo-surface rebuild cannot
    move the litho labelling and must not bust its cache.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The section partitions (the build payload).
    grid_spacing_m : float
        The voxel grid spacing.
    investigation_columns : tuple of InvestigationColumn, optional
        The honored per-investigation observed columns (loaded from the DB
        picks); defaults to ``()`` (no honoring → digest unchanged from the
        section-only form for that case).
    honor_radius_m : float, optional
        The honored-column radius.  Folded in so widening or narrowing it
        rebuilds — it changes which voxels take an investigation's own log
        instead of the section blend.  Defaults to ``0.0`` (the pre-#249
        nearest-cell-only behaviour), which keeps the digest byte-stable for a
        caller that does not pass one.
    vertical_spacing_m : float or None, optional
        The anisotropic Z spacing.  ``None`` (the cubic case) is NOT folded in,
        so the cubic digest is byte-stable with the pre-anisotropy form; a set
        value is folded after a domain-separator byte so an anisotropy change
        rebuilds.
    bed_overrides : Sequence of BedOverridePolygon, optional
        The project's manual bed-override polygons (the canal cut-out).  Folded
        in ONLY when the project has one, after its own domain separator, so a
        project with no bed override keeps the exact pre-bed digest; drawing,
        re-levelling or moving a polygon busts the cache so the on-open
        ``force=false`` path rebuilds with the new cap.  Defaults to ``()``.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    h.update(struct.pack("<d", grid_spacing_m))
    # Anisotropy: fold the vertical spacing ONLY when set (after a domain
    # separator), keeping the cubic digest byte-stable with the pre-anisotropy
    # form — a cubic build never re-meshes spuriously, while switching the
    # vertical spacing or toggling anisotropy busts the cache.
    if vertical_spacing_m is not None:
        h.update(b"\x03")
        h.update(struct.pack("<d", vertical_spacing_m))
    # Same shape for the honored radius: folded only when set, after its own
    # domain separator, so a caller that does not pass one keeps the previous
    # digest exactly.
    if honor_radius_m:
        h.update(b"\x04")
        h.update(struct.pack("<d", float(honor_radius_m)))
    # Bed overrides (the canal cut-out, owner ruling 2026-09-07): fold each
    # polygon's level + ring ONLY when the project has one, after its own domain
    # separator, so a project with no bed override keeps the exact pre-bed digest
    # (no one-time cache bust) while drawing, re-levelling or moving a polygon
    # busts the cache and rebuilds the 3-D model on the on-open force=false path —
    # the labelling voids every voxel above the bed inside the polygon.
    if bed_overrides:
        h.update(b"\x05")
        for poly in bed_overrides:
            h.update(poly.label.encode("utf-8"))
            h.update(struct.pack("<d", poly.level_m))
            h.update(struct.pack("<i", len(poly.vertices)))
            for vx, vy in poly.vertices:
                h.update(struct.pack("<dd", vx, vy))
    for s in sections:
        h.update(struct.pack("<dddd", s.start_x, s.start_y, s.end_x, s.end_y))
        for c in s.columns:
            h.update(c.investigation_id.encode("utf-8"))
            h.update(struct.pack("<ddd", c.along_m, c.world_x, c.world_y))
        for r in s.regions:
            h.update(r.formation_id.encode("utf-8"))
            # body_id may be None (never-correlated minority) — use a sentinel
            # that cannot collide with a real body_id string.
            h.update(b"\x00" if r.body_id is None else r.body_id.encode("utf-8"))
            h.update(struct.pack("<i", r.gap_index))
            # The 2-D classification is a labelling input from #256 onward: a band,
            # an onlap and an enclosed lens can share an outline and must not share
            # a digest. Folding them in busts every pre-#256 cache once, which is
            # correct — those builds were labelled without this evidence.
            h.update(b"\x00" if r.kind is None else r.kind.encode("utf-8"))
            h.update(b"\x00" if r.overlay_tier is None else r.overlay_tier.encode("utf-8"))
            h.update(
                b"\x00"
                if r.tied_band_base is None
                else b"\x01" + struct.pack("<d", r.tied_band_base)
            )
            h.update(b"\x01" if r.tie_clipped else b"\x00")
            for frac, elev in r.polygon:
                h.update(struct.pack("<dd", frac, elev))
    _investigation_columns_checksum(h, investigation_columns)
    return h.digest()


def _investigation_columns_from_picks(
    picks: list[BodyLayerPick],
) -> tuple[InvestigationColumn, ...]:
    """Group body-assigned picks into per-investigation observed columns.

    Each pick is one member-layer at one investigation; grouped by
    ``investigation_id``, converted from depth to absolute elevation
    (``elevation = surface_elev_m - depth_m``), and ordered top → bottom.  The
    pick's ``body_id`` is the resolver-assigned identity (``load_body_picks``
    reflects the resolver), so the honored voxels group with the matching
    section-partition bodies in the mesher.

    Parameters
    ----------
    picks : list of BodyLayerPick
        Accepted body-assigned picks from
        :meth:`LithoLayerRepository.load_body_picks`.

    Returns
    -------
    tuple of InvestigationColumn
        One column per investigation, ordered by ``investigation_id`` for a
        deterministic checksum, intervals ordered top → bottom.
    """
    by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)

    columns: list[InvestigationColumn] = []
    for inv_id in sorted(by_inv):
        inv_picks = by_inv[inv_id]
        # Picks at one investigation are assumed depth-ordered top < base (the
        # upstream litho-layer constraint), and may have VERTICAL GAPS — a
        # body-unassigned / rejected layer between two accepted ones is dropped
        # by ``load_body_picks``, so the resulting intervals are not necessarily
        # contiguous.  The honor labeller is gap-aware (an unlogged interval
        # defers to the section blend), so a gap here is correct, not a defect.
        # Surface + world position are per-investigation constants on every pick.
        first = inv_picks[0]
        intervals = tuple(
            sorted(
                (
                    (
                        p.body_id,
                        p.formation_id,
                        p.surface_elev_m - p.top_depth_m,
                        p.surface_elev_m - p.base_depth_m,
                    )
                    for p in inv_picks
                ),
                key=lambda iv: -iv[2],  # descending top elevation = top → bottom
            )
        )
        columns.append(
            InvestigationColumn(
                investigation_id=inv_id,
                world_x=first.x_m,
                world_y=first.y_m,
                intervals=intervals,
                # Constant per investigation (every pick shares one anchor); the
                # labeller needs it to decide which of two investigations sharing
                # a grid column is honored.
                kind=first.kind,
            )
        )
    return tuple(columns)


def _apply_aliases_to_columns(
    columns: tuple[InvestigationColumn, ...],
    aliases: dict[str, str],
) -> tuple[InvestigationColumn, ...]:
    """Relabel each honored column's interval body ids through ``aliases``.

    The honored intervals carry the resolver-assigned ``body_id`` straight from
    the database, while the section regions carry the frontend partition's. Both
    must pass through the SAME alias map or the labeller registers two identities
    for one physical unit — one in blended space, one at the honored column — and
    the mesher emits them as separate bodies that abut.

    Parameters
    ----------
    columns : tuple of InvestigationColumn
        The per-investigation observed columns.
    aliases : dict of str to str
        The map from :func:`plan_body_aliases`.

    Returns
    -------
    tuple of InvestigationColumn
        New value objects with aliased interval body ids; input untouched.
    """
    out: list[InvestigationColumn] = []
    for column in columns:
        intervals = tuple(
            (aliases.get(body_id, body_id), formation_id, top, base)
            for body_id, formation_id, top, base in column.intervals
        )
        out.append(
            InvestigationColumn(
                investigation_id=column.investigation_id,
                world_x=column.world_x,
                world_y=column.world_y,
                intervals=intervals,
                kind=column.kind,
            )
        )
    return tuple(out)


def _investigation_columns_checksum(
    h: hashlib.blake2b, columns: tuple[InvestigationColumn, ...]
) -> None:
    """Fold the honored investigation columns into an open BLAKE2b digest.

    A pick change (a moved contact, a re-assigned body, an added / removed
    layer) must bust the model cache so the on-open / force=false path rebuilds.
    Columns arrive already sorted by ``investigation_id`` (deterministic order);
    each interval is folded in its top → bottom order.

    The investigation ``kind`` is folded in too, because it decides which
    investigation is honored when two of them share a voxel column — so a
    re-typed anchor changes the labelling.  This is a ONE-TIME cache bust for
    every existing model: an unchanged model's digest moves once, the next build
    rewrites it, and it is stable thereafter.  Backwards compatibility is
    suspended pre-ship (CLAUDE.md), and the on-click Build passes ``force=True``
    regardless.

    Parameters
    ----------
    h : hashlib.blake2b
        The open digest being accumulated (mutated in place).
    columns : tuple of InvestigationColumn
        The honored investigation columns to fold in.
    """
    for c in columns:
        h.update(b"\x01")  # domain separator between sections + columns
        h.update(c.investigation_id.encode("utf-8"))
        h.update(c.kind.encode("utf-8"))
        h.update(struct.pack("<dd", c.world_x, c.world_y))
        for body_id, formation_id, top, base in c.intervals:
            h.update(body_id.encode("utf-8"))
            h.update(formation_id.encode("utf-8"))
            h.update(struct.pack("<dd", top, base))


class BuildVoxelLithoModel(LithoSolidPersistenceMixin):
    """Build + persist the litho 3-D solids from the validated 2-D voxel partitions.

    Persists into the ``litho_body_solid`` cache with the upsert / orphan /
    model-checksum semantics inherited from
    :class:`~groundmodel.application.litho_solid_persistence.LithoSolidPersistenceMixin`,
    taking the frontend section partitions as its input.  The ``method``
    column is stamped ``"voxel"``.

    The caller owns the session; this use case commits once at the end.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    # Stamp ``method="voxel"`` on every persisted solid row (the mixin reads it).
    _solid_method: str = "voxel"

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    @staticmethod
    def _raise_if_cancelled(should_cancel: Callable[[], bool] | None) -> None:
        """Raise :class:`BuildCancelled` when a cancel has been requested.

        The between-phase half of the cooperative cancel: called before each CPU
        phase so a cancel that arrives while the previous phase runs stops the
        build before the next one starts. The per-column half lives inside
        ``label_voxels``. A no-op when ``should_cancel`` is ``None`` or ``False``.

        Parameters
        ----------
        should_cancel : callable of () -> bool, or None
            The cancel predicate, or ``None`` for an un-cancellable build.
        """
        if should_cancel is not None and should_cancel():
            raise BuildCancelled("voxel build cancelled between phases — nothing was written")

    @staticmethod
    def _emit_progress(
        progress: Callable[[str, int, int], None] | None, phase: str, done: int, total: int
    ) -> None:
        """Report a progress event, when a reporter is wired.

        A no-op when ``progress`` is ``None`` (the synchronous endpoint). The
        callback must not block: the background-job wiring marshals the event
        onto the event loop and returns at once, so this is safe to call from
        inside the ``to_thread`` worker (the ``"label"`` relay) as well as from
        the event loop (the phase markers).

        Parameters
        ----------
        progress : callable of (phase, done, total) -> None, or None
            The reporter, or ``None`` when nothing consumes progress.
        phase : str
            Phase name (``"label"`` / ``"reconcile"`` / ``"extract"`` /
            ``"persist"``).
        done, total : int
            Units finished and total for this phase.
        """
        if progress is not None:
            progress(phase, done, total)

    async def execute(
        self,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        *,
        grid_spacing_m: float,
        vertical_spacing_m: float | None = None,
        force: bool = False,
        gapless_2d: list[dict[str, Any]] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        progress: Callable[[str, int, int], None] | None = None,
    ) -> LithoSolidsOutcome:
        """Build the 3-D litho solids, cancellably and with progress (see #282).

        Thin wrapper over :meth:`_execute_impl` that owns the cancel contract:
        when a cooperative cancel raises
        :class:`~groundmodel.shared.exceptions.BuildCancelled` — from a
        between-phase check here or from inside the labeller's column loop — it
        ROLLS THE SESSION BACK and re-raises, so a cancelled build leaves the
        stored model exactly as it was (owner ruling, debt #282). Every non-cancel
        path is unchanged.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic / geotech model to (re)build.
        sections : list of SectionPartitionInput
            The validated 2-D section partitions (the build payload).
        grid_spacing_m : float
            Horizontal (X/Y) voxel edge length in metres; also Z when
            ``vertical_spacing_m`` is ``None`` (the cubic case). Must be positive.
        vertical_spacing_m : float or None, optional
            Anisotropic Z spacing; ``None`` (default) → a cubic grid.
        force : bool, default ``False``
            Skip the model-level checksum short-circuit and always rebuild. The
            on-click Build passes ``True``.
        gapless_2d : list of dict, or None, optional
            The renderer's clause 1-4 findings for the gapless gate, or ``None``.
        should_cancel : callable of () -> bool, or None, optional
            Cooperative-cancel predicate. Checked between phases here and once
            per voxel column inside the labeller. When it returns ``True`` the
            build stops, rolls back, and raises ``BuildCancelled``. ``None`` (the
            default) never cancels — the synchronous endpoint passes none.
        progress : callable of (phase, done, total) -> None, or None, optional
            Progress reporter. Called with a phase name (``"label"`` /
            ``"reconcile"`` / ``"extract"`` / ``"persist"``) at each CPU-phase
            boundary, and relayed the labeller's per-column ``(done, total)``
            ticks under ``"label"``. ``None`` (the default) reports nothing.

        Returns
        -------
        LithoSolidsOutcome
            The build outcome (see :meth:`_execute_impl`).

        Raises
        ------
        BuildCancelled
            When cancellation was requested; the session has been rolled back and
            nothing was written.
        VoxelGridTooLargeError
            When the requested spacing exceeds the per-build voxel budget.
        """
        try:
            return await self._execute_impl(
                model_id,
                sections,
                grid_spacing_m=grid_spacing_m,
                vertical_spacing_m=vertical_spacing_m,
                force=force,
                gapless_2d=gapless_2d,
                should_cancel=should_cancel,
                progress=progress,
            )
        except BuildCancelled:
            # Guarantee "nothing written for a cancelled build" regardless of how
            # far the build got: a geotech heal or a flush may already be pending
            # on the session, so roll the whole transaction back before the
            # background coroutine turns this into a ``build_cancelled`` event.
            await self._session.rollback()
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — build cancelled; "
                "rolled back, nothing was written"
            )
            raise

    async def _execute_impl(
        self,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        *,
        grid_spacing_m: float,
        vertical_spacing_m: float | None = None,
        force: bool = False,
        gapless_2d: list[dict[str, Any]] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        progress: Callable[[str, int, int], None] | None = None,
    ) -> LithoSolidsOutcome:
        """Label a voxel grid from ``sections`` and upsert the watertight solids.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to (re)build.
        sections : list of SectionPartitionInput
            The validated 2-D section partitions (the build payload, the source
            of truth for body identity + geometry).
        grid_spacing_m : float
            The HORIZONTAL (X/Y) voxel edge length in metres; also the Z edge
            length when ``vertical_spacing_m`` is ``None`` (the cubic case).  Must
            be positive.
        vertical_spacing_m : float or None, optional
            The Z (elevation) voxel edge length in metres.  ``None`` (the default)
            → a cubic grid (Z uses ``grid_spacing_m``), byte-identical to the
            pre-anisotropy build.  When set, the grid is anisotropic: X/Y step at
            ``grid_spacing_m``, Z at ``vertical_spacing_m`` — a fine Z over a
            coarse X/Y resolves thin geology layers without exploding the X/Y
            voxel count.
        force : bool, default ``False``
            When ``True``, skip the model-level checksum short-circuit and always
            rebuild.  The on-click "Build 3-D model" path passes this so an
            explicit Build always reflects the current builder code.
        gapless_2d : list of dict, or None, optional
            The renderer's clause 1-4 findings for the seven-clause gapless gate
            (already-validated ``GaplessClauseInputSchema`` dicts, converted by
            the router — the application layer never sees the Pydantic schema).
            ``None`` (the default) means the caller sent none — a lithology
            build runs no packing fill and has nothing to send, and a client
            older than the gate sends nothing at all; either way the assembled
            report answers honestly with ``not-evaluated`` for clauses 1-4
            rather than a fabricated pass.
        should_cancel : callable of () -> bool, or None, optional
            Cooperative-cancel predicate (see :meth:`execute`); ``None`` never
            cancels. Checked at each CPU-phase boundary and, threaded into the
            labeller, once per voxel column.
        progress : callable of (phase, done, total) -> None, or None, optional
            Progress reporter (see :meth:`execute`); ``None`` reports nothing.

        Returns
        -------
        LithoSolidsOutcome
            Per-phase counts (``marked_test_ids`` is always empty — the voxel
            path drops no tests) plus ``gapless_report``, the seven-clause gate
            assembled for this build (``None`` only on the degenerate "nothing
            built" paths, which never label a grid to report on).

        Notes
        -----
        Unbuildable inputs (no sections, or a footprint that cannot frame a hull
        — <3 unique non-collinear columns) clear the cache and return a zero
        outcome rather than raising: an empty / degenerate model is a valid
        "nothing to build" state, not an error.

        This use case does NOT run ``ResolveLithoInstances`` — the payload's
        ``body_id`` values already reflect the resolved frontend state.
        """
        self.info(
            f"BuildVoxelLithoModel: model={model_id} sections={len(sections)} "
            f"grid_spacing={grid_spacing_m} vertical_spacing={vertical_spacing_m} force={force} "
            f"gapless_2d_clauses={len(gapless_2d) if gapless_2d else 0}"
        )
        t_total = time.perf_counter()

        # --- Heal the geotech parent links from the FINAL litho geometry -------
        # Owner 2026-09-01: the parent links (a band's covering litho band, a
        # body's litho parent) must be derived at the LAST whole-model operation,
        # not at Divide/subdivide (which precede the final edits) or the recompute
        # (which runs before the litho/geotech builds). The geotech Build is that
        # operation — and because it deliberately does NOT run the resolver (the
        # payload's body_id already reflects the resolved state), it must heal
        # both links itself:
        #   1. re-derive every accepted band's parent_litho_layer_id (midpoint
        #      rule, overwrite, idempotent), then
        #   2. re-stamp every body's parent_litho_body_id from the just-re-derived
        #      band FKs (shallowest covered member), mirroring the resolver's
        #      step-5b/6 rule without running it.
        # Both are geotech-only no-ops on a litho model. Done at the TOP, before
        # any early return, so a heal is never lost on the "nothing to build" or
        # checksum-skip paths — every geotech Build press leaves the links current.
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is not None and model.kind == MODEL_KIND_GEOTECHNICAL:
            heal_repo = LithoLayerRepository(self._session)
            await heal_repo.rederive_geotech_parent_litho_layers(model_id)
            await heal_repo.restamp_geotech_parent_litho_bodies(model_id)

        # --- Manual bed-override cap (owner ruling 2026-09-07 — the canal cut-out)
        # Inside a bed-override polygon nothing lithological is built above the
        # dredged bed (the DEM over the water carries the water surface, and the
        # section fill tops out at the collar — neither is the bed).  So the
        # labeller voids every voxel above the bed level there.  Loaded ONCE here,
        # for both the checksum (an override edit must bust the cache) and the
        # ``label_voxels`` call below.  A project with no override yields an empty
        # list → ``bed_top_at`` stays ``None`` → the build is byte-identical, and
        # the checksum is byte-stable, so nothing without a canal is disturbed.
        bed_overrides: list[BedOverridePolygon] = (
            await load_bed_override_polygons(self._session, model.app_project_id)
            if model is not None
            else []
        )
        bed_top_at: Callable[[float, float], float | None] | None = None
        if bed_overrides:

            def _bed_top_at(x: float, y: float) -> float | None:
                """Bed level inside a polygon, ``None`` outside every one of them.

                The cap is restricted to inside-polygon cells: ``bed_level_at``
                returns ``None`` outside every polygon, so a column beyond the
                canal is left exactly as the labeller drew it.
                """
                return bed_level_at(bed_overrides, x, y)

            bed_top_at = _bed_top_at

        if not sections:
            self.warning(f"BuildVoxelLithoModel: model={model_id} — no sections; clearing cache")
            return await self._handle_empty(
                model_id,
                reason=(
                    "no cross-section carried a 2-D partition, so there was nothing to "
                    "build from — draw or fill a section first"
                ),
                gapless_report=self._assemble_gapless(model_id, gapless_2d),
            )

        # --- Honor each investigation's OWN observed log at its true location --
        # The section blend at a borehole's true (x, y) can disagree with the
        # borehole's own log (it feeds a section at its projected foot, not its
        # true map position).  Load the resolved DB picks and build the per-
        # investigation observed columns so ``label_voxels`` labels those columns
        # from the log itself (within its observed depth range).  ``load_body_picks``
        # already reflects the resolver, so we do NOT run ResolveLithoInstances.
        #
        # Loaded BEFORE the footprint because the drilled positions are a hull
        # input: the footprint must reach every investigation the build honors.
        picks = await LithoLayerRepository(self._session).load_body_picks(model_id)
        investigation_columns = _investigation_columns_from_picks(picks)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — honoring "
            f"{len(investigation_columns)} investigation column(s) from "
            f"{len(picks)} pick(s)"
        )
        self._warn_sub_voxel_investigations(model_id, investigation_columns, grid_spacing_m)

        # The payload AS RECEIVED, before any transform.  The generation row
        # stores THIS, not an intermediate: the alias map and the true-position
        # re-seat are both derived from it, whereas the projected-foot column
        # positions it carries are NOT recoverable afterwards — and the footprint
        # hull needs them (it unions the columns as-drawn with the true
        # positions, so it can only grow).  Storing the re-seated payload instead
        # made a reproduction come back 21 grid cells narrower.
        sections_received = sections

        # --- Rank the blend in TRUE map space, not projected-foot space --------
        # The payload's column world positions are the frontend's CANONICAL ones
        # ("the projected position on the densest section"), which on the dev
        # model sit a MEDIAN OF 11 m — max 65 m — from where the investigation
        # actually is.  Everything else here works in true space: the grid, the
        # footprint, the honored columns.  So the labeller was choosing which
        # sections are nearest a voxel in one coordinate space and placing the
        # material in another (docs/debt.md #247 — the twin of the footprint bug
        # fixed in d3b6c1fd0..99c6e023f).  Owner ruling 2026-07-29: rank by true
        # positions.  This re-measures only; along_m, the section line and every
        # region polygon are untouched.
        # Geometry only: the footprint hull below reads columns, never body ids.
        sections_as_drawn = sections
        sections, columns_moved, max_shift_m = apply_true_column_positions(
            sections, investigation_columns
        )
        if columns_moved:
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — re-seated {columns_moved} section "
                f"column(s) onto their true map positions (max shift {max_shift_m:.2f} m)"
            )

        # --- Stage 2: one body identity across the whole fence -----------------
        # The frontend's per-section merge picks its representative PER SECTION,
        # so the same physical unit arrives under a different body_id on every
        # section it appears on.  ``_blend_stacks`` matches sections BY body_id
        # and pinches an unmatched body to ~nothing at the midline, which invents
        # lithology between columns (docs/debt.md #244).
        #
        # The map is planned ONCE here and applied to BOTH the section regions
        # AND the honored investigation intervals.  Applying it to only one of
        # them — as the first, frontend-only version of this did — gives the same
        # material two identities: the merged one in blended space and the
        # original resolver one at every honored column.
        #
        # This creates no correlation edge and writes nothing: the user's ties
        # stay exactly the user's ties, only the ids are aliased.
        #
        # Planned on the RE-SEATED sections, after ``apply_true_column_positions``
        # above.  The planner's fence-crossing test intersects consecutive
        # columns' world positions, and on the payload as drawn those are the
        # projected feet (a median of 11 m, max 65 m, from the true location on
        # the dev model): a real crossing could be missed, so one body pinched
        # mid-gap, or a crossing that exists only in projected space could fuse
        # two independent bodies into one solid (cloud review 2026-09-05).  The
        # as-drawn copy kept for the footprint hull is geometry only: no consumer
        # reads a body id from it, so it stays unaliased.
        # Packing-class identity (debt #278): fuse the twin formation rows one
        # NAD class carries across a geological boundary, so a body spanning
        # that boundary keeps ONE id (owner 2026-08-21, "yes one mass one
        # body"). Inert on a litho model — its rows carry no NAD class, so the
        # key is the identity function and the alias plan is byte-identical.
        identity_key_of = await self._packing_class_key(model_id)
        aliases = plan_body_aliases(sections, identity_key_of)
        merged_away = sum(1 for src, dst in aliases.items() if src != dst)
        if merged_away:
            sections = apply_body_aliases(sections, aliases)
            investigation_columns = _apply_aliases_to_columns(investigation_columns, aliases)
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — cross-section body merge "
                f"aliased {merged_away} of {len(aliases)} body id(s) "
                f"({len(aliases) - merged_away} component(s) remain)"
            )
        else:
            self.debug(
                f"BuildVoxelLithoModel: model={model_id} — cross-section body merge "
                f"found nothing to alias across {len(aliases)} body id(s)"
            )

        # --- Phase 1: domain footprint from the feet + the drilled positions ---
        # Built from the columns AS DRAWN plus the investigations' TRUE map
        # positions, so the hull is the union of both and can only be larger than
        # either.  The footprint is a coverage gate, not geometry: being generous
        # is safe (the labeller still voids any column no section reaches), while
        # shrinking it would re-open the uncovered-column bug the footprint fix
        # closed.
        try:
            with phase_timer(self, "BuildVoxelLithoModel phase-1 domain"):
                domain = build_domain_from_sections(
                    sections_as_drawn,
                    investigation_positions=tuple(
                        (c.investigation_id, c.world_x, c.world_y) for c in investigation_columns
                    ),
                )
        except ValueError as err:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} domain unbuildable — {err}; "
                "clearing cache (need ≥3 non-collinear columns)"
            )
            return await self._handle_empty(
                model_id,
                reason=(
                    "the investigations do not frame an area — a footprint needs at least "
                    "3 that do not sit on one line"
                ),
                gapless_report=self._assemble_gapless(model_id, gapless_2d),
            )
        self.debug(
            f"BuildVoxelLithoModel: model={model_id} — domain footprint "
            f"{len(domain.polygon)}-vertex hull"
        )
        # The footprint keeps only the largest alpha-shape ring, so a project
        # whose investigations fall into two clusters further apart than the
        # alpha distance loses the smaller cluster entirely — and the labeller's
        # footprint gate runs BEFORE its honored-investigation check, so those
        # columns get no material at all, not even their own drilled logs. That
        # must never pass as a complete build: say it, at WARNING, with counts
        # and names. (The fuller fix — a footprint that is the UNION of every
        # outward-wound ring — is a separate change; this is the loud gate.)
        #
        # The names also ride out on the outcome. A server-side WARNING is
        # invisible in a packaged desktop build, and the engineer who clicked
        # "Build model" would otherwise get an unqualified success while N of
        # his investigations have no 3-D model at all.
        uncovered: list[str] = []
        if domain.uncovered_test_ids:
            uncovered = sorted({tid.removesuffix("#drilled") for tid in domain.uncovered_test_ids})
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — {len(uncovered)} investigation(s) "
                "fall OUTSIDE the model footprint and will have NO 3-D model: "
                f"{', '.join(uncovered)}. The data footprint fragmented (clusters further "
                "apart than the alpha distance); only the largest component is modelled."
            )

        # --- The 2-D partition is the only authority on lithology -------------
        # The builder used to load the parent geological model's surfaces and
        # treat them as HARD bands: a litho interval crossing a surface was cut
        # at it, contacts within a tolerance were snapped to it, and a band left
        # empty was back-filled from any section that reached it, at any
        # distance.  That last rule invented material where the 2-D partition
        # deliberately said nothing.
        #
        # Owner ruling 2026-07-30: "the voids below td are always filled through
        # correlations from other tests the left or right (as in fill bands) if
        # that is not the case then you leave it unkown."  The 2-D engine already
        # implements exactly that (correlate-or-gap — no substrate since the
        # 2026-07-10 revert), so the builder's job is to take the partition's
        # answer INCLUDING its voids, not to supply a second opinion.
        #
        # Measured on the dev model when this landed: of the 44 gap-sides where
        # the partition stops at a shallow column's TD, 39 carried model material
        # below it — mean 3.58 m, worst 6.70 m, imported from a section a median
        # 35 m away (max 238 m) while the section that authored "unknown" sat at
        # perpendicular distance 0.0 m.  See docs/debt.md and
        # scripts/diag_subtd_invention.py.
        #
        # This also restores A2 geo-decoupling (docs/domain-model.md) in 3-D: a
        # litho body MAY span a geological boundary.  The parent model is still
        # used everywhere else — body geo-labelling, the geotech subdivision's
        # own bounding (litho_geo_bounding.py), surfaces in the section view.
        honor_radius_m = await self._read_honor_radius_m(model_id, grid_spacing_m)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — geology-independent build, "
            f"honor_radius_m={honor_radius_m}"
        )

        # --- Early checksum short-circuit (before the expensive Phase 2/3) ----
        # The digest covers the FULL section payload + grid spacing + the honored
        # investigation columns, and the pipeline is deterministic, so a digest
        # match ⟹ identical body set — the same reasoning the strat builder
        # relies on.  Skip labelling + extraction entirely when nothing changed.
        # ``_load_existing`` is cross-method: stale strat rows carry a different
        # (strat) digest, so the ``_digest_matches_all`` set/checksum check is
        # False → no early skip → the build proceeds and orphan-sweeps them in
        # Phase 5.
        new_checksum = _partition_checksum(
            sections,
            grid_spacing_m,
            investigation_columns,
            vertical_spacing_m=vertical_spacing_m,
            honor_radius_m=honor_radius_m,
            bed_overrides=bed_overrides,
        )
        existing_by_body = await self._load_existing(model_id)
        if (
            not force
            and existing_by_body
            and all(
                meta.source_pick_checksum == new_checksum and not meta.is_stale
                for meta in existing_by_body.values()
            )
        ):
            await self._session.commit()
            skipped = len(existing_by_body)
            self.success(
                f"BuildVoxelLithoModel: model={model_id} — checksum unchanged, "
                f"skipped all {skipped} body/bodies (no labelling)"
            )
            # No grid was labelled on this path, so clauses 5-7 have nothing to
            # read — assembled here (not stored: no new generation row is
            # written on the skip path) so the caller still gets an honest
            # report rather than silently carrying the PREVIOUS build's verdict
            # forward as if it applied to this one.
            skip_report = self._assemble_gapless(model_id, gapless_2d)
            return LithoSolidsOutcome(
                bodies_considered=skipped,
                bodies_built=0,
                bodies_skipped_checksum=skipped,
                bodies_flagged=0,
                orphans_deleted=0,
                marked_test_ids=[],
                uncovered_test_ids=uncovered,
                gapless_report=skip_report,
            )

        # --- Phases 2 + 3: the CPU work, OFF THE EVENT LOOP -------------------
        # The desktop app runs exactly one uvicorn worker, and this route is
        # ``async def``, so a synchronous call here holds the loop for the whole
        # build: every other request the engineer makes meanwhile — drag a contact,
        # accept a suggestion, Ctrl+S — queues behind it and the app looks hung,
        # with no spinner and no error. Both phases are pure functions over
        # in-memory value objects and touch no session, so a thread is safe; the DB
        # work stays on the loop. A thread rather than a process: the numpy-heavy
        # mesher releases the GIL freely, while a separate process would re-JIT the
        # Numba kernel per worker and copy the whole label grid back across the
        # boundary. Measured event-loop responsiveness and the phase split are in
        # docs/benchmarks-journal.md → "Build responsiveness (2026-08-03)".
        # ``_BUILD_CPU_LOCK`` keeps the grid budget a per-process bound (see its
        # docstring): a second Build waits here rather than competing for memory.
        # Relay the labeller's per-column ticks onto the outer channel under the
        # "label" phase — passed only when someone consumes progress so the pure
        # section-blend path stays free of a per-column callback otherwise.
        label_progress: Callable[[int, int], None] | None = (
            (lambda done, total: self._emit_progress(progress, "label", done, total))
            if progress is not None
            else None
        )
        async with _BUILD_CPU_LOCK:
            self._raise_if_cancelled(should_cancel)
            self._emit_progress(progress, "label", 0, 0)
            try:
                with phase_timer(self, "BuildVoxelLithoModel phase-2 label_voxels"):
                    grid = await asyncio.to_thread(
                        label_voxels,
                        domain,
                        grid_spacing_m,
                        sections,
                        vertical_spacing_m=vertical_spacing_m,
                        investigation_columns=investigation_columns,
                        honor_radius_m=honor_radius_m,
                        bed_top_at=bed_top_at,
                        should_cancel=should_cancel,
                        progress=label_progress,
                    )
            except ValueError as err:
                self.warning(
                    f"BuildVoxelLithoModel: model={model_id} label_voxels failed — {err}; "
                    "clearing cache (no elevation range to grid over)"
                )
                return await self._handle_empty(
                    model_id,
                    uncovered_test_ids=uncovered,
                    reason=f"the 3-D grid could not be built — {err}",
                    gapless_report=self._assemble_gapless(model_id, gapless_2d),
                )
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — labelled "
                f"{len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} grid, "
                f"{len(grid.body_id_by_index)} body slots"
            )
            self._report_label_anomalies(model_id, grid.report)

            # Clause 7 of the gapless gate: per-section swept-area reconciliation
            # between the 2-D fill and the labelled grid.  Reads the RE-SEATED
            # ``sections`` — the exact list ``label_voxels`` was just called
            # with, after ``apply_true_column_positions`` — not the payload as
            # drawn, so the sections agree with the grid they are being checked
            # against.  Inside the same lock as phase 2: it reads the (large)
            # ``grid.labels`` array the budget is sized on.
            #
            # CAUGHT, unlike every other phase here: this one is a DIAGNOSTIC of
            # the model the build just made, and a diagnostic that can destroy
            # the artefact it measures is worse than no diagnostic at all — the
            # engineer would lose a good model to a bug in the thing checking
            # it. The gate's contract is that it fails the REPORT, never the
            # build (see ``gapless_clause_constants``), and this is where that
            # is actually enforced rather than merely stated.
            self._raise_if_cancelled(should_cancel)
            self._emit_progress(progress, "reconcile", 0, 1)
            reconciliations: tuple[SectionReconciliation, ...] | None = None
            reconciliation_error: str | None = None
            try:
                with phase_timer(self, "BuildVoxelLithoModel phase-2b section_reconciliation"):
                    reconciliations = await asyncio.to_thread(
                        reconcile_sections,
                        sections,
                        domain,
                        grid.gx,
                        grid.gy,
                        grid.labels,
                        grid_spacing_m,
                        grid_spacing_m if vertical_spacing_m is None else vertical_spacing_m,
                    )
            except Exception as err:
                reconciliation_error = (
                    f"the 2-D↔3-D comparison could not be completed — {type(err).__name__}: {err}"
                )
                self.exception(
                    f"BuildVoxelLithoModel: model={model_id} — clause 7 "
                    f"(section reconciliation) raised {type(err).__name__}: {err}; "
                    "the build continues and the report says clause 7 was not checked"
                )

            # Assembled HERE rather than after the mesh filter: it depends on the
            # label report and the reconciliation, not on the meshes, and running
            # it now is what lets the "labelling produced no body" path below
            # carry a verdict too — the case where the stored model is CLEARED is
            # the one where the engineer most needs to read what was checked.
            gapless_report = self._assemble_gapless(
                model_id,
                gapless_2d,
                label_report=grid.report,
                reconciliations=reconciliations,
                reconciliation_error=reconciliation_error,
            )

            # Phase 3: extract the greedy-meshed watertight per-body solids. Inside
            # the same lock as phase 2 — it holds the label grid AND the mesher's
            # full-grid scratch arrays, the peak the budget is sized on.
            self._raise_if_cancelled(should_cancel)
            self._emit_progress(progress, "extract", 0, 1)
            try:
                with phase_timer(self, "BuildVoxelLithoModel phase-3 extract_body_solids"):
                    meshes = await asyncio.to_thread(extract_body_solids, grid)  # greedy=True
            except Exception as err:
                self.exception(
                    f"BuildVoxelLithoModel: model={model_id} extract_body_solids raised "
                    f"{type(err).__name__} — {err}"
                )
                raise
        # An empty body slot (no voxel labelled with it) yields no mesh — drop it.
        meshes = [m for m in meshes if m.vertices and m.triangles]
        self.info(f"BuildVoxelLithoModel: model={model_id} — extracted {len(meshes)} body solid(s)")

        if not meshes:
            # The labelling produced no non-empty body (e.g. every voxel void).
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — labelling produced no body; "
                "clearing cache"
            )
            # Reuse the already-loaded existing rows — ``_handle_empty`` only
            # reads the keys, so no second read is needed for the empty path.
            return await self._handle_empty(
                model_id,
                existing_by_body=existing_by_body,
                uncovered_test_ids=uncovered,
                reason=(
                    "the labelling produced no body at all — every voxel came out empty, "
                    "so nothing could be meshed"
                ),
                # The grid WAS labelled here, so this verdict is the real one —
                # and clause 5 will be shouting, which is exactly the finding
                # that explains why nothing could be meshed.
                gapless_report=gapless_report,
            )

        wanted_storage_ids = {str(storage_body_id(m.body_id)) for m in meshes}
        bodies_considered = len(wanted_storage_ids)

        # --- Phase 4: provenance + upsert + orphan-delete + commit ------------
        # The generation row is written FIRST so every mesh can point at it in
        # the same transaction.  It records what the build was made from and
        # with, which nothing else does: the payload lived only in the frontend,
        # the settings only in the project's view-state at the moment the build
        # ran, and the derived body identity only in memory.  Without it no
        # diagnostic can reproduce a build after the fact (docs/debt.md #252).
        # Last cancel gate before anything is written: past this point the
        # transaction is committed, so a later cancel would have to roll back a
        # completed build. Cancelling here still leaves the model as it was.
        self._raise_if_cancelled(should_cancel)
        self._emit_progress(progress, "persist", 0, 1)
        generation_id = uuid7()
        with phase_timer(self, "BuildVoxelLithoModel phase-4 upsert"):
            await self._write_generation(
                generation_id=generation_id,
                model_id=model_id,
                sections=sections_received,
                grid=grid,
                aliases=aliases,
                checksum=new_checksum,
                horizontal_spacing_m=grid_spacing_m,
                vertical_spacing_m=vertical_spacing_m,
                honor_radius_m=honor_radius_m,
                meshes=meshes,
                started_at=t_total,
                gapless_report=gapless_report,
            )
            rows = self._mesh_rows(meshes, model_id, new_checksum)
            for row in rows:
                row["generation_id"] = generation_id
            bodies_built = len(rows)
            chunks_written = await self._batch_upsert(rows)
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — "
                f"upserted {bodies_built} mesh(es) in {chunks_written} chunk(s)"
            )
            orphans_deleted = await self._delete_orphans(
                model_id, existing_by_body, wanted_storage_ids
            )
            await self._session.commit()

        total_tris = sum(len(m.triangles) for m in meshes)
        total_verts = sum(len(m.vertices) for m in meshes)
        total_elapsed = time.perf_counter() - t_total
        # bodies_flagged is structurally zero on the voxel path: every labelled
        # voxel belongs to a real body (the label grid is a partition by
        # construction), so no empty placeholder rows are written; the field
        # stays for API-shape stability (the retired strat path could flag).
        self.success(
            f"BuildVoxelLithoModel: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"bodies_flagged=0 "
            f"orphans_deleted={orphans_deleted} "
            f"tris={total_tris:,} verts={total_verts:,} "
            f"total=[{total_elapsed:.1f}s]"
        )
        return LithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
            uncovered_test_ids=uncovered,
            gapless_report=gapless_report,
        )

    def _assemble_gapless(
        self,
        model_id: UUID,
        gapless_2d: list[dict[str, Any]] | None,
        *,
        label_report: LabelReport | None = None,
        reconciliations: tuple[SectionReconciliation, ...] | None = None,
        reconciliation_error: str | None = None,
    ) -> dict[str, Any] | None:
        """Assemble the seven-clause gate, degrading rather than failing the build.

        The gate exists to say whether the built model keeps the owner's
        gapless guarantee.  It is a report about the artefact, so it must never
        be able to prevent the artefact: a raise anywhere in the assembly is
        logged in full and answered with ``None`` (the client then shows "no
        verdict", which is honest), while the solids are written exactly as they
        would have been.

        Parameters
        ----------
        model_id : UUID
            The model being built — for the log lines.
        gapless_2d : list of dict, or None
            The renderer's clause 1-4 findings; ``None`` when it sent none.
        label_report : LabelReport or None, optional
            The labeller's counters, or ``None`` when no grid was labelled.
        reconciliations : tuple of SectionReconciliation, or None, optional
            The clause-7 comparison, or ``None`` when it did not run.
        reconciliation_error : str or None, optional
            Why clause 7 did not run, when a grid WAS labelled.

        Returns
        -------
        dict or None
            The report, or ``None`` when the assembly itself failed.
        """
        try:
            return GaplessBuildReportAssembler().assemble(
                model_id,
                gapless_2d=gapless_2d,
                label_report=label_report,
                reconciliations=reconciliations,
                reconciliation_error=reconciliation_error,
            )
        except Exception as err:
            self.exception(
                f"BuildVoxelLithoModel: model={model_id} — the gapless-gate assembly raised "
                f"{type(err).__name__}: {err}; the build is unaffected and carries no verdict"
            )
            return None

    def _report_label_anomalies(self, model_id: UUID, report: LabelReport) -> None:
        """Say out loud what the labeller had to paper over.

        ``label_voxels`` is a pure domain function with no logger of its own, so
        every structural anomaly it meets rides out on its report and is voiced
        here.  Four of them are otherwise invisible: a closed void looks like a
        contact, a truncated log looks like a shallow one, a rescued column looks
        like any other column, and a void column looks like ground outside the
        model.  The owner's standing ruling is that the model is gapless and a hole
        is never silent — this is where that is honoured.

        Aggregate counts only, never per-column lines: the worst site alone is hit
        by 2 415 grid columns on the real model, and 2 415 identical WARNINGs would
        bury every other line in the build log.

        Parameters
        ----------
        model_id : UUID
            The model being built (for the log line).
        report : LabelReport
            The labeller's anomaly counters.
        """
        if report.beyond_void_columns:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — {report.beyond_void_columns} "
                "voxel column(s) INSIDE the footprint could not be filled by any "
                "section; they are holes in the 3-D model. The partition says nothing "
                "at those positions — correlate across the gap, or extend a section."
            )
        if report.layout_closed_voids:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — the two-section blend closed "
                f"an interior 2-D void on {report.layout_closed_voids} column(s); worst "
                f"{report.layout_closed_worst_m * 1000:.1f} mm at "
                f"{report.layout_closed_worst_site}. Everything below such a void is laid "
                "out that much shallower than the partition drew it (docs/debt.md #268)."
            )
        if report.hairline_gaps_over_limit:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — "
                f"{report.hairline_gaps_over_limit} column stack(s) carry an interior gap "
                f"over {HAIRLINE_LIMIT_M * 1000:.0f} mm (worst "
                f"{report.hairline_worst_m * 1000:.1f} mm); too tall to be the 2-D "
                "engine's millimetre snapping, so those voxels are genuinely unlabelled."
            )
        for investigation_id, metres in report.logs_below_grid_floor:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — {investigation_id} logs "
                f"{metres:.2f} m below the grid floor and is TRUNCATED there. The grid's "
                "elevation range comes from the section polygons, so a log deeper than "
                "every section has no voxel to land in."
            )
        if report.beyond_fallthrough_columns or report.projection_tie_rescues:
            self.debug(
                f"BuildVoxelLithoModel: model={model_id} — "
                f"{report.beyond_fallthrough_columns} column(s) beyond the sections were "
                f"filled by a section that is not the nearest, and "
                f"{report.projection_tie_rescues} equidistant gap contest(s) went to the "
                "gap carrying material"
            )

    def _warn_sub_voxel_investigations(
        self,
        model_id: UUID,
        investigation_columns: tuple[InvestigationColumn, ...],
        grid_spacing_m: float,
    ) -> None:
        """Warn about investigation pairs too close to both be honored.

        ``label_voxels`` honors at most ONE investigation per grid column, so two
        investigations less than one horizontal voxel apart contend for the same
        column and only one of their logs survives — the other's drilled log is
        silently replaced by its neighbour's at its own map position.  That is a
        real fidelity loss and must never pass unlogged, so every contending pair
        is named at WARNING with its separation.

        The test is grid-PHASE independent (a pair closer than one voxel may or
        may not land in the same cell depending on where the grid origin falls),
        so this over-reports rather than under-reports: a flagged pair is at risk,
        a pair farther apart than one voxel never is.

        Parameters
        ----------
        model_id : UUID
            The model being built (for the log line).
        investigation_columns : tuple of InvestigationColumn
            The honored per-investigation observed columns.
        grid_spacing_m : float
            The HORIZONTAL voxel edge length; the contention radius.
        """
        # Spatial hash at the contention radius: two investigations within one
        # voxel of each other necessarily fall in the same or an adjacent bucket,
        # so each investigation only compares against its 3x3 bucket
        # neighbourhood.  A project with thousands of investigations would make
        # the all-pairs walk quadratic for a check that finds a handful of pairs.
        buckets: dict[tuple[int, int], list[InvestigationColumn]] = defaultdict(list)
        for col in investigation_columns:
            buckets[
                (int(col.world_x // grid_spacing_m), int(col.world_y // grid_spacing_m))
            ].append(col)

        contending: list[tuple[str, str, float]] = []
        for (bi, bj), members in buckets.items():
            for col in members:
                for di in (0, 1):
                    for dj in (-1, 0, 1):
                        if di == 0 and dj < 0:
                            continue  # the mirrored half of the neighbourhood
                        for other in buckets.get((bi + di, bj + dj), ()):
                            # Within one bucket, compare each pair once only.
                            if (
                                di == 0
                                and dj == 0
                                and other.investigation_id <= col.investigation_id
                            ):
                                continue
                            dx = col.world_x - other.world_x
                            dy = col.world_y - other.world_y
                            separation = (dx * dx + dy * dy) ** 0.5
                            if separation < grid_spacing_m:
                                contending.append(
                                    (col.investigation_id, other.investigation_id, separation)
                                )
        contending.sort()
        if not contending:
            return
        self.warning(
            f"BuildVoxelLithoModel: model={model_id} — {len(contending)} investigation pair(s) "
            f"closer than the {grid_spacing_m} m horizontal voxel; only ONE of each pair can be "
            f"honored, the other takes its neighbour's log at its own position"
        )
        for inv_a, inv_b, separation in contending:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — sub-voxel pair "
                f"{inv_a} / {inv_b} separated by {separation:.2f} m"
            )

    async def _handle_empty(
        self,
        model_id: UUID,
        existing_by_body: dict[str, _SolidMeta] | None = None,
        *,
        uncovered_test_ids: list[str] | None = None,
        reason: str,
        gapless_report: dict[str, Any] | None = None,
    ) -> LithoSolidsOutcome:
        """Clear every solid row for the model and return a zero outcome.

        Used when the payload is empty / degenerate (no sections, an unbuildable
        footprint, or a labelling with no body).  An empty model is a valid
        "nothing to build" state, so the cache is emptied (orphan-deleting every
        stored row) rather than raising.

        Parameters
        ----------
        model_id : UUID
            The model whose solids are cleared.
        existing_by_body : dict[str, _SolidMeta] | None
            Already-loaded existing solid rows keyed by body id (the no-mesh
            path has them in hand from the checksum check) — passing them
            skips a second ``_load_existing`` round-trip. ``None`` (default)
            loads them here.
        uncovered_test_ids : list[str] | None
            Investigations the footprint does not cover, when the footprint got
            far enough to be known. Carried through so an empty build still
            tells the engineer WHY it is empty for those columns. ``None``
            (default) for the call sites that fail before the domain exists.
        reason : str
            Why this build is empty, in the engineer's own terms. Required, not
            defaulted: this path DELETES the stored 3-D model, and its counts are
            indistinguishable from a happy build of zero bodies, so a call site
            that cannot say why must not compile rather than silently produce a
            green "Built 0 bodies" over an erased model.
        gapless_report : dict or None, optional
            The seven-clause gate for this build.  An erased model is the case
            where the engineer most needs to read what WAS checked, so every
            call site supplies one: the pre-grid sites assemble a grid-less
            report (clauses 5-7 ``not-evaluated``), and the no-mesh site passes
            the one already assembled from the labelled grid.

        Returns
        -------
        LithoSolidsOutcome
            All counts zero except ``orphans_deleted``, carrying ``reason`` as
            ``empty_reason`` and ``gapless_report`` as given.
        """
        if existing_by_body is None:
            existing_by_body = await self._load_existing(model_id)
        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, set())
        await self._session.commit()
        # WARNING, not SUCCESS: nothing was built and the stored solids are gone.
        self.warning(
            f"BuildVoxelLithoModel: model={model_id} — built NOTHING ({reason}); "
            f"the stored 3-D model was cleared, {orphans_deleted} orphan(s) deleted"
        )
        return LithoSolidsOutcome(
            bodies_considered=0,
            bodies_built=0,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
            uncovered_test_ids=uncovered_test_ids or [],
            empty_reason=reason,
            gapless_report=gapless_report,
        )

    #: Identifies the builder behind a stored generation.  Bump when a change
    #: alters the labelling, so a mesh built by an older builder is recognisable
    #: after the algorithm moves on.  ``voxel-2026.07.30`` dropped the geological
    #: band bounding, so any generation stamped earlier reproduces differently by
    #: design — see ``--reproduce`` in ``scripts/diag_build_generations.py``.
    _BUILDER_VERSION = "voxel-2026.07.30"

    #: How many generations to keep per model.  Each row carries the full
    #: section payload (hundreds of kB), so an unbounded history would grow by
    #: that much on every dogfeed click.  Enough to A/B a change against the
    #: builds either side of it.
    _KEEP_GENERATIONS = 10

    async def _write_generation(
        self,
        *,
        generation_id: UUID,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        grid: object,
        aliases: dict[str, str],
        checksum: bytes,
        horizontal_spacing_m: float,
        vertical_spacing_m: float | None,
        honor_radius_m: float,
        meshes: list[LithoBodyMesh],
        started_at: float,
        gapless_report: dict[str, Any] | None = None,
    ) -> None:
        """Record what this build was made from and with.

        Writes one :class:`LithoBuildGenerationOrm` row carrying the exact
        section payload, every setting that changes the output, the grid geometry
        (the ORIGIN matters as much as the spacing — which cell an investigation
        lands in depends on grid phase), the parent geo digest, and the derived
        body-alias map.

        The alias map is DERIVED build data with provenance.  It records which
        source bodies were merged into one component and must never be read back
        as a user correlation.

        Older generations beyond :attr:`_KEEP_GENERATIONS` are pruned in the same
        transaction so the payload history stays bounded.

        Parameters
        ----------
        generation_id : UUID
            Pre-allocated id, so the mesh rows can reference it in one transaction.
        model_id : UUID
            The model built.
        sections : list of SectionPartitionInput
            The payload as labelled (post-alias, post-re-seat).
        grid : LabelGrid
            The labelled grid, for its axes.
        aliases : dict of str to str
            ``source_body_id -> derived component id``.
        checksum : bytes
            The model-level digest stamped on every solid row.
        horizontal_spacing_m, vertical_spacing_m, honor_radius_m : float
            The settings the build ran with.
        meshes : list of LithoBodyMesh
            The built meshes, for the outcome counts.
        started_at : float
            ``time.perf_counter()`` at the start of the build.
        gapless_report : dict or None, optional
            The seven-clause gapless-gate report assembled for this build (a
            plain JSON-ready dict — see
            :class:`~groundmodel.application.gapless_build_report_assembler.GaplessBuildReportAssembler`).
            ``None`` only for a caller that has none to give.
        """
        gx, gy, gz = grid.gx, grid.gy, grid.gz  # type: ignore[attr-defined]
        payload = _generation_payload(sections)
        self._session.add(
            LithoBuildGenerationOrm(
                id=generation_id,
                model_id=model_id,
                builder_version=self._BUILDER_VERSION,
                horizontal_spacing_m=float(horizontal_spacing_m),
                vertical_spacing_m=float(
                    vertical_spacing_m if vertical_spacing_m is not None else horizontal_spacing_m
                ),
                honor_radius_m=float(honor_radius_m),
                # Vestigial since the geology decoupling: the builder no longer
                # snaps litho contacts to anything, so there is no tolerance to
                # record.  The column is NOT NULL, so 0.0 states plainly that no
                # snapping happened rather than recording a setting that had no
                # effect on this build.
                litho_snap_tolerance_m=0.0,
                grid_nx=len(gx),
                grid_ny=len(gy),
                grid_nz=len(gz),
                grid_origin_x=float(gx[0]),
                grid_origin_y=float(gy[0]),
                grid_origin_z=float(gz[0]),
                payload=payload,
                payload_checksum=checksum,
                # Always NULL since the geology decoupling — the build does not
                # read geological surfaces, so there is no surface state to
                # attribute its output to.  The column is nullable and has no
                # reader anywhere; it is a drop candidate for the deliberate
                # schema-drift migration deferred under docs/debt.md #252.
                geo_surface_digest=None,
                body_aliases=dict(aliases),
                sections_count=len(sections),
                bodies_built=len(meshes),
                triangles=sum(len(m.triangles) for m in meshes),
                duration_s=time.perf_counter() - started_at,
                gapless_report=gapless_report,
            )
        )
        await self._session.flush()

        keep = (
            select(LithoBuildGenerationOrm.id)
            .where(LithoBuildGenerationOrm.model_id == model_id)
            .order_by(LithoBuildGenerationOrm.created_at.desc())
            .limit(self._KEEP_GENERATIONS)
        )
        keep_ids = [row[0] for row in (await self._session.execute(keep)).all()]
        if keep_ids:
            await self._session.execute(
                delete(LithoBuildGenerationOrm).where(
                    LithoBuildGenerationOrm.model_id == model_id,
                    LithoBuildGenerationOrm.id.not_in(keep_ids),
                )
            )
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — generation {generation_id} recorded "
            f"({len(sections)} section(s), {len(aliases)} alias(es), "
            f"{self._BUILDER_VERSION})"
        )

    async def _read_honor_radius_m(self, model_id: UUID, grid_spacing_m: float) -> float:
        """Read the honored-column radius, defaulting to one horizontal voxel.

        Owner directive 2026-07-29: *"widen honor to the drawn column width"*.  The
        drawn width is screen-space (``BARE_COLUMN_WIDTH_PX = 14``, scaled by
        zoom), so there is no metre value to copy; the honored footprint is a real
        radius instead, defaulting to one horizontal voxel so an investigation owns
        its own cell and the four orthogonal neighbours rather than a single cell
        chosen by grid phase (docs/debt.md #249).

        ``0`` is a legitimate setting — it restores nearest-cell-only honoring — so
        the guard admits it, unlike the snap-tolerance reader which rejects
        non-positive values.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model (to find its project).
        grid_spacing_m : float
            The horizontal voxel spacing, used as the default radius.

        Returns
        -------
        float
            The configured radius in metres, or ``grid_spacing_m``.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return grid_spacing_m
        view_state = await load_project_view_state(self._session, model.app_project_id)
        radius = read_view_state_float(
            view_state,
            "litho_segmenter",
            "voxel_honor_radius_m",
            grid_spacing_m,
        )
        return radius if radius >= 0.0 else grid_spacing_m

    async def _packing_class_key(self, model_id: UUID) -> Callable[[str], str]:
        """Build the packing-class identity function for this model's project.

        The cross-section body merge fuses two regions only when their formation
        identity agrees. On a geotech model the same packing class exists under
        several formation ROW ids (one per NAD class × litho parent × geological
        parent), so the merge must compare the CLASS to keep a body whole across
        a geological boundary (debt #278; owner 2026-08-21, "yes one mass one
        body"). This resolves the model's project, then delegates to the shared
        :func:`~groundmodel.application.packing_class_key_loader.load_packing_class_key`
        (the same wiring the recompute uses), so the domain merge never sees an
        ORM row.

        Parameters
        ----------
        model_id : UUID
            The model being built (to find its project's formations).

        Returns
        -------
        callable of (str) -> str
            Maps a region's ``formation_id`` to its class key, or to itself when
            the row carries no NAD class — so a litho build is byte-identical. A
            model whose row has vanished (deleted mid-build) yields the identity
            function, so the alias plan degrades to the row-keyed merge rather
            than raising.
        """
        project_id = (
            await self._session.execute(
                select(GeologicalModelOrm.app_project_id).where(GeologicalModelOrm.id == model_id)
            )
        ).scalar_one_or_none()
        if project_id is None:
            return packing_class_key_of(())
        return await load_packing_class_key(self._session, project_id)
