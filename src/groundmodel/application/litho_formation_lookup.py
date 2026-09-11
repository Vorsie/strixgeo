"""Shared litho-formation find-or-create helpers.

A litho *unit* is a ``GeologicalFormation`` row keyed, geo-agnostically (A2),
by ``(litho_main_soil_code, canonical_admixture_signature)``.  Two write paths
resolve that key to a row: :class:`AcceptLithoSuggestions` (the segmenter accept
flow) and :class:`EditLithoLayerComposition` (repointing one accepted layer to a
different composition).  The find-or-create logic used to live only inside
accept; this module is the single home both share (CLAUDE.md "extract on the
second copy" — the edit use case is the second concrete use).

FIND-OR-CREATE KEY
------------------
``(litho_main_soil_code, canonical_admixture_signature)``

The *canonical admixture signature* is a deterministic string built from the
admixtures' ``canonical_key()`` pairs (the ``locally`` flag is excluded by owner
decision, so two units differing only in local/global presence share a bucket).
Signature = ``"|".join(sorted(a.canonical_key() for a in admixtures))`` — the
empty string when there are no admixtures.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.constants.litho_constants import (
    LITHOLOGY_COLORS,
    LITHOLOGY_FALLBACK_COLOR,
)


def canonical_admixture_signature(admixtures: tuple[Admixture, ...]) -> str:
    """Build the deterministic admixture signature for a litho find-or-create key.

    The ``locally`` flag is excluded intentionally (owner decision: composition
    buckets, not presence-within-layer detail) — two admixtures that differ only
    in locality hash to the same bucket.

    Parameters
    ----------
    admixtures : tuple[Admixture, ...]
        Admixtures for one lithostratigraphic unit.

    Returns
    -------
    str
        ``"|".join(sorted(a.canonical_key() for a in admixtures))``; empty string
        when the tuple is empty.
    """
    return "|".join(sorted(a.canonical_key() for a in admixtures))


def build_litho_formation_lookup(
    project_formations: list[GeologicalFormationOrm],
) -> dict[tuple[str, str], GeologicalFormationOrm]:
    """Build the find-or-create lookup from a project's formation rows.

    Keyed by ``(litho_main_soil_code, canonical_admixture_signature)`` —
    geo-agnostic under A2.  Geological (non-litho) rows are skipped.

    Under A2, two old rows that differ only in ``parent_formation_id`` collapse
    to one bucket; the later row wins (the DB is cleared on schema change
    pre-ship, so no silent collision occurs in practice).

    Parameters
    ----------
    project_formations : list[GeologicalFormationOrm]
        All formation rows for the project.

    Returns
    -------
    dict[tuple[str, str], GeologicalFormationOrm]
        The lookup keyed by ``(litho_main_soil_code, canonical_admixture_sig)``.
    """
    lookup: dict[tuple[str, str], GeologicalFormationOrm] = {}
    for f in project_formations:
        # Geotech provenance rows (the NAD units and the borehole materialiser's
        # "<unit> (geotech)" rows) INHERIT the litho soil code, so the soil code
        # alone does not tell a litho unit from its derivatives. They carry
        # ``source_litho_formation_id``; a litho row never does (the renderer's
        # ``isLithoUnit`` rule). Without this guard an Edit composition repointed
        # a litho layer to "ZAND (geotech)" (owner 2026-09-11, packaged #30).
        if getattr(f, "source_litho_formation_id", None) is not None:
            continue
        if f.litho_main_soil_code is not None:
            sig = canonical_admixture_signature(
                tuple(
                    Admixture(
                        soil_code=a["soil_code"],
                        amount=a.get("amount", ""),
                        locally=a.get("locally", False),
                    )
                    for a in (f.litho_admixtures or [])
                )
            )
            lookup[(f.litho_main_soil_code, sig)] = f
    return lookup


async def create_litho_formation(
    session: AsyncSession,
    *,
    project_id: UUID,
    litho_main_soil_code: str,
    admixtures: tuple[Admixture, ...],
    sig: str,
) -> GeologicalFormationOrm:
    """Insert a new lithostratigraphic formation (unit) row and flush.

    Under A2 all litho units are geo-agnostic: ``parent_formation_id`` is always
    ``None`` and ``parent_extrapolated`` is always ``False``.  The name is
    auto-derived from the soil code + admixture signature so the unit is
    distinguishable in the inspector; ``instance_ordinal`` stays NULL (Phase 2
    assigns).  The lithology colour is stamped at create (#145) so every
    read-side consumer sees the right colour without a presentation override.

    Parameters
    ----------
    session : AsyncSession
        Active session; the row is added + flushed (not committed).
    project_id : UUID
        Owning project.
    litho_main_soil_code : str
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
    admixtures : tuple[Admixture, ...]
        Admixtures for the unit.
    sig : str
        Canonical admixture signature (pre-computed by the caller).

    Returns
    -------
    GeologicalFormationOrm
        The freshly flushed row (id assigned, not yet committed).
    """
    admix_label = f" ({sig})" if sig else ""
    name = f"{litho_main_soil_code}{admix_label}"
    admixtures_json = [
        {"soil_code": a.soil_code, "amount": a.amount, "locally": a.locally} for a in admixtures
    ]
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        color=LITHOLOGY_COLORS.get(litho_main_soil_code, LITHOLOGY_FALLBACK_COLOR),
        display_order=0,
        parent_formation_id=None,  # A2: geo-agnostic, always None
        parent_extrapolated=False,  # A2: no TIN extrapolation
        litho_main_soil_code=litho_main_soil_code,
        litho_admixtures=admixtures_json,
        instance_ordinal=None,  # Phase 2 assigns
        instance_ordinal_locked=False,
    )
    session.add(formation)
    await session.flush()
    return formation


async def resolve_litho_formation(
    session: AsyncSession,
    *,
    project_id: UUID,
    litho_main_soil_code: str,
    admixtures: tuple[Admixture, ...],
) -> tuple[GeologicalFormationOrm, bool]:
    """Find-or-create the litho unit for a ``(soil, admixtures)`` composition.

    Loads the project's formations, builds the geo-agnostic lookup, and returns
    the matching row — creating it (auto-named, coloured) when none exists.  The
    single seam the "Edit composition" flow uses to turn e.g. an accepted SILT
    into a ZAND: resolve the ZAND unit (reuse if the project already has one,
    else create it) and repoint the layer to it.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    project_id : UUID
        Owning project (scope for the formation load + create).
    litho_main_soil_code : str
        Target BaseLithology token.
    admixtures : tuple[Admixture, ...]
        Target admixtures.

    Returns
    -------
    tuple[GeologicalFormationOrm, bool]
        ``(formation, was_created)`` — ``was_created`` is ``True`` only when a
        new row was inserted.
    """
    sig = canonical_admixture_signature(admixtures)
    lookup = build_litho_formation_lookup(
        await GeologyRepository(session).list_formations(project_id)
    )
    existing = lookup.get((litho_main_soil_code, sig))
    if existing is not None:
        return existing, False
    created = await create_litho_formation(
        session,
        project_id=project_id,
        litho_main_soil_code=litho_main_soil_code,
        admixtures=admixtures,
        sig=sig,
    )
    return created, True
