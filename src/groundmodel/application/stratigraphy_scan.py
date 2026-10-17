"""Stratigraphy candidate scan for auto-populate / discover flows.

Extracted verbatim from ``auto_populate_contacts_from_stratigraphy``
(debt #178/#201). Walks each borehole's formal (falling back to informal)
stratigraphy stream and yields ``StratigraphyCandidate`` rows with the
split name/regional_ref convention and lumping applied.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_observation_layers_options import (
    borehole_observation_layers_options,
)
from groundmodel.application.lumping_collision import LumpingCollision
from groundmodel.application.stratigraphy_bridge import (
    _best_overlap,
    _derive_layer_names_and_key,
    _find_observation,
    _resolve_lumped_key,
    build_formal_code_counts,
)
from groundmodel.application.stratigraphy_candidate import StratigraphyCandidate
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.shared.formation_key import normalize_formation_key
from groundmodel.shared.logging.logger_factory import LoggerFactory

_logger = LoggerFactory.get_logger(__name__)


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
        .options(*borehole_observation_layers_options())
    )
    boreholes = list((await session.execute(bh_stmt)).scalars().all())

    # effective_key → (first seen display name, first seen regional_ref, set of borehole ids).
    # Keyed on the EFFECTIVE key (after applying manual_map) so lumped names merge.
    key_to_data: dict[str, tuple[str, str | None, set[UUID]]] = {}
    # Collision detection: per borehole, track (effective_key → list of (top_m, raw_name)).
    # Used to find cases where ≥2 layers in one borehole map to the same formation.
    borehole_key_layers: dict[UUID, dict[str, list[tuple[float, str]]]] = {}
    # DOV formal codes behind each candidate (owner dogfeed 2026-09-05): per
    # effective_key, which normalised formal codes the boreholes paired it with,
    # the distinct boreholes per code, and the first raw casing of each code.
    key_to_formal_bhs: dict[str, dict[str, set[UUID]]] = {}
    key_to_formal_raw: dict[str, dict[str, str]] = {}

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
            counterpart_desc = (counterpart.description or "").strip() if counterpart else None

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

            # Record the DOV formal code (if any) this borehole pairs the
            # candidate with, so the dialog can show it and expose a
            # formal↔informal disagreement.  regional_ref is the formal code
            # when the primary stream was formal; None on informal-only layers.
            if regional_ref:
                norm_code = normalize_formation_key(regional_ref)
                if norm_code:
                    key_to_formal_bhs.setdefault(effective_key, {}).setdefault(
                        norm_code, set()
                    ).add(borehole.id)
                    key_to_formal_raw.setdefault(effective_key, {}).setdefault(
                        norm_code, regional_ref.strip()
                    )

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
                    formal_codes=build_formal_code_counts(
                        key_to_formal_bhs.get(key, {}),
                        key_to_formal_raw.get(key, {}),
                    ),
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


def _palette_colour_for(name: str) -> str:
    """Stable hue from the formation name — same string → same colour."""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _DEFAULT_FORMATION_COLOURS[h % len(_DEFAULT_FORMATION_COLOURS)]
