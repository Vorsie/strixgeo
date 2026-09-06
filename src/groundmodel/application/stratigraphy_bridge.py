"""Formal/informal stratigraphy bridge + key-resolution helpers.

Extracted verbatim from ``auto_populate_contacts_from_stratigraphy``
(debt #178/#201). Builds the project-wide formal->informal name bridge and
resolves the effective formation key for a stratigraphy layer (codelist
canonicalisation, bridge lookup, layer-name derivation, lumping), plus the
max-overlap observation helpers the bridge and the scan share.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.application.formal_code_count import FormalCodeCount
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.codelists.dov_formal_stratigraphy_catalog import (
    FormalStratigraphyEntry,
    get_formal_stratigraphy,
)
from groundmodel.infrastructure.codelists.dov_formal_stratigraphy_constants import (
    RELATION_CODES_NORM,
    RELATION_WORD,
    UNRESOLVABLE_CODES_NORM,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.formation_key import normalize_formation_key
from groundmodel.shared.logging.logger_factory import LoggerFactory

_logger = LoggerFactory.get_logger(__name__)


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


def _resolve_codelist_canonical(raw_key: str) -> str | None:
    """Resolve a normalised formal code to its canonical DOV name, or None.

    Consults the process-singleton DOV formal-stratigraphy lexicon (#59,
    ~403 codes parsed from DOV's ``FormeleStratigrafieLedenEnumType`` XSD).
    Handles both atomic codes and the parser's compound
    ``lid1-<rel>-lid2`` shape:

    * **Atomic** — ``"koaa"`` → ``"Lid van Aalbeke (Formatie van Kortrijk)"``.
    * **Compound** — the normalised key is exactly three space-separated
      tokens whose middle token is a relation letter (``t``/``o``/``e``,
      see ``dov_formal_stratigraphy_constants``). Each side is resolved
      independently and composed as ``"<name1> tot|of|en <name2>"``
      (e.g. ``"qh t qp"`` → ``"Quartair Holoceen tot Quartair
      Pleistoceen"``). If EITHER side is unknown the whole compound is a
      miss (return None) — never invent a half-resolved name.

    Returns ``None`` for any code not in the lexicon (``"u"`` = Onbekend,
    Walloon/pre-NCS units, …); the caller then falls through to the raw
    token unchanged — the lexicon is strictly additive, never lossy.

    Parameters
    ----------
    raw_key : str
        The typographically normalised key (output of
        ``normalize_formation_key``).

    Returns
    -------
    str or None
        The canonical full Dutch name, or ``None`` on any miss.
    """
    catalog = get_formal_stratigraphy()

    def _hit(code_key: str) -> FormalStratigraphyEntry | None:
        # A sentinel code (e.g. "u" = Onbekend) exists in the XSD but is
        # NOT a real unit — treat it as a miss so the raw token survives.
        if code_key in UNRESOLVABLE_CODES_NORM:
            return None
        return catalog.resolve(code_key)

    direct = _hit(raw_key)
    if direct is not None:
        return direct.full_name_nl
    # Compound: exactly 3 tokens, middle is a relation letter. Atomic
    # permkeys normalise to a single token so they never reach here.
    tokens = raw_key.split()
    if len(tokens) == 3 and tokens[1] in RELATION_CODES_NORM:
        left = _hit(tokens[0])
        right = _hit(tokens[2])
        if left is not None and right is not None:
            return f"{left.full_name_nl} {RELATION_WORD[tokens[1]]} {right.full_name_nl}"
    return None


def _resolve_bridge_key(
    raw_key: str,
    *,
    primary_is_formal: bool,
    bridge: dict[str, str] | None,
) -> tuple[str, str | None]:
    """Resolve a raw formal key via the in-project bridge, then the #59 lexicon.

    Precedence (formal keys only — informal is never remapped, the bridge
    and the lexicon are both one-directional formal→informal):

      1. **In-project bridge** (``build_formal_informal_bridge``) — a
         data-proven dual-stream equivalence in THIS project wins over the
         global table. Project data is authoritative.
      2. **#59 DOV-formal lexicon** (``_resolve_codelist_canonical``) — the
         deterministic curated code↔name table, for formal-only boreholes
         with no dual-stream counterpart in the project (the gap #58 left).
      3. Else the ``raw_key`` is returned unchanged.

    Returns a ``(resolved_key, canonical_name_or_None)`` pair. The second
    element is the human-readable canonical name ONLY when the lexicon
    resolved it (so the caller can surface it as the display name even for
    a formal-only borehole with no informal counterpart); it is ``None``
    for the bridge hit and the no-op path (those keep the existing
    display-name behaviour: informal counterpart or raw description).

    Parameters
    ----------
    raw_key : str
        The typographically normalised key produced by
        ``_derive_layer_names_and_key``.
    primary_is_formal : bool
        True when the raw_key originated from a FORMAL_STRATIGRAPHY layer.
        False → returned unchanged (informal is never remapped).
    bridge : dict[str, str] or None
        The project-level formal→informal map, or None.

    Returns
    -------
    tuple[str, str | None]
        ``(resolved_key, canonical_name)``. ``canonical_name`` is non-None
        only on a lexicon hit.
    """
    if not primary_is_formal:
        return raw_key, None
    # 1. In-project bridge wins over the global lexicon (project data is
    #    authoritative; a non-standard local naming convention must be
    #    able to override the curated table).
    if bridge is not None and raw_key in bridge:
        return bridge[raw_key], None
    # 2. #59 global DOV-formal lexicon (the no-dual-stream gap).
    canonical = _resolve_codelist_canonical(raw_key)
    if canonical is not None:
        return normalize_formation_key(canonical), canonical
    # 3. No mapping anywhere — raw token unchanged (never invent).
    return raw_key, None


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

    Precedence (revised 2026-05-18 — "lump wins over bridge" + the #59
    DOV-formal lexicon slotted into the bridge step):

      1. ``raw_key`` in ``manual_map`` (non-blank target) → the user's
         explicit lump on the RAW code wins **outright**; neither the
         bridge nor the lexicon is applied. (User-can-still-lump #1: a
         pre-#58 ``stratigraphy_lumping`` map keyed on raw formal codes
         keeps resolving with zero re-lumping.)
      2. else in-project ``bridge(raw_key)`` → data-proven dual-stream
         equivalence in THIS project (authoritative over the global table).
      3. else #59 DOV-formal lexicon → deterministic curated code↔name
         (the formal-only / no-dual-stream gap #58 left). Atomic +
         compound ``lid1-rel-lid2``; misses fall through, never invented.
      4. The user's ``manual_map`` is re-checked on the resolved
         (bridge/lexicon) identity → the user can STILL lump the resolved
         candidate the Fill dialog shows (User-can-still-lump #2). A lump
         here overrides the lexicon's canonical name.
      5. else → ``raw_key`` unchanged (no-op path).

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
        ``(effective_key, effective_name, use_effective_name)``. The third
        element (kept named ``was_lumped`` at the call sites for
        continuity) is True when ``effective_name`` is authoritative and
        should be used as the display name — i.e. the user lumped (raw or
        resolved identity) OR the #59 lexicon resolved a canonical DOV
        name. False keeps the pre-existing display behaviour (informal
        counterpart, else raw description).
    """
    # Step 1 — raw lump wins outright.  _resolve_effective_key returns the
    # raw key unchanged on a miss OR a blank-target guard hit; eff_key !=
    # raw_key is the unambiguous "the user actually lumped this" signal.
    if manual_map is not None and raw_key in manual_map:
        eff_key, eff_name = _resolve_effective_key(raw_key, manual_map)
        if eff_key != raw_key:
            return eff_key, eff_name, True
    # Step 2 — in-project bridge, then the #59 DOV-formal lexicon (the
    # no-dual-stream gap). resolved_key is the bridged/canonical identity;
    # canonical is the human-readable DOV name ONLY on a lexicon hit.
    resolved_key, canonical = _resolve_bridge_key(
        raw_key, primary_is_formal=primary_is_formal, bridge=bridge
    )
    # Step 3 — lump on the resolved identity. THIS is what keeps manual
    # lumping working AFTER the bridge/lexicon resolves: if the user lumps
    # the resolved candidate (the bridge/canonical key the Fill dialog now
    # shows) it still wins — same contract as before #59.
    eff_key, eff_name = _resolve_effective_key(resolved_key, manual_map)
    if manual_map is not None and resolved_key in manual_map and eff_key != resolved_key:
        return eff_key, eff_name, True
    # Step 4 — lexicon resolved but the user did NOT lump it: surface the
    # canonical DOV name as the display name (was_lumped=True selects
    # effective_name at the call sites). eff_key == resolved_key here.
    if canonical is not None:
        return eff_key, canonical, True
    # Step 5 — bridge-only or no-op: unchanged pre-#59 behaviour.
    return eff_key, eff_name, False


def build_formal_code_counts(
    code_to_bhs: dict[str, set[UUID]],
    code_to_raw: dict[str, str],
) -> tuple[FormalCodeCount, ...]:
    """Resolve a candidate's accumulated formal codes into display counts.

    The scan accumulates, per effective candidate key, the set of boreholes
    that paired the candidate with each normalised DOV formal code (plus the
    first raw casing seen for that code).  This turns those accumulators into
    the ``FormalCodeCount`` list the candidate carries — resolving each code
    through the DOV formal-stratigraphy lexicon (#59) so the canonical name and
    canonical casing surface where the lexicon knows them, and reuses that
    existing catalogue rather than inventing an alias table (owner ruling
    2026-09-05).  Old and new codes for the same member (``TtEg`` / ``HyEg``
    both resolve to a name containing ``Lid van Egem``) are therefore
    recognisable as one unit by their shared catalogue name.

    Parameters
    ----------
    code_to_bhs : dict[str, set[UUID]]
        ``{ normalize_formation_key(formal_code) -> {borehole ids} }`` for the
        candidate.
    code_to_raw : dict[str, str]
        ``{ normalize_formation_key(formal_code) -> first raw code seen }`` —
        the display fallback when the lexicon has no entry for the code.

    Returns
    -------
    tuple[FormalCodeCount, ...]
        One entry per distinct formal code, sorted by count descending then
        code ascending (deterministic).  Empty when the candidate has no
        formal code (informal-only boreholes).
    """
    catalog = get_formal_stratigraphy()
    items: list[FormalCodeCount] = []
    for norm_code, borehole_ids in code_to_bhs.items():
        # A sentinel code ("u" = Onbekend) exists in the lexicon but is not a
        # real unit — treat it like an unknown code (raw display, no target),
        # matching _resolve_codelist_canonical's own handling.
        entry = None if norm_code in UNRESOLVABLE_CODES_NORM else catalog.resolve(norm_code)
        if entry is not None:
            display_code = entry.code
            catalog_name: str | None = entry.full_name_nl
        else:
            display_code = code_to_raw.get(norm_code, norm_code)
            catalog_name = None
        items.append(
            FormalCodeCount(code=display_code, count=len(borehole_ids), catalog_name=catalog_name)
        )
    return tuple(sorted(items, key=lambda fc: (-fc.count, fc.code)))


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
