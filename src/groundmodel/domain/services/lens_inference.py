"""Lens-inference engine for Position 4 — correlation-implies-absence (#101 R2).

Pure domain service. Takes a snapshot of correlation contacts, observation
layers, and existing absence rows for a single formation body and computes
which ``formation_absence`` rows should be written or retracted.

No I/O, no ORM, no logger. The application layer (R3) owns all side effects.

Algorithm
---------
For a body identified by ``(formation_id, body_ordinal)``:

1. Collect the set of investigations that have a contact for this body
   (``present_investigations``).
2. Determine the body's depth range: ``[depth_min_m, depth_max_m]`` from
   the contacts' ``depth_top_m`` values (min across present contacts = top;
   max = base approximation — the body sits somewhere in this band).
3. For each in-corridor investigation that is NOT in
   ``present_investigations``, scan its ``ObservationLayerRecord`` list for
   any layer that:
   a. Overlaps the body's depth range (even a single point counts —
      ``MIN_OVERLAP_RATIO = 0``).
   b. Has at least one ``main_soil_code`` that DIFFERS from the formation's
      expected soil code (``formation_soil_code``).
   If both conditions hold → **positive evidence of a different lithology at
   that depth band** → write a ``source='inferred'`` absence.
4. Idempotency:
   - An existing ``'inferred'`` row for the same triple is replaced (same
     content — a no-op at the DB level if the caller does UPSERT).
   - An existing ``'manual'`` or ``'observed'`` row is preserved unchanged
     (user intent; the engine must not overwrite it).
   - An existing ``'inferred'`` row for a triple that the engine no longer
     produces is *retracted* (added to ``to_retract``).
5. No-data → no inference: if an absent investigation has no observation
   layers at all, or none overlapping the depth range, nothing is written
   (UNKNOWN, not ABSENT).

See ``lens_inference_constants.py`` for tuning knobs and token values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from groundmodel.domain.services.lens_inference_constants import (
    ENGINE_OWNED_SOURCES,
    KIND_BOREHOLE,
    KIND_CPT,
    MIN_OVERLAP_RATIO,
    SOURCE_INFERRED,
)

# ---------------------------------------------------------------------------
# Input data-transfer objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BodyContactRecord:
    """Lightweight snapshot of one formation_contact row for the inference engine.

    The engine only needs the investigation anchor and the depth; all
    spatial / source / provenance fields are irrelevant here.

    Parameters
    ----------
    investigation_id : UUID
        The borehole or CPT id that hosts this contact.
    investigation_kind : str
        ``'borehole'`` or ``'cpt'``.
    depth_top_m : float
        Depth of the formation top at this investigation (metres positive
        downwards from ground surface).
    """

    investigation_id: UUID
    investigation_kind: str
    depth_top_m: float


@dataclass(frozen=True)
class ObservationLayerRecord:
    """Lightweight snapshot of one observation_layer row.

    Only the depth interval and main soil codes are needed by the engine;
    admixtures and free-text descriptions are irrelevant.

    Parameters
    ----------
    investigation_id : UUID
        The borehole or CPT that hosts this layer.
    investigation_kind : str
        ``'borehole'`` or ``'cpt'``.
    top_m : float
        Top of the layer (metres positive downwards from ground surface).
    base_m : float
        Base of the layer (metres positive downwards; ``base_m > top_m``).
    main_soil_codes : list[str]
        Source-vocabulary soil codes for this layer (e.g. ``['ZAND']``).
        Empty list means no lithology recorded for this layer.
    """

    investigation_id: UUID
    investigation_kind: str
    top_m: float
    base_m: float
    main_soil_codes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FormationAbsenceRecord:
    """Lightweight snapshot of one existing formation_absence row.

    Used to compute the delta between what the engine infers now and
    what was written in a prior run.

    Parameters
    ----------
    absence_id : UUID
        Primary key of the formation_absence row.
    investigation_id : UUID
        Investigation anchor.
    investigation_kind : str
        ``'borehole'`` or ``'cpt'``.
    source : str
        ``'inferred'``, ``'manual'``, or ``'observed'``.
    """

    absence_id: UUID
    investigation_id: UUID
    investigation_kind: str
    source: str


# ---------------------------------------------------------------------------
# Output data-transfer objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AbsenceToWrite:
    """One absence row the engine wants the application layer to UPSERT.

    Parameters
    ----------
    formation_id : UUID
        FK to the geological_formation.
    investigation_id : UUID
        Investigation anchor for this absence.
    investigation_kind : str
        ``'borehole'`` or ``'cpt'``.
    source : str
        Always ``'inferred'`` for engine-produced rows.
    """

    formation_id: UUID
    investigation_id: UUID
    investigation_kind: str
    source: str


@dataclass
class InferenceResult:
    """Output of ``infer_formation_absences``.

    Attributes
    ----------
    to_write : list[AbsenceToWrite]
        Absence rows the application layer should UPSERT (INSERT ON
        CONFLICT DO UPDATE).  Contains only engine-owned rows
        (``source='inferred'``).  The caller must NOT touch rows with
        non-engine sources.
    to_retract : list[UUID]
        ``absence_id`` values of existing ``'inferred'`` rows that are no
        longer supported by the current evidence.  The application layer
        should DELETE these rows.  The caller must verify ``source`` before
        deleting — this list only ever contains ``'inferred'`` row ids.
    skipped_no_data : list[UUID]
        investigation_id values that were in the absent set but had no
        overlapping observation layer.  Informational only — no action
        needed; the absence is UNKNOWN, not ABSENT.
    """

    to_write: list[AbsenceToWrite] = field(default_factory=list)
    to_retract: list[UUID] = field(default_factory=list)
    skipped_no_data: list[UUID] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _intervals_overlap(top_a: float, base_a: float, top_b: float, base_b: float) -> bool:
    """Return True when ``[top_a, base_a]`` and ``[top_b, base_b]`` overlap.

    Both intervals are closed (endpoints are inclusive).  A single shared
    point (base_a == top_b or vice versa) counts as overlap.

    The overlap-ratio threshold ``MIN_OVERLAP_RATIO`` is checked here.
    When it is 0 (the default) any geometric overlap returns True.

    Parameters
    ----------
    top_a, base_a : float
        First interval (top < base, positive downwards).
    top_b, base_b : float
        Second interval.

    Returns
    -------
    bool
        True when the intervals have a non-empty intersection given the
        configured minimum overlap ratio.
    """
    overlap_top = max(top_a, top_b)
    overlap_base = min(base_a, base_b)
    overlap_length = overlap_base - overlap_top
    if overlap_length < 0.0:
        return False
    if MIN_OVERLAP_RATIO == 0.0:
        # Any shared point (overlap_length >= 0) counts.
        return True
    body_length = base_a - top_a
    if body_length <= 0.0:
        return overlap_length >= 0.0
    return (overlap_length / body_length) >= MIN_OVERLAP_RATIO


def _has_different_lithology(
    layers: list[ObservationLayerRecord],
    body_top_m: float,
    body_base_m: float,
    formation_soil_code: str | None,
) -> bool:
    """Return True when any layer overlapping the body's depth band has a different soil code.

    A layer "has a different lithology" when its ``main_soil_codes`` list
    is non-empty and at least one code differs from ``formation_soil_code``.

    If ``formation_soil_code`` is None the engine cannot evaluate a
    difference, so it returns False (no inference without a reference code).

    Parameters
    ----------
    layers : list[ObservationLayerRecord]
        All observation layers for a single investigation.
    body_top_m : float
        Top of the body's depth range (metres positive downwards).
    body_base_m : float
        Base of the body's depth range.
    formation_soil_code : str | None
        The expected main soil code for this formation.  None → no inference.

    Returns
    -------
    bool
        True when positive evidence of a different lithology exists.
    """
    if formation_soil_code is None:
        return False
    for layer in layers:
        if not _intervals_overlap(body_top_m, body_base_m, layer.top_m, layer.base_m):
            continue
        if not layer.main_soil_codes:
            # Layer has no lithology recorded — skip (not evidence of anything).
            continue
        # Any code that differs from the formation's expected code is a mismatch.
        if any(code != formation_soil_code for code in layer.main_soil_codes):
            return True
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def infer_formation_absences(
    *,
    formation_id: UUID,
    formation_soil_code: str | None,
    body_contacts: list[BodyContactRecord],
    corridor_investigations: list[tuple[UUID, str]],
    observation_layers: list[ObservationLayerRecord],
    existing_absences: list[FormationAbsenceRecord],
) -> InferenceResult:
    """Compute which ``formation_absence`` rows should be written or retracted.

    This is the core of the Position 4 inference engine.  Call it after
    every correlation-edge mutation or observation-data mutation that
    affects a formation body.

    The function is **idempotent**: calling it twice with the same inputs
    produces the same output.

    Parameters
    ----------
    formation_id : UUID
        Primary key of the geological_formation this body belongs to.
    formation_soil_code : str | None
        The expected main soil code for this formation
        (``GeologicalFormationOrm.litho_main_soil_code`` — e.g. ``'ZAND'``,
        ``'KLEI'``, ``'SILT'``, ``'GRIND'``, ``'VEEN'``).  When None the
        engine produces no inferred absences (no reference to compare
        against).
    body_contacts : list[BodyContactRecord]
        All contacts for this specific body (already filtered to the body
        identified by ``(formation_id, body_ordinal)``).  May be empty for
        a newly created body.
    corridor_investigations : list[tuple[UUID, str]]
        All investigations in the corridor (``(investigation_id,
        investigation_kind)`` pairs), regardless of whether they have a
        contact for this body or not.  Defines the full candidate set for
        absence inference.
    observation_layers : list[ObservationLayerRecord]
        All observation layers for all corridor investigations (the caller
        may pass a superset; the engine filters by investigation_id).
        Covers boreholes and — in Phase 5 — CPT Robertson-SBT layers.
    existing_absences : list[FormationAbsenceRecord]
        All currently persisted absence rows for this ``formation_id`` and
        the corridor's investigations.  Used to compute the delta between
        prior inference output and current.

    Returns
    -------
    InferenceResult
        ``to_write``: absence rows to UPSERT.
        ``to_retract``: ids of stale ``'inferred'`` rows to DELETE.
        ``skipped_no_data``: absent investigations with no overlapping layer.

    Notes
    -----
    The engine NEVER writes or modifies rows with a non-engine source
    (``'manual'``, ``'observed'``).  It also never retracts those rows.
    The application layer must enforce this: ``to_retract`` contains only
    ids of ``'inferred'`` rows.

    Positive-evidence guard: an investigation without any observation layers
    overlapping the body's depth band produces a ``skipped_no_data`` entry,
    not a ``to_write`` entry.  UNKNOWN ≠ ABSENT.
    """
    result = InferenceResult()

    # ------------------------------------------------------------------
    # 1. Identify present vs absent investigations for this body.
    # ------------------------------------------------------------------
    present_inv_keys: set[tuple[UUID, str]] = {
        (c.investigation_id, c.investigation_kind) for c in body_contacts
    }
    absent_inv_keys: list[tuple[UUID, str]] = [
        (inv_id, inv_kind)
        for inv_id, inv_kind in corridor_investigations
        if (inv_id, inv_kind) not in present_inv_keys
    ]

    # ------------------------------------------------------------------
    # 2. Compute the body's depth range from present contacts.
    #
    # depth_top_m values from contacts: min = shallowest top, max = deepest top.
    # In the absence of a base column (not stored), we approximate the body's
    # extent as [min_depth, max_depth] across all present contacts.  This is
    # conservative but correct for the overlap check: if the body tops out at
    # 5 m at one borehole and 8 m at another, the "depth band" where the body
    # COULD appear at an absent column is approximately [5, 8].
    # ------------------------------------------------------------------
    if not body_contacts:
        # Body has collapsed — no contacts means no body identity exists.
        # An inferred absence is only meaningful relative to a body; when the
        # body is gone, every previously-inferred row for this formation is
        # now stale evidence of a relationship that no longer holds. Retract
        # them. ``'manual'`` and ``'observed'`` rows are preserved — the engine
        # never owns those (the standard non-retraction guarantee for non-engine
        # sources still applies). See debt #132 — uncorrelate gestures collapse
        # body_contacts to empty and used to leak inferred rows forever.
        result.to_retract = [a.absence_id for a in existing_absences if a.source == "inferred"]
        return result

    depths = [c.depth_top_m for c in body_contacts]
    body_top_m = min(depths)
    body_base_m = max(depths)

    # Degenerate case: all contacts at exactly the same depth.
    # Give a 0.5 m band so single-borehole bodies can still match an
    # overlapping layer.  The 0.5 m value is arbitrary but geologically
    # reasonable for a thin litho unit at one location.
    if body_base_m <= body_top_m:
        body_base_m = body_top_m + 0.5

    # ------------------------------------------------------------------
    # 3. Build lookup: (investigation_id, investigation_kind) → layers.
    # ------------------------------------------------------------------
    layers_by_inv: dict[tuple[UUID, str], list[ObservationLayerRecord]] = {}
    for layer in observation_layers:
        key = (layer.investigation_id, layer.investigation_kind)
        layers_by_inv.setdefault(key, []).append(layer)

    # ------------------------------------------------------------------
    # 4. Build a lookup of existing absences for this formation.
    # ------------------------------------------------------------------
    # key = (investigation_id, investigation_kind)
    existing_by_key: dict[tuple[UUID, str], FormationAbsenceRecord] = {
        (r.investigation_id, r.investigation_kind): r for r in existing_absences
    }

    # ------------------------------------------------------------------
    # 5. Compute the target set: investigations where the engine WANTS
    #    to write an 'inferred' absence.
    # ------------------------------------------------------------------
    wanted_keys: set[tuple[UUID, str]] = set()
    for inv_id, inv_kind in absent_inv_keys:
        inv_layers = layers_by_inv.get((inv_id, inv_kind), [])
        if _has_different_lithology(inv_layers, body_top_m, body_base_m, formation_soil_code):
            wanted_keys.add((inv_id, inv_kind))
        else:
            # No positive evidence → UNKNOWN; track for informational output.
            result.skipped_no_data.append(inv_id)

    # ------------------------------------------------------------------
    # 6. Compute delta.
    #
    # to_write: every wanted key, provided the existing row (if any) is
    #   engine-owned or absent.  User-owned rows (non-'inferred') are skipped
    #   silently — user intent is preserved.
    # to_retract: existing 'inferred' rows whose key is no longer in wanted_keys.
    # ------------------------------------------------------------------
    for inv_id, inv_kind in wanted_keys:
        key = (inv_id, inv_kind)
        existing = existing_by_key.get(key)
        if existing is not None and existing.source not in ENGINE_OWNED_SOURCES:
            # User-owned row — do not overwrite.
            continue
        result.to_write.append(
            AbsenceToWrite(
                formation_id=formation_id,
                investigation_id=inv_id,
                investigation_kind=inv_kind,
                source=SOURCE_INFERRED,
            )
        )

    for key, existing in existing_by_key.items():
        if existing.source not in ENGINE_OWNED_SOURCES:
            continue  # never retract user-owned rows
        if key not in wanted_keys:
            result.to_retract.append(existing.absence_id)

    return result
