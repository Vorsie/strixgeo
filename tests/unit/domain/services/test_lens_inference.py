"""Unit tests for the lens-inference engine (#101 R2).

Tests are organised around the five invariants that the engine must satisfy:

1. **Present investigations are excluded** from the absent set.
2. **Positive-evidence guard** — no observation layer overlapping the depth
   band → skipped_no_data, not to_write.
3. **Different-lithology detection** — a layer with a matching soil code does
   NOT trigger an absence; a different code does.
4. **Idempotency** — running twice with the same input produces the same
   output.
5. **User-intent preservation** — existing 'manual' / 'observed' rows are
   never in to_write or to_retract, even when the engine would normally
   infer the absence.
6. **Retraction** — an existing 'inferred' row whose key is no longer
   supported by the current evidence appears in to_retract.
7. **No contacts → collapse retracts** — a body with no contacts produces no
   to_write entries AND retracts every existing 'inferred' row (the body
   has lost its identity; the absences are evidence of a body that no
   longer exists). 'manual' / 'observed' rows are preserved.
8. **Same-code layer** — an overlapping layer whose sole code MATCHES the
   formation code does NOT trigger an absence.
9. **Multiple absent investigations** — the engine handles a batch correctly.
10. **Empty corridor** — no corridor investigations → trivially empty result.
"""

from __future__ import annotations

from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.services.lens_inference import (
    BodyContactRecord,
    FormationAbsenceRecord,
    ObservationLayerRecord,
    infer_formation_absences,
)
from groundmodel.domain.services.lens_inference_constants import (
    KIND_BOREHOLE,
    KIND_CPT,
    SOURCE_INFERRED,
    SOURCE_MANUAL,
    SOURCE_OBSERVED,
)

# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------

_FORMATION_ID: UUID = UUID("11111111-1111-1111-1111-111111111111")
_SOIL_CODE: str = "KLEI"

_BH_A: UUID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
_BH_B: UUID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
_BH_C: UUID = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")


def _contact(inv_id: UUID, depth: float = 3.0, kind: str = KIND_BOREHOLE) -> BodyContactRecord:
    """Build a BodyContactRecord with defaults."""
    return BodyContactRecord(
        investigation_id=inv_id,
        investigation_kind=kind,
        depth_top_m=depth,
    )


def _layer(
    inv_id: UUID,
    top: float,
    base: float,
    codes: list[str],
    kind: str = KIND_BOREHOLE,
) -> ObservationLayerRecord:
    """Build an ObservationLayerRecord."""
    return ObservationLayerRecord(
        investigation_id=inv_id,
        investigation_kind=kind,
        top_m=top,
        base_m=base,
        main_soil_codes=codes,
    )


def _absence(
    inv_id: UUID,
    source: str = SOURCE_INFERRED,
    kind: str = KIND_BOREHOLE,
) -> FormationAbsenceRecord:
    """Build a FormationAbsenceRecord with a fresh uuid7 id."""
    return FormationAbsenceRecord(
        absence_id=uuid7(),
        investigation_id=inv_id,
        investigation_kind=kind,
        source=source,
    )


# ---------------------------------------------------------------------------
# 1. Present investigations are excluded from the absent set
# ---------------------------------------------------------------------------


def test_present_investigation_not_inferred() -> None:
    """An investigation with a contact for this body must never appear in to_write."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE)]
    # A layer at _BH_A with a different lithology — but _BH_A is PRESENT.
    layers = [_layer(_BH_A, 2.0, 5.0, ["ZAND"])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []
    assert result.to_retract == []


# ---------------------------------------------------------------------------
# 2. Positive-evidence guard — no overlapping layer → skipped_no_data
# ---------------------------------------------------------------------------


def test_absent_no_overlapping_layer_skipped() -> None:
    """Absent investigation with no observation layer → skipped_no_data, not to_write."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # _BH_B has a layer but it is outside the body's depth range [3.0, 3.5].
    layers = [_layer(_BH_B, 10.0, 12.0, ["ZAND"])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []
    assert _BH_B in result.skipped_no_data


def test_absent_no_layers_at_all_skipped() -> None:
    """Absent investigation with no layers at all → skipped_no_data."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=[],
        existing_absences=[],
    )

    assert result.to_write == []
    assert _BH_B in result.skipped_no_data


# ---------------------------------------------------------------------------
# 3a. Different-lithology detection — matching code does NOT trigger absence
# ---------------------------------------------------------------------------


def test_overlapping_layer_same_code_not_inferred() -> None:
    """A layer whose code MATCHES the formation code does not trigger absence."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # _BH_B has KLEI at the same depth — same as formation → not an absence.
    layers = [_layer(_BH_B, 2.5, 4.0, [_SOIL_CODE])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []
    assert _BH_B in result.skipped_no_data


# ---------------------------------------------------------------------------
# 3b. Different-lithology detection — different code DOES trigger absence
# ---------------------------------------------------------------------------


def test_overlapping_layer_different_code_inferred() -> None:
    """A layer with a DIFFERENT code triggers a to_write entry."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]  # ZAND != KLEI

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert len(result.to_write) == 1
    w = result.to_write[0]
    assert w.formation_id == _FORMATION_ID
    assert w.investigation_id == _BH_B
    assert w.investigation_kind == KIND_BOREHOLE
    assert w.source == SOURCE_INFERRED


def test_layer_with_mixed_codes_any_different_triggers_absence() -> None:
    """A layer with codes [KLEI, ZAND] (mixed) also triggers absence (ZAND != KLEI)."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, [_SOIL_CODE, "ZAND"])]  # one match, one mismatch

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert len(result.to_write) == 1


# ---------------------------------------------------------------------------
# 4. Idempotency
# ---------------------------------------------------------------------------


def test_idempotent_second_run_produces_same_to_write() -> None:
    """Running the engine twice (existing 'inferred' row present) produces the
    same to_write set (UPSERT is a no-op at the DB level)."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]

    # First run (no existing absences).
    first = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )
    assert len(first.to_write) == 1

    # Simulate the DB state after the first run.
    existing = [_absence(_BH_B, source=SOURCE_INFERRED)]

    # Second run (existing 'inferred' row present).
    second = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=existing,
    )

    # Still wants to write the same row (UPSERT); nothing to retract.
    assert len(second.to_write) == 1
    assert second.to_retract == []


# ---------------------------------------------------------------------------
# 5. User-intent preservation
# ---------------------------------------------------------------------------


def test_manual_row_not_overwritten() -> None:
    """An existing 'manual' row must not appear in to_write even when the
    engine would produce the same absence."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]
    existing = [_absence(_BH_B, source=SOURCE_MANUAL)]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=existing,
    )

    assert result.to_write == []
    assert result.to_retract == []


def test_observed_row_not_overwritten() -> None:
    """An existing 'observed' row must not appear in to_write or to_retract."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]
    existing = [_absence(_BH_B, source=SOURCE_OBSERVED)]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=existing,
    )

    assert result.to_write == []
    assert result.to_retract == []


def test_manual_row_for_non_evidence_case_not_retracted() -> None:
    """A 'manual' row for a case the engine has NO evidence for is also preserved
    (user may have added it without observation support — that is valid)."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # No layers at _BH_B — engine has no evidence.
    existing = [_absence(_BH_B, source=SOURCE_MANUAL)]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=[],
        existing_absences=existing,
    )

    assert result.to_write == []
    assert result.to_retract == []


# ---------------------------------------------------------------------------
# 6. Retraction of stale 'inferred' rows
# ---------------------------------------------------------------------------


def test_stale_inferred_row_retracted() -> None:
    """An existing 'inferred' row whose evidence has been removed must be retracted."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # No layers at _BH_B anymore (data was deleted or overridden).
    absence_id = uuid7()
    existing = [
        FormationAbsenceRecord(
            absence_id=absence_id,
            investigation_id=_BH_B,
            investigation_kind=KIND_BOREHOLE,
            source=SOURCE_INFERRED,
        )
    ]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=[],
        existing_absences=existing,
    )

    assert result.to_write == []
    assert absence_id in result.to_retract


def test_inferred_row_retracted_when_layer_changes_to_same_code() -> None:
    """When a layer that was previously ZAND is corrected to KLEI, the
    'inferred' absence must be retracted (no longer different lithology)."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # Now the layer matches the formation code.
    layers = [_layer(_BH_B, 2.5, 4.0, [_SOIL_CODE])]
    absence_id = uuid7()
    existing = [
        FormationAbsenceRecord(
            absence_id=absence_id,
            investigation_id=_BH_B,
            investigation_kind=KIND_BOREHOLE,
            source=SOURCE_INFERRED,
        )
    ]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=existing,
    )

    assert result.to_write == []
    assert absence_id in result.to_retract


# ---------------------------------------------------------------------------
# 7. No contacts → no inference
# ---------------------------------------------------------------------------


def test_no_contacts_no_inference() -> None:
    """A body with no contacts and no prior absences → empty result.

    The collapse-retracts contract only retracts EXISTING inferred rows; with
    none in the input there's nothing to do. to_write stays empty (no body
    to infer for), to_retract stays empty (nothing to retract), and
    skipped_no_data stays empty (the engine returns early without examining
    the corridor — there's no body to compute against).
    """
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=[],
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []
    assert result.to_retract == []
    assert result.skipped_no_data == []


def test_no_contacts_retracts_existing_inferred_rows() -> None:
    """Body collapse (zero contacts) retracts every existing 'inferred' row.

    Scenario: a correlation edge previously gave this body two contacts; the
    inference engine wrote an inferred absence for an in-corridor investigation
    that lacked the formation. The user then uncorrelates — body_contacts goes
    to []. The pre-existing inferred row no longer has a body to reference, so
    the engine must emit it as to_retract.

    Debt #132 — pre-fix, the engine returned skipped_no_data and left the row
    in DB forever.
    """
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["KLEI"])]
    stale_absence = _absence(_BH_B, source=SOURCE_INFERRED)

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=[],
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[stale_absence],
    )

    assert result.to_write == []
    assert result.to_retract == [stale_absence.absence_id]
    assert result.skipped_no_data == []


def test_no_contacts_preserves_manual_and_observed_rows() -> None:
    """Collapse retracts ONLY 'inferred' rows — 'manual' / 'observed' survive.

    The user-intent-preservation guarantee (#101 Position 4 R6) must hold even
    when the body collapses. A user who manually marked an absence does not
    expect that record to vanish because a correlation edge elsewhere was
    removed.
    """
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["KLEI"])]
    inferred_row = _absence(_BH_A, source=SOURCE_INFERRED)
    manual_row = _absence(_BH_A, source=SOURCE_MANUAL)
    observed_row = _absence(_BH_B, source=SOURCE_OBSERVED)

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=[],
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[inferred_row, manual_row, observed_row],
    )

    assert result.to_write == []
    assert result.to_retract == [inferred_row.absence_id]
    assert result.skipped_no_data == []


# ---------------------------------------------------------------------------
# 8. Same-code layer at overlapping depth — exhaustive single-layer case
# ---------------------------------------------------------------------------


def test_layer_at_exact_boundary_same_code_not_inferred() -> None:
    """Layer top == body top (exact boundary touch) with matching code → not inferred."""
    contacts = [_contact(_BH_A, depth=5.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # Exactly at boundary [5.0, 5.5]: matching code.
    layers = [_layer(_BH_B, 5.0, 5.5, [_SOIL_CODE])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []


# ---------------------------------------------------------------------------
# 9. Multiple absent investigations in a batch
# ---------------------------------------------------------------------------


def test_multiple_absent_investigations_batch() -> None:
    """Two absent investigations with different evidence are handled independently."""
    # Body at _BH_A, depth 3.0–5.0 (two contacts).
    contacts = [_contact(_BH_A, depth=3.0), _contact(_BH_A, depth=5.0)]
    corridor = [
        (_BH_A, KIND_BOREHOLE),
        (_BH_B, KIND_BOREHOLE),
        (_BH_C, KIND_BOREHOLE),
    ]
    layers = [
        # _BH_B: ZAND at overlapping depth → should be inferred absent.
        _layer(_BH_B, 2.0, 6.0, ["ZAND"]),
        # _BH_C: KLEI (same) → not absent; engine has no evidence.
        _layer(_BH_C, 2.0, 6.0, [_SOIL_CODE]),
    ]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert len(result.to_write) == 1
    assert result.to_write[0].investigation_id == _BH_B
    assert _BH_C in result.skipped_no_data


# ---------------------------------------------------------------------------
# 10. Empty corridor
# ---------------------------------------------------------------------------


def test_empty_corridor_trivial_result() -> None:
    """No corridor investigations → empty InferenceResult."""
    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=[],
        corridor_investigations=[],
        observation_layers=[],
        existing_absences=[],
    )

    assert result.to_write == []
    assert result.to_retract == []
    assert result.skipped_no_data == []


# ---------------------------------------------------------------------------
# Depth-range edge cases
# ---------------------------------------------------------------------------


def test_single_contact_body_gets_half_metre_band() -> None:
    """A body with a single contact gets a 0.5 m synthetic depth band so
    layers right at that depth can still match."""
    contacts = [_contact(_BH_A, depth=4.0)]  # band = [4.0, 4.5]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # Layer exactly in the band: [4.2, 4.3].
    layers = [_layer(_BH_B, 4.2, 4.3, ["ZAND"])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert len(result.to_write) == 1
    assert result.to_write[0].investigation_id == _BH_B


def test_layer_just_outside_depth_band_not_inferred() -> None:
    """A layer just below the body's depth band does not trigger absence."""
    contacts = [_contact(_BH_A, depth=3.0)]  # band = [3.0, 3.5]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    # Layer starts at 3.5 — boundary is included (overlap_length >= 0), so
    # a layer at [3.5, 5.0] should overlap at the single point 3.5.
    layers = [_layer(_BH_B, 3.6, 5.0, ["ZAND"])]  # starts AFTER 3.5 → no overlap

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []


# ---------------------------------------------------------------------------
# CPT investigation_kind
# ---------------------------------------------------------------------------


def test_cpt_kind_propagated_to_absence() -> None:
    """investigation_kind='cpt' is correctly propagated to the to_write entry."""
    cpt_id = uuid7()
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (cpt_id, KIND_CPT)]
    layers = [_layer(cpt_id, 2.5, 4.0, ["ZAND"], kind=KIND_CPT)]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=_SOIL_CODE,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert len(result.to_write) == 1
    w = result.to_write[0]
    assert w.investigation_id == cpt_id
    assert w.investigation_kind == KIND_CPT


# ---------------------------------------------------------------------------
# None formation_soil_code — no inference
# ---------------------------------------------------------------------------


def test_none_soil_code_produces_no_inference() -> None:
    """When formation_soil_code is None the engine cannot evaluate a mismatch
    and produces no inferred absences."""
    contacts = [_contact(_BH_A, depth=3.0)]
    corridor = [(_BH_A, KIND_BOREHOLE), (_BH_B, KIND_BOREHOLE)]
    layers = [_layer(_BH_B, 2.5, 4.0, ["ZAND"])]

    result = infer_formation_absences(
        formation_id=_FORMATION_ID,
        formation_soil_code=None,
        body_contacts=contacts,
        corridor_investigations=corridor,
        observation_layers=layers,
        existing_absences=[],
    )

    assert result.to_write == []
    assert _BH_B in result.skipped_no_data
