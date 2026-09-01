"""Copy one project's entire child tree onto another project id.

Backs the desktop's File → Save As.  The copy is driven from the SAME two
functions the .strix round-trip uses — ``_build_project_bundle_impl`` to
read the tree and ``_restore_project_bundle_impl`` to write it — with an
id remap in between.  That is the point of the module: a collection added
to the bundle is copied by Save As on the same day, without anyone
remembering to come back here.  The hand-written clone this replaced knew
about CPTs and boreholes only, and silently handed the engineer a copy
with no formations, no models, no contacts, no litho layers, no sections,
no bodies and no correlations.

What the copy does NOT carry across
-----------------------------------
``litho_layer.body_id`` is dropped by the restore (it is re-derived by the
resolver, exactly as on an open-from-file), so the caller runs the same
``reconcile_bodies_after_restore`` the restore endpoint runs.  The restore
also applies its size caps — an implausibly long CPT series or borehole
child array is truncated with a warning — which is the same rule that
governs the file the engineer would have written by hand.

Completeness is verified, not assumed
-------------------------------------
:func:`clone_project_children` re-reads the copy through the same build and
compares it, collection by collection and row by row, against the source.
A short copy raises :class:`BundleCloneIncompleteError` rather than being
returned: a Save As that quietly loses the interpretation is worse than
one that fails, because the app adopts the copy immediately.

Row counting only sees rows that carry a UUID ``id``.  ``cpt_series`` does not
(its primary key is ``cpt_id``), so the depth / qc / fs arrays are compared
structurally instead — per CPT, sample count against sample count.  Without
that, a copy that carried every CPT row and dropped every series would report
``cpts 1/1`` and pass.  The solids are compared by a database ``count(*)``: the
verification bundle is built WITHOUT them, because re-serialising megabytes of
vertex/triangle arrays to learn how many rows there are is the most expensive
thing this verb would otherwise do.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_build import _build_project_bundle_impl
from .bundle_collections import (
    BUNDLE_COLLECTION_KEYS,
    BUNDLE_RESTORE_KWARGS,
    build_clone_id_map,
    count_rows_per_collection,
    fingerprint_cpt_series,
    remap_ids,
    sort_models_parents_first,
)
from .bundle_restore_core import _restore_project_bundle_impl


class BundleCloneIncompleteError(ValueError):
    """Raised when a project copy came out with fewer rows than the source.

    Inherits ``ValueError`` so the routers' existing bad-bundle handling
    picks it up rather than letting it surface as an unexplained 500.
    """


async def clone_project_children(
    session: AsyncSession,
    *,
    source: ProjectOrm,
    target: ProjectOrm,
    logger: GroundModelLogger,
) -> dict[str, int]:
    """Copy every child row of *source* onto *target*, with fresh ids.

    Runs inside the caller's transaction; nothing is committed here.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    source : ProjectOrm
        The project being copied.
    target : ProjectOrm
        The already-created project row the copies hang under. Its metadata
        is left exactly as the caller set it — the restore leaves an
        existing project shell untouched — so a Save As keeps the new name
        and the lumping slots the caller carried across.
    logger : GroundModelLogger
        Caller's typed logger, so the phase lines carry the caller's module.

    Returns
    -------
    dict[str, int]
        Collection key → number of rows copied.

    Raises
    ------
    BundleCloneIncompleteError
        When the copy carries fewer rows than the source in any collection.
    """
    logger.info(f"clone_project_children: {source.id} → {target.id}")
    source_bundle = await _build_project_bundle_impl(session, source, logger, include_solids=True)

    id_map = build_clone_id_map(
        source_bundle, source_project_id=source.id, new_project_id=target.id
    )
    remapped: dict[str, Any] = {
        key: remap_ids(source_bundle[key], id_map) for key in BUNDLE_COLLECTION_KEYS
    }
    # geological_model.parent_model_id is a self-referential FK with no
    # SQLAlchemy relationship behind it, so the unit of work inserts these
    # rows in the order they are queued and cannot reorder them itself. Put
    # parents first rather than relying on the order the source rows came
    # back in.
    remapped["geological_models"] = sort_models_parents_first(remapped["geological_models"])
    remapped["litho_contact_correlation_edges"] = [
        _canonicalise_edge_endpoints(edge) for edge in remapped["litho_contact_correlation_edges"]
    ]
    remapped["body_geometry_facts"] = [
        _canonicalise_fact_endpoints(fact) for fact in remapped["body_geometry_facts"]
    ]
    # body_separation carries the SAME (layer_a_id < layer_b_id) CHECK and no
    # side columns, so the id-remap can flip its endpoints just like a fact's —
    # re-canonicalise with the same helper.
    remapped["body_separations"] = [
        _canonicalise_fact_endpoints(sep) for sep in remapped["body_separations"]
    ]
    # body_union has the SAME canonical-pair CHECK — re-canonicalise it too.
    remapped["body_unions"] = [
        _canonicalise_fact_endpoints(union) for union in remapped["body_unions"]
    ]

    await _restore_project_bundle_impl(
        session,
        target.id,
        remap_ids(source_bundle["project"], id_map),
        **{BUNDLE_RESTORE_KWARGS[key]: remapped[key] for key in BUNDLE_COLLECTION_KEYS},
        logger=logger,
    )

    # The verification re-read deliberately does NOT carry the solids. All the
    # comparison wants from them is a row count, and materialising ~89 bodies'
    # vertex/triangle arrays as Python lists a second time is the single most
    # expensive thing this synchronous verb does. Count them in the database
    # instead — one scalar round-trip against the same transaction.
    clone_bundle = await _build_project_bundle_impl(session, target, logger, include_solids=False)
    copied = _verify_clone_is_complete(
        source_bundle,
        clone_bundle,
        source_id=source.id,
        target_id=target.id,
        id_map=id_map,
        clone_litho_solid_count=await _count_litho_solids(session, target.id),
        logger=logger,
    )
    logger.success(
        f"clone_project_children: {source.id} → {target.id} copied "
        + ", ".join(f"{n} {key}" for key, n in copied.items() if n)
    )
    return copied


def _canonicalise_edge_endpoints(edge: dict[str, Any]) -> dict[str, Any]:
    """Restore a correlation edge's ``layer_a_id < layer_b_id`` ordering.

    ``litho_contact_correlation_edge`` carries a CHECK that the two
    endpoints are stored in ascending id order — that is what makes an
    undirected tie one row rather than two. Re-keying the copy gives both
    endpoints new ids whose relative order need not match the source's, so
    the pair has to be put back in order. The SIDES travel with their
    endpoints: swapping the ids without swapping ``layer_a_side`` /
    ``layer_b_side`` would turn a top↔base tie into a base↔top one.

    Parameters
    ----------
    edge : dict[str, Any]
        A remapped correlation-edge payload.

    Returns
    -------
    dict[str, Any]
        The same payload with its endpoints (and their sides) in canonical
        order. Returned unchanged when either endpoint is missing.
    """
    a_id, b_id = edge.get("layer_a_id"), edge.get("layer_b_id")
    if not isinstance(a_id, str) or not isinstance(b_id, str) or a_id <= b_id:
        return edge
    swapped = dict(edge)
    swapped["layer_a_id"], swapped["layer_b_id"] = b_id, a_id
    swapped["layer_a_side"], swapped["layer_b_side"] = (
        edge.get("layer_b_side"),
        edge.get("layer_a_side"),
    )
    return swapped


def _canonicalise_fact_endpoints(fact: dict[str, Any]) -> dict[str, Any]:
    """Restore a geometry fact's ``layer_a_id < layer_b_id`` ordering.

    The sibling of :func:`_canonicalise_edge_endpoints` for
    ``body_geometry_fact`` — same CHECK constraint, same re-key hazard, but a
    fact carries no side columns, so only the ids swap.

    Parameters
    ----------
    fact : dict[str, Any]
        A remapped geometry-fact payload.

    Returns
    -------
    dict[str, Any]
        The same payload with its endpoints in canonical order. Returned
        unchanged when either endpoint is missing.
    """
    a_id, b_id = fact.get("layer_a_id"), fact.get("layer_b_id")
    if not isinstance(a_id, str) or not isinstance(b_id, str) or a_id <= b_id:
        return fact
    swapped = dict(fact)
    swapped["layer_a_id"], swapped["layer_b_id"] = b_id, a_id
    return swapped


async def _count_litho_solids(session: AsyncSession, project_id: UUID) -> int:
    """Count a project's cached body solids without serialising their meshes.

    ``litho_body_solid`` has no ``app_project_id`` column — the ``model_id`` FK
    is the project anchor — so the count is scoped through
    ``geological_model``, exactly as ``bundle_build`` scopes its own query.

    Parameters
    ----------
    session : AsyncSession
        Running session (inside the caller's transaction).
    project_id : UUID
        Project whose solids are counted.

    Returns
    -------
    int
        Number of ``litho_body_solid`` rows the project owns.
    """
    stmt = (
        select(func.count())
        .select_from(LithoBodySolidOrm)
        .join(GeologicalModelOrm, LithoBodySolidOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project_id)
    )
    return int((await session.execute(stmt)).scalar_one())


def _verify_clone_is_complete(
    source_bundle: dict[str, Any],
    clone_bundle: dict[str, Any],
    *,
    source_id: UUID,
    target_id: UUID,
    id_map: Mapping[str, str],
    clone_litho_solid_count: int,
    logger: GroundModelLogger,
) -> dict[str, int]:
    """Compare the copy against the source, collection by collection.

    Rows are counted at every depth, so a copy that kept the boreholes but
    lost their samples, or kept the models but lost their litho layers, is
    caught here too.

    Counting id-bearing rows is not enough on its own: ``cpt_series`` has no
    ``id``, so the depth arrays are invisible to the row counts. They get their
    own structural comparison (:func:`fingerprint_cpt_series`), per CPT, via
    *id_map* — the copy's CPTs carry fresh ids, so the source id has to be
    translated before the two fingerprints can be lined up.

    Parameters
    ----------
    source_bundle : dict[str, Any]
        Bundle read from the project being copied, WITH solids.
    clone_bundle : dict[str, Any]
        Bundle re-read from the copy after the restore, WITHOUT solids (they
        are counted separately — see *clone_litho_solid_count*).
    source_id : UUID
        Source project id, for the message.
    target_id : UUID
        Copy's project id, for the message.
    id_map : Mapping[str, str]
        ``old id → new id`` used to build the copy.
    clone_litho_solid_count : int
        Solid rows the copy owns, counted in the database rather than
        serialised — the meshes are megabytes and only their number matters
        here.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    dict[str, int]
        Collection key → rows in the copy.

    Raises
    ------
    BundleCloneIncompleteError
        When any collection is short, or a CPT lost its depth series.
    """
    expected = count_rows_per_collection(source_bundle)
    actual = count_rows_per_collection(clone_bundle)
    actual["litho_solids"] = clone_litho_solid_count
    short = {key: (expected[key], actual[key]) for key in expected if actual[key] < expected[key]}
    lost_series = _lost_cpt_series(source_bundle, clone_bundle, id_map)
    if short or lost_series:
        detail = ", ".join(f"{key} {got}/{want}" for key, (want, got) in sorted(short.items()))
        if lost_series:
            detail = ", ".join(filter(None, (detail, "; ".join(lost_series))))
        raise BundleCloneIncompleteError(
            f"Copy of project {source_id} into {target_id} is incomplete — "
            f"{detail} (copied/expected). The copy has NOT been kept; nothing was "
            f"written to the original."
        )
    surplus = {key: (expected[key], actual[key]) for key in expected if actual[key] > expected[key]}
    if surplus:
        # Not a loss, so not fatal — but a copy that grew rows means a
        # database trigger re-derived something the bundle also carried, and
        # that is worth knowing about before it becomes a duplicate-row bug.
        logger.warning(
            f"clone_project_children: copy {target_id} carries MORE rows than "
            f"source {source_id} in {sorted(surplus)} (expected, actual) = "
            f"{ {k: v for k, v in surplus.items()} } — a DB trigger likely "
            f"re-derived rows the bundle already carried"
        )
    return actual


def _lost_cpt_series(
    source_bundle: dict[str, Any],
    clone_bundle: dict[str, Any],
    id_map: Mapping[str, str],
) -> list[str]:
    """Name every CPT whose depth series did not survive the copy.

    ``cpt_series`` is keyed by ``cpt_id`` and has no ``id`` of its own, so it is
    invisible to the row counts. Compared structurally instead: a CPT that had a
    series must still have one, with the same number of samples.

    A series appearing where the source had none is NOT reported — nothing was
    lost, and the surplus branch already logs unexpected growth.

    Parameters
    ----------
    source_bundle : dict[str, Any]
        Bundle read from the source project.
    clone_bundle : dict[str, Any]
        Bundle re-read from the copy.
    id_map : Mapping[str, str]
        ``old id → new id`` used to build the copy.

    Returns
    -------
    list[str]
        One human-readable line per CPT that lost samples; empty when every
        series came across intact.
    """
    expected = fingerprint_cpt_series(source_bundle)
    actual = fingerprint_cpt_series(clone_bundle)
    lost: list[str] = []
    for old_id, want in expected.items():
        if want is None:
            continue
        got = actual.get(id_map.get(old_id, old_id))
        if got != want:
            lost.append(
                f"cpt {old_id} series {got if got is not None else 'absent'}/{want} samples"
            )
    return lost
