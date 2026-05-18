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

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.application.auto_populate_outcome import AutoPopulateOutcome
from groundmodel.application.lumping_collision import LumpingCollision
from groundmodel.application.stratigraphy_candidate import StratigraphyCandidate
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


_NON_ALNUM_RUN = re.compile(r"[\W_]+", re.UNICODE)


def normalize_formation_key(raw: str) -> str:
    """Canonicalise a stratigraphy description into a dedup / merge key.

    **Typographic-only normalisation** (owner directive, 2026-05-17 reversal).

    The two semantic steps that were present in the prior implementation —
    (a) dropping everything before the last ``:`` and (b) reducing to
    ``lid van <member>`` — have been REMOVED. Reason: both steps caused
    the machine to silently decide that two strings were the same unit when
    they were not, which is exactly the class of decision the owner
    reserved for the user's manual lumping tool.  After the reversal:

      * ``"Formatie van Aalter - Lid van Oedelem"`` and
        ``"Lid van Oedelem"`` are DISTINCT keys.
      * ``"Paleogeen: Formatie van Aalter"`` and
        ``"Tertiair: Formatie van Aalter"`` are DISTINCT keys.

    The only remaining normalisation is typographic — it collapses
    characters that are byte-distinct but visually identical, preventing
    accidental splits between boreholes where the same string was typed
    in two slightly different ways:

      * NFKC — folds NBSP (U+00A0) → regular space, en-dash (U+2013)
        and em-dash (U+2014) → ``-``, fullwidth / ligature forms.
      * ``casefold`` — Unicode-aware lower (handles non-ASCII letters).
      * Collapse every run of non-alphanumeric characters (punctuation,
        whitespace) to a single space; strip.

    Used ONLY as the merge / identity key inside the discover scan and
    the write path.  The raw first-seen description is still the display
    name and the persisted ``name``.

    Parameters
    ----------
    raw : str
        Raw (already ``.strip()``-ed) layer description or regional ref.

    Returns
    -------
    str
        The typographically normalised key.  An empty input returns an
        empty string; callers must guard against empty descriptions before
        calling this function.
    """
    # NFKC folds NBSP, en-dash, em-dash, ligatures, fullwidth chars.
    nfkc = unicodedata.normalize("NFKC", raw)
    # Casefold → Unicode-aware lower.  Collapse non-alnum runs → space.
    return _NON_ALNUM_RUN.sub(" ", nfkc.casefold()).strip()


async def build_formal_informal_bridge(
    session: AsyncSession,
    *,
    project_id: UUID,
) -> dict[str, str]:
    """Derive a formal-code → informal-name equivalence map from the project's boreholes.

    Scans every borehole in the project that carries BOTH a
    ``FORMAL_STRATIGRAPHY`` and an ``INFORMAL_STRATIGRAPHY`` observation
    (a "dual-stream" borehole).  For each dual-stream borehole, pairs formal
    and informal layers by max depth-interval overlap (the same
    ``_best_overlap`` rule used by the seeder itself).  Each proven pair
    contributes one ``normalize(formal_code) → normalize(informal_name)``
    entry to the bridge.

    When multiple dual-stream boreholes disagree on what a formal code maps
    to (e.g. "Q" → "Quartair" in borehole A vs "Q" → "Alluvium" in borehole
    B), the most-frequent informal key wins.  Ties are broken by lexicographic
    order of the informal key (deterministic, no randomness).  A WARNING is
    logged when disagreement is detected (Decision 2, locked 2026-05-18).

    A project with no dual-stream boreholes returns an empty dict — the bridge
    is a no-op and manual lumping still works exactly as before (Decision 1,
    locked 2026-05-18).

    The bridge is **not persisted** — it is a derivation of ``ObservationLayer``
    rows already in the bundle.  Recomputing it per request is cheap (one
    SELECT over the borehole table for the project scope, same round-trip as
    the seeder's own borehole load).  Persisting it would require a provenance
    column (Data Integrity Rule §1) and a migration — both avoided by
    recompute-on-discover.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session (read-only use inside this function;
        no flush/commit is issued).
    project_id : UUID
        Project scope — only boreholes within this project are queried.

    Returns
    -------
    dict[str, str]
        ``{ normalize_formation_key(formal_code) -> normalize_formation_key(informal_name) }``
        for every proven formal↔informal pair in the project.  Empty when no
        dual-stream borehole exists.
    """
    # Load every borehole in the project with its observations and layers in
    # one round-trip. Non-dual-stream boreholes (formal-only, informal-only,
    # or neither) are loaded but discarded in the loop below — loading all is
    # simpler than a subquery filter and the layer payloads are small.
    bh_stmt = (
        select(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == project_id)
        .options(selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers))
    )
    boreholes = list((await session.execute(bh_stmt)).scalars().all())

    _logger.debug(
        "build_formal_informal_bridge: project=%s loaded %d boreholes",
        project_id,
        len(boreholes),
    )

    # Per formal key: count votes per informal key across all dual-stream boreholes.
    # Structure: { norm(formal_code) -> Counter({ norm(informal_name) -> vote_count }) }
    votes: dict[str, Counter[str]] = {}

    dual_stream_count = 0
    for borehole in boreholes:
        formal_obs = _find_observation(borehole.observations, ObservationType.FORMAL_STRATIGRAPHY)
        informal_obs = _find_observation(
            borehole.observations, ObservationType.INFORMAL_STRATIGRAPHY
        )
        # Only dual-stream boreholes prove formal↔informal equivalences.
        if formal_obs is None or informal_obs is None:
            continue

        dual_stream_count += 1
        informal_layers = list(informal_obs.layers)

        for formal_layer in formal_obs.layers:
            formal_desc = (formal_layer.description or "").strip()
            if not formal_desc:
                continue
            # Pair with the best-overlap informal layer (same rule as the seeder).
            counterpart = _best_overlap(formal_layer.top_m, formal_layer.base_m, informal_layers)
            if counterpart is None:
                # No informal layer overlaps this formal layer → no proven pair.
                _logger.debug(
                    "build_formal_informal_bridge: borehole=%s formal='%s' "
                    "(top=%.2f, base=%.2f) has no overlapping informal layer — skipped",
                    borehole.id,
                    formal_desc,
                    formal_layer.top_m,
                    formal_layer.base_m,
                )
                continue
            informal_desc = (counterpart.description or "").strip()  # type: ignore[union-attr]
            if not informal_desc:
                continue

            norm_formal = normalize_formation_key(formal_desc)
            norm_informal = normalize_formation_key(informal_desc)
            votes.setdefault(norm_formal, Counter())[norm_informal] += 1

    _logger.debug(
        "build_formal_informal_bridge: %d dual-stream boreholes, %d formal key(s) with votes",
        dual_stream_count,
        len(votes),
    )

    if not votes:
        _logger.info(
            "build_formal_informal_bridge: project=%s — 0 pairs "
            "(%d dual-stream borehole(s); nothing to bridge)",
            project_id,
            dual_stream_count,
        )
        return {}

    bridge: dict[str, str] = {}
    for norm_formal, counter in votes.items():
        winner, winner_count = counter.most_common(1)[0]
        total = sum(counter.values())
        if len(counter) > 1:
            # Disagreement: multiple informal keys for the same formal code.
            # Log a WARNING; pick the most frequent, break ties lexicographically.
            # Deterministic tie-break: when two informal keys share the top count,
            # the lexicographically smaller key wins (stable sort).
            top_count = winner_count
            tied_keys = sorted(k for k, c in counter.items() if c == top_count)
            winner = tied_keys[0]
            _logger.warning(
                "build_formal_informal_bridge: formal key '%s' has %d disagreeing "
                "informal mapping(s) across %d borehole(s): %s — picking '%s' "
                "(majority=%d/%d votes)",
                norm_formal,
                len(counter),
                total,
                dict(counter),
                winner,
                counter[winner],
                total,
            )
        bridge[norm_formal] = winner

    _logger.info(
        "build_formal_informal_bridge: project=%s — %d pair(s) from %d dual-stream borehole(s)",
        project_id,
        len(bridge),
        dual_stream_count,
    )
    _logger.debug(
        "build_formal_informal_bridge: bridge contains %d pair(s): %s",
        len(bridge),
        bridge,
    )
    return bridge


def _resolve_bridge_key(
    raw_key: str,
    *,
    primary_is_formal: bool,
    bridge: dict[str, str] | None,
) -> str:
    """Apply the formal↔informal bridge to a raw normalised key — pure, no I/O.

    When ``primary_is_formal`` is True and ``raw_key`` is found in ``bridge``,
    returns the mapped informal key so a formal-only borehole's layer resolves
    to the same identity as an informal-only borehole's layer for the same
    geological unit.

    Returns ``raw_key`` unchanged in every other case:

    * ``bridge`` is None (no dual-stream boreholes in the project).
    * ``primary_is_formal`` is False (informal key — never remapped; the bridge
      maps formal → informal, not the reverse).
    * ``raw_key`` is not in ``bridge`` (this formal code has no proven informal
      equivalent in the project data).

    Parameters
    ----------
    raw_key : str
        The typographically normalised key produced by
        ``_derive_layer_names_and_key``.
    primary_is_formal : bool
        True when the raw_key originated from a FORMAL_STRATIGRAPHY layer.
        False for INFORMAL_STRATIGRAPHY layers — the bridge is one-directional
        (formal→informal) so informal keys pass through unchanged.
    bridge : dict[str, str] or None
        The project-level formal→informal map produced by
        ``build_formal_informal_bridge``, or None when no bridge was computed
        (no-op path).

    Returns
    -------
    str
        The bridge-resolved key when a mapping exists; ``raw_key`` otherwise.
    """
    if bridge is None or not primary_is_formal:
        return raw_key
    return bridge.get(raw_key, raw_key)


def _derive_layer_names_and_key(
    *,
    primary_is_formal: bool,
    primary_desc: str,
    counterpart_desc: str | None,
) -> tuple[str, str | None, str]:
    """Derive the formation (name, regional_ref, key) triple for one primary layer.

    This is the **single source of truth** for the naming and identity logic
    shared between ``scan_stratigraphy_candidates`` (the discover scan) and
    ``AutoPopulateContactsFromStratigraphy.execute`` (the write path).  Both
    callers MUST use this function so the stable key is provably identical on
    both sides — the root cause of the divergence bug fixed here.

    DOV split convention:
      * ``name``         = informal description (working name engineers use).
      * ``regional_ref`` = formal stratigraphy code (stable regional reference).
    Each field falls back to the primary stream's own description when the
    other stream has no counterpart for this layer.

    Stable key rule:
      * ``key = regional_ref``  when formal stratigraphy is present
        (same formal code = same formation, regardless of working name).
      * ``key = name``          when informal-only (working name is the only
        available stable identifier in that borehole).

    Parameters
    ----------
    primary_is_formal : bool
        True when the primary observation stream is FORMAL_STRATIGRAPHY.
    primary_desc : str
        Non-empty description from the primary layer (caller must strip/filter
        blank descriptions before calling this function).
    counterpart_desc : str or None
        Stripped description of the best-overlap layer in the other stream, or
        None when no other stream exists or no overlap was found.

    Returns
    -------
    tuple[str, str | None, str]
        ``(name, regional_ref, key)`` where ``name`` is the display /
        working name, ``regional_ref`` is the formal code (or None), and
        ``key`` is the stable cross-borehole identity key.
    """
    if primary_is_formal:
        regional_ref: str | None = primary_desc
        name = counterpart_desc or primary_desc
    else:
        regional_ref = None
        name = primary_desc

    # Single source of truth for identity: normalised so dash/space/
    # case variants and chrono-prefix variants of the same unit merge
    # on BOTH the discover scan and the write path.
    key = normalize_formation_key(regional_ref if regional_ref else name)
    return name, regional_ref, key


def _resolve_effective_key(
    raw_key: str,
    manual_map: dict[str, str] | None,
) -> tuple[str, str]:
    """Apply the manual lump map to a raw normalised key.

    Returns ``(effective_key, effective_name)`` where:
      * ``effective_key`` is the normalised form of the target name when the
        raw key is in ``manual_map``, otherwise equals ``raw_key``.
      * ``effective_name`` is the display name for the formation after lumping.

    The map stores ``{ normalize_formation_key(raw) -> target_formation_name }``
    as sent by the dialog.  The effective key is ``normalize_formation_key``
    applied to the target name, so the discover preview and the write path
    converge on identical effective keys regardless of how the target name
    was typed.

    WHY normalise the target: two raw names lumped to "Holoceen" must produce
    the same effective key as a raw name that IS "Holoceen" — the effective key
    is the FORMATION identity, and the formation identity is the typographic
    normalisation of whatever name the user chose.

    Parameters
    ----------
    raw_key : str
        The typographically normalised key produced by ``_derive_layer_names_and_key``.
    manual_map : dict[str, str] or None
        Optional ``{ raw_key -> target_formation_name }`` mapping.  ``None``
        means no lumping was requested; the raw key is returned unchanged.

    Returns
    -------
    tuple[str, str]
        ``(effective_key, effective_name)`` pair.
    """
    if manual_map is None:
        return raw_key, raw_key
    target_name = manual_map.get(raw_key)
    if target_name is None:
        return raw_key, raw_key
    # Guard blank/empty target — an empty string normalises to "" and would
    # create a nameless formation.  Treat as unmapped so the layer falls
    # through to its raw key (no formation is created for a blank target).
    normed_target = normalize_formation_key(target_name)
    if not normed_target:
        return raw_key, raw_key
    return normed_target, target_name


def _resolve_lumped_key(
    raw_key: str,
    *,
    primary_is_formal: bool,
    bridge: dict[str, str] | None,
    manual_map: dict[str, str] | None,
) -> tuple[str, str, bool]:
    """Resolve a raw key to its (effective_key, effective_name, was_lumped) triple.

    This is the **single source of truth** for the bridge↔lump precedence,
    shared verbatim by ``scan_stratigraphy_candidates`` (the discover preview)
    and ``AutoPopulateContactsFromStratigraphy.execute`` (the write path).
    Both callers MUST route through this function so the effective key is
    provably identical on both sides — the discover≡apply≡seed invariant.

    Precedence (revised 2026-05-18 — owner directive, **"lump wins over
    bridge"**, supersedes the original #58 ``raw → bridge → manual_map``):

      1. ``raw_key`` in ``manual_map`` (non-blank target) → the user's
         explicit equation wins **outright; the data-inferred bridge is NOT
         applied**.
      2. else ``bridge(raw_key)`` → formal→informal data-proven equivalence
         (no-op for informal keys; see ``_resolve_bridge_key``).
      3. ``bridge``-resolved key in ``manual_map`` → the user lumped on the
         bridged identity.
      4. else → ``raw_key`` unchanged.

    WHY raw-first: an explicit user lump ("treat formal code ``KoRo`` as
    *Pleistoceen*") is a stronger signal than a data-inferred bridge.  It is
    also **load-bearing for backward use**: a ``stratigraphy_lumping`` map
    persisted in a ``.gmproj`` BEFORE the #58 bridge shipped is keyed on the
    pre-bridge **raw formal codes**; with the old ``raw → bridge → lump``
    order the bridge rewrote the key out from under those entries and the
    lump silently dropped (the "stale-lump gap").  Raw-first makes those
    saved maps resolve again with **zero re-lumping**.

    Known asymmetry (documented, accepted): if the user lumps the formal
    code but NOT the informal counterpart and relies on the bridge to unify
    the two streams, the lumped formal side now jumps straight to the target
    while the unlumped informal side still rides the bridge to itself — they
    only reconverge if the informal key is also in ``manual_map``.  In the
    real flow the lumping dialog presents the bridge-merged candidate, so the
    user lumps the merged identity and both raw forms route through; the
    asymmetry only bites a hand-crafted partial map.

    Parameters
    ----------
    raw_key : str
        The typographically normalised key from ``_derive_layer_names_and_key``.
    primary_is_formal : bool
        True when ``raw_key`` originated from a FORMAL_STRATIGRAPHY layer
        (the bridge is one-directional formal→informal).
    bridge : dict[str, str] or None
        Project-level formal→informal map from ``build_formal_informal_bridge``,
        or None on the no-op path.
    manual_map : dict[str, str] or None
        ``{ normalize_formation_key(raw) -> target_formation_name }`` from the
        lumping dialog, or None when no lumping was requested.

    Returns
    -------
    tuple[str, str, bool]
        ``(effective_key, effective_name, was_lumped)``.  ``was_lumped`` is
        True when either the raw or the bridged key produced a manual-map
        hit, so the caller can choose the lumped display name over the
        derived layer name.
    """
    # Step 1 — raw lump wins outright.  _resolve_effective_key returns the
    # raw key unchanged on a miss OR a blank-target guard hit; eff_key !=
    # raw_key is the unambiguous "the user actually lumped this" signal.
    if manual_map is not None and raw_key in manual_map:
        eff_key, eff_name = _resolve_effective_key(raw_key, manual_map)
        if eff_key != raw_key:
            return eff_key, eff_name, True
    # Step 2 + 3 — bridge, then lump on the bridged identity (the original
    # #58 path, retained for the no-raw-lump case).
    bridged_key = _resolve_bridge_key(raw_key, primary_is_formal=primary_is_formal, bridge=bridge)
    eff_key, eff_name = _resolve_effective_key(bridged_key, manual_map)
    was_lumped = manual_map is not None and bridged_key in manual_map and eff_key != bridged_key
    return eff_key, eff_name, was_lumped


async def scan_stratigraphy_candidates(
    session: AsyncSession,
    *,
    project_id: UUID,
    borehole_ids: Iterable[UUID],
    manual_map: dict[str, str] | None = None,
    bridge: dict[str, str] | None = None,
) -> tuple[list[StratigraphyCandidate], list[LumpingCollision]]:
    """Scan borehole stratigraphy and return unique formation candidates.

    Runs the same FORMAL_STRATIGRAPHY-preferred / INFORMAL_STRATIGRAPHY-
    fallback / surface-layers-skipped logic as
    ``AutoPopulateContactsFromStratigraphy.execute()`` but performs NO DB
    write.  Used by the discover-from-stratigraphy endpoint to populate the
    ``FormationSelectionDialog`` without committing anything.

    The ``discover≡apply`` invariant is maintained: passing the same
    ``manual_map`` and ``bridge`` here and to ``execute()`` produces identical
    effective keys, collision warnings, and per-borehole contact choices.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session (read-only use; no flush/commit).
    project_id : UUID
        Project scope — only boreholes within this project are queried.
    borehole_ids : Iterable[UUID]
        Boreholes to scan.  Caller is responsible for scoping; borehole ids
        outside the project are silently filtered by the WHERE clause.
    manual_map : dict[str, str] or None, optional
        Optional ``{ normalize_formation_key(raw) -> target_formation_name }``
        mapping built by the user's lumping dialog.  When provided, layers
        whose raw key is in the map are merged under the target formation.
        ``None`` (default) = no lumping; every key remains its own candidate.
    bridge : dict[str, str] or None, optional
        Formal→informal equivalence map produced by
        ``build_formal_informal_bridge``.  When provided, formal-only layers
        whose code is in the map are resolved to the bridged informal key so
        they merge with informal-only layers that prove the same geological
        unit.  ``None`` (default) = no bridge, every formal key stays as-is.
        Precedence (revised 2026-05-18, "lump wins over bridge"): an
        explicit lump on the RAW key wins outright; only when the raw key
        is unlumped does the bridge run, then the lump is consulted on the
        bridged key.  See ``_resolve_lumped_key``.

    Returns
    -------
    tuple[list[StratigraphyCandidate], list[LumpingCollision]]
        A pair of:
        - Candidates sorted by ``borehole_count`` descending then ``name``
          ascending.  Empty when no borehole carries stratigraphy.
        - Collision warnings — one per (borehole, target_formation_key) pair
          where ≥2 raw names resolved to the same effective key within one
          borehole and only the shallowest is kept.  Empty when no manual_map
          is provided or when no collisions occur.
    """
    borehole_id_list = list(borehole_ids)
    if not borehole_id_list:
        return [], []

    # Load boreholes with observations + layers in one round-trip.
    bh_stmt = (
        select(BoreholeOrm)
        .where(
            BoreholeOrm.id.in_(borehole_id_list),
            BoreholeOrm.app_project_id == project_id,
        )
        .options(selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers))
    )
    boreholes = list((await session.execute(bh_stmt)).scalars().all())

    # effective_key → (first seen display name, first seen regional_ref, set of borehole ids).
    # Keyed on the EFFECTIVE key (after applying manual_map) so lumped names merge.
    key_to_data: dict[str, tuple[str, str | None, set[UUID]]] = {}
    # Collision detection: per borehole, track (effective_key → list of (top_m, raw_name)).
    # Used to find cases where ≥2 layers in one borehole map to the same formation.
    borehole_key_layers: dict[UUID, dict[str, list[tuple[float, str]]]] = {}

    for borehole in boreholes:
        formal_obs = _find_observation(borehole.observations, ObservationType.FORMAL_STRATIGRAPHY)
        informal_obs = _find_observation(
            borehole.observations, ObservationType.INFORMAL_STRATIGRAPHY
        )
        if formal_obs is None and informal_obs is None:
            continue

        primary_obs = formal_obs if formal_obs is not None else informal_obs
        other_obs = informal_obs if formal_obs is not None else None
        assert primary_obs is not None
        primary_is_formal = formal_obs is not None
        other_layers = list(other_obs.layers) if other_obs is not None else []

        borehole_layers: dict[str, list[tuple[float, str]]] = {}

        for layer in primary_obs.layers:
            if layer.top_m < 0.0:
                # Surface layers (top_m == 0) ARE included — same as auto-populate.
                # Negative depths are invalid; skip.
                continue
            primary_desc = (layer.description or "").strip()
            if not primary_desc:
                continue

            counterpart = _best_overlap(layer.top_m, layer.base_m, other_layers)
            counterpart_desc = (counterpart.description or "").strip() if counterpart else None  # type: ignore[union-attr]

            # Single shared derivation: name/regional_ref/key from the same
            # function used by execute(). Key divergence was the root cause of
            # the discover-execute mismatch (bug fixed 2026-05-16).
            name, regional_ref, raw_key = _derive_layer_names_and_key(
                primary_is_formal=primary_is_formal,
                primary_desc=primary_desc,
                counterpart_desc=counterpart_desc,
            )

            # Lump-wins-over-bridge resolution (revised 2026-05-18 — see
            # _resolve_lumped_key).  An explicit lump on the RAW key wins
            # outright; otherwise the formal↔informal bridge runs and the
            # lump is consulted on the bridged identity.  Shared verbatim
            # with execute() so discover≡apply≡seed holds.
            effective_key, effective_name, was_lumped = _resolve_lumped_key(
                raw_key,
                primary_is_formal=primary_is_formal,
                bridge=bridge,
                manual_map=manual_map,
            )
            # Use effective_name as display name when lumped; fall back to derived name.
            display_name = effective_name if was_lumped else name

            if effective_key not in key_to_data:
                key_to_data[effective_key] = (display_name, regional_ref, set())
            key_to_data[effective_key][2].add(borehole.id)

            # Track per-borehole layer positions for collision detection.
            borehole_layers.setdefault(effective_key, []).append((layer.top_m, primary_desc))

        if borehole_layers:
            borehole_key_layers[borehole.id] = borehole_layers

    # Build collision warnings: any (borehole, effective_key) with > 1 layer.
    # WHY shallowest wins: the shallowest contact is the formation's first
    # appearance; deeper layers that also map to the same formation are merged
    # downward into it.  Two tops for one formation would corrupt the TIN.
    collisions: list[LumpingCollision] = []
    for bh_id, key_layers in borehole_key_layers.items():
        for eff_key, layer_list in key_layers.items():
            if len(layer_list) < 2:
                continue
            # Sort ascending by top_m — smallest = shallowest.
            layer_list_sorted = sorted(layer_list, key=lambda t: t[0])
            kept_top_m = layer_list_sorted[0][0]
            # tuple: LumpingCollision.colliding_raw_names is tuple[str, ...]
            # so the frozen dataclass is truly shallow-frozen (no mutable list).
            raw_names_tuple = tuple(desc for _, desc in layer_list)
            target_name = key_to_data[eff_key][0]
            collisions.append(
                LumpingCollision(
                    borehole_id=bh_id,
                    target_formation_key=eff_key,
                    target_formation_name=target_name,
                    colliding_raw_names=raw_names_tuple,
                    kept_top_m=kept_top_m,
                    dropped_count=len(layer_list) - 1,
                )
            )

    return (
        sorted(
            [
                StratigraphyCandidate(
                    name=name,
                    regional_ref=regional_ref,
                    key=key,
                    borehole_count=len(bids),
                )
                for key, (name, regional_ref, bids) in key_to_data.items()
            ],
            key=lambda c: (-c.borehole_count, c.name),
        ),
        collisions,
    )


# Default colour palette for auto-created formations — cycles per
# formation, deterministic so the same description always lands on
# the same hue. Engineers rename + recolour after the auto-populate
# pass; this is just a "don't be invisible" default.
_DEFAULT_FORMATION_COLOURS = (
    "#a8a29e",  # warm grey
    "#fbbf24",  # amber
    "#a3e635",  # lime
    "#22d3ee",  # cyan
    "#a78bfa",  # violet
    "#fb7185",  # rose
    "#f97316",  # orange
    "#84cc16",  # green
    "#0ea5e9",  # sky
    "#c084fc",  # purple
)


def _find_observation(
    observations: Iterable[ObservationOrm],
    kind: ObservationType,
) -> ObservationOrm | None:
    """Return the first observation of ``kind`` on the borehole, or None.

    A borehole's observations are unique per type in practice (DOV doesn't
    ship two formal stratigraphy interpretations for one boring), so "first
    match" is equivalent to "the match".
    """
    for obs in observations:
        if obs.observation_type == kind.value:
            return obs
    return None


def _best_overlap(
    top_m: float,
    base_m: float,
    candidates: Iterable[object],
) -> object | None:
    """Return the candidate layer with the largest depth-interval overlap.

    Used to pair a primary-stream layer with its counterpart in the other
    stream (formal vs informal).  Overlap = intersection length:
    ``max(0, min(b1, b2) - max(t1, t2))``.  Returns ``None`` when no
    candidate overlaps at all.

    Type-erased to ``object`` because callers pass ``ObservationLayerOrm``
    rows via structural typing (``top_m`` / ``base_m`` / ``description``
    attributes); a typed signature would require a circular import.
    """
    best: object | None = None
    best_overlap_len = 0.0
    for cand in candidates:
        cand_top = float(getattr(cand, "top_m"))
        cand_base = float(getattr(cand, "base_m"))
        overlap = min(base_m, cand_base) - max(top_m, cand_top)
        if overlap > best_overlap_len:
            best_overlap_len = overlap
            best = cand
    return best


def _palette_colour_for(name: str) -> str:
    """Stable hue from the formation name — same string → same colour."""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _DEFAULT_FORMATION_COLOURS[h % len(_DEFAULT_FORMATION_COLOURS)]


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
            Layers for other keys are silently skipped.  Additionally,
            this method deletes — in the same transaction — every
            formation that (a) already exists in this project, (b) has
            at least one contact in THIS model (model-scoped, never
            cross-model), and (c) whose canonical key is NOT in this set.
            The delete is server-side so the client never needs to
            recompute canonical keys from raw names.

            When ``None`` (default), all layers are processed and NO
            formations are deleted — preserving the existing behaviour
            of ``handleAutoPopulateFromStratigraphy`` (the Sections
            "Seed from stratigraphy" path), which is unaffected
            by this change.

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

        Returns
        -------
        AutoPopulateOutcome
            Counts + ids so the API layer can build a meaningful
            response and the frontend can patch local state by id.
        """
        borehole_id_list = list(borehole_ids)
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
            f"bridge={len(bridge) if bridge else 0}"
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

        # When selected_keys is provided, delete every project formation whose
        # stable key is NOT in the selected set.  This runs server-side so
        # the client never has to recompute canonical keys from raw names —
        # the divergent-client-key freeze bug (da98053) was exactly that mismatch.
        # DB CASCADE handles formation_contact, formation_surface, and
        # geotechnical_unit rows that reference the deleted formations.
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
        deleted_formation_ids: list[UUID] = []
        if selected_key_set_norm is not None:
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
                self.info(
                    f"Auto-populate: deleted {len(delete_ids)} unselected formation(s): "
                    + ", ".join(str(fid) for fid in delete_ids[:5])
                    + ("..." if len(delete_ids) > 5 else "")
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
            f"Auto-populate done: model={model_id} "
            f"+{len(created_contact_ids)} contacts, "
            f"+{len(created_formation_ids)} formations, "
            f"-{len(deleted_formation_ids)} unselected formations, "
            f"marked {stale_count} surface(s) stale, "
            f"skipped {skipped_existing} existing / "
            f"{skipped_unmatched} unmatched / "
            f"{skipped_no_stratigraphy} no-stratigraphy / "
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
            collisions=write_collisions,
            found_contact_ids=found_contact_ids,
        )

    # Delegate to module-level helpers shared with scan_stratigraphy_candidates.
    _find_observation = staticmethod(_find_observation)
    _best_overlap = staticmethod(_best_overlap)
