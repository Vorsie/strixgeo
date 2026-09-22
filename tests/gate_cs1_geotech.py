"""Real-data gate for the geotech subdivision correctness on CS1.

Why this exists
---------------
Synthetic unit tests cannot reproduce the full geometry of Cross-section 1
in ``test.strix``.  This gate reads a JSON snapshot extracted from the dev DB
(by ``scripts/extract_cs1_geotech_gate.py`` after
``scripts/rematerialise_dev_geotech.py``) and asserts four structural
invariants on the REAL materialised geotech model.

Input
-----
``scripts/cs1_geotech_gate.json`` — gitignored; regenerate before running::

    uv run python scripts/rematerialise_dev_geotech.py
    uv run python scripts/extract_cs1_geotech_gate.py

Gate activation
---------------
The test is SKIPPED unless the environment variable ``CS1_GEOTECH_GATE=1`` is
set AND the input JSON exists.  This keeps normal ``uv run pytest tests/unit``
runs fast and unaffected by whether the dev DB is running.

Run::

    CS1_GEOTECH_GATE=1 uv run pytest tests/gate_cs1_geotech.py -v

Invariants checked
------------------
1. **litho≠class == 0** — No CPT or borehole geotech band whose formation's
   NAD-class lithology family (1-4 → GRIND, 5-12 → ZAND, 13-20 → SILT,
   21-28 → KLEI, 29-31 → VEEN) differs from the formation's
   ``litho_main_soil_code``.  A mismatch means a sand band was labelled with
   a clay class (or vice versa), which is a hard correctness defect.

2. **no CPT band with usable qc coverage has a null class** — A null
   ``nad_class`` on a CPT band is a DELIBERATE answer, not a failure, when the
   qc gives nothing to derive a class from (owner rule 2026-07-25): the cone
   read nothing inside the band's interval, or the valid readings leave a
   material gap (>40 % of the thickness, or a ≥5 cm continuous run of bad
   readings — a coarser sampling interval is not a gap).  Both are
   "needs review", and the segmenter says so rather than asserting the loosest
   packing class from no evidence.  What would still be a hard defect is a null
   class on a band the qc DOES cover — that means the segmenter or materialiser
   failed.  The gate therefore joins each null CPT band against the CPT series
   over its own interval and asserts the coverage genuinely fails the
   segmenter's own thresholds.  Boreholes carry no qc at all and are excluded.

3. **every sample assigned** — Every borehole sample in the CS1 corridor has
   a non-null ``geotech_assignment_source`` that is not ``"unresolved"``.
   Unresolved means the sample's midpoint fell outside every litho-body extent
   on the borehole, which should not happen after a correct DivideBoreholes run.

4. **no sample litho-contradiction** — Each assigned sample's geotech NAD
   class family == the borehole's accepted litho layer soil code at the sample
   midpoint depth.  A contradiction means a sand sample got stamped with a
   clay packing class.  Samples whose midpoint has no covering litho layer
   (legitimately outside the modelled range) are excluded.

IMPORTANT — JSON must be regenerated after any code change
----------------------------------------------------------
The gate reads the JSON file as a static snapshot.  If you change the
subdivision logic, run the rematerialise + extract scripts again before running
this gate; stale JSON will produce misleading results.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.services.geotech_subdivision import (
    QC_REVIEW_MAX_GAP_M,
    QC_REVIEW_MISSING_FRACTION,
)

_INPUT = Path(__file__).parent.parent / "scripts" / "cs1_geotech_gate.json"
_GATE_VAR = "CS1_GEOTECH_GATE"

_skip = pytest.mark.skipif(
    os.environ.get(_GATE_VAR) != "1" or not _INPUT.exists(),
    reason=(
        f"Set {_GATE_VAR}=1 and regenerate {_INPUT.name} to run this gate. "
        "Run: scripts/rematerialise_dev_geotech.py then "
        "scripts/extract_cs1_geotech_gate.py"
    ),
)

# NAD class → lithology family (Belgian NAD table ANB Tabel 2.1).
# Groups are EXCLUSIVE and complete across 1-31.
_NAD_CLASS_TO_FAMILY: dict[int, str] = {
    **{c: "GRIND" for c in range(1, 5)},
    **{c: "ZAND" for c in range(5, 13)},
    **{c: "SILT" for c in range(13, 21)},
    **{c: "KLEI" for c in range(21, 29)},
    **{c: "VEEN" for c in range(29, 32)},
}


def _load() -> dict[str, Any]:
    """Load the gate JSON from disk.

    Returns
    -------
    dict[str, Any]
        Parsed gate JSON with ``meta``, ``bands``, ``litho_bh_bands``, and
        ``samples`` keys.
    """
    data = json.loads(_INPUT.read_text())
    # Guard against a vacuous pass: an empty extract (geotech model not
    # materialised, or a stale/blank JSON) would make every "== 0 violations"
    # assertion trivially true. Require real CS1 content.
    assert data.get("bands"), (
        "Gate input has no bands — regenerate it before trusting the gate: "
        "uv run python scripts/rematerialise_dev_geotech.py "
        "then uv run python scripts/extract_cs1_geotech_gate.py"
    )
    assert data.get("samples"), (
        "Gate input has no samples — regenerate it (see the bands message above)."
    )
    return data


def _nad_family(nad_class: int | None) -> str | None:
    """Return the lithology family for a NAD class, or None when nad_class is None.

    Parameters
    ----------
    nad_class : int | None
        NAD packing class (1–31), or None for an unclassified band.

    Returns
    -------
    str | None
        One of ``"GRIND"``, ``"ZAND"``, ``"SILT"``, ``"KLEI"``, ``"VEEN"``
        when nad_class is not None, else None.
    """
    if nad_class is None:
        return None
    return _NAD_CLASS_TO_FAMILY.get(nad_class)


@_skip
def test_litho_ne_class_zero() -> None:
    """No geotech band's NAD-class family should differ from its litho soil code.

    Both CPT and borehole bands are checked: the formation's
    ``litho_main_soil_code`` (e.g. "ZAND") must match the family implied by
    ``nad_class`` (e.g. class 7 → ZAND family).  A mismatch is a hard
    correctness defect — a peat band cannot carry a gravel class.

    Bands with ``nad_class = None`` (skeleton / unclassified) are excluded
    because they carry no family commitment.
    """
    data = _load()
    violations: list[str] = []
    for band in data["bands"]:
        nc = band["nad_class"]
        if nc is None:
            continue
        family = _nad_family(nc)
        soil = band["litho_main_soil_code"]
        if soil is None:
            continue
        if family != soil:
            violations.append(
                f"band {band['layer_id']} inv={band['inv_id']} "
                f"kind={band['kind']} nad={nc} (family={family}) "
                f"but litho_main_soil_code={soil!r}"
            )

    assert len(violations) == 0, (
        f"litho≠class violations on {len(violations)} geotech band(s):\n"
        + "\n".join(violations[:10])
        + ("\n  ... (truncated)" if len(violations) > 10 else "")
    )


@_skip
def test_null_class_on_a_cpt_band_means_the_qc_could_not_classify_it() -> None:
    """A CPT band may only be unclassified where its own qc gives no answer.

    ``suggest_geotech_subdivision`` returns ``nad_class=None`` for exactly two
    conditions, both of them "needs review, do not guess" (owner rule
    2026-07-25):

    * no cone reading at all inside the band's depth interval — a contact placed
      above the CPT's first sample, or a sliver from the geo-bounding divide;
    * valid qc missing over a material span — more than
      ``QC_REVIEW_MISSING_FRACTION`` of the thickness, or a continuous run of
      bad readings at least ``QC_REVIEW_MAX_GAP_M`` long. Depth the cone never
      sampled (a coarser interval, a rod-change jump) is coverage limit, not a
      gap, and contributes nothing.

    Any OTHER null class on a CPT band is the defect this invariant guards: the
    band is covered by usable qc and still came back unclassified, which means
    the segmenter or the materialiser failed.

    The extract carries the same three coverage numbers the segmenter decided
    on, computed with the segmenter's own helpers over each band's interval, so
    this check asks the real question rather than the proxy "is it null".
    """
    data = _load()
    null_cpt = [b for b in data["bands"] if b["kind"] == "cpt" and b["nad_class"] is None]

    stale = [b for b in null_cpt if "qc_missing_fraction" not in b]
    assert not stale, (
        f"{len(stale)} null-class CPT band(s) carry no qc-coverage fields — the gate "
        "JSON predates this invariant. Regenerate it: uv run python "
        "scripts/rematerialise_dev_geotech.py then uv run python "
        "scripts/extract_cs1_geotech_gate.py"
    )

    unjustified = [
        b
        for b in null_cpt
        if b["qc_valid_samples_in_band"] > 0
        and b["qc_missing_fraction"] <= QC_REVIEW_MISSING_FRACTION
        and b["qc_max_gap_m"] < QC_REVIEW_MAX_GAP_M
    ]
    assert len(unjustified) == 0, (
        f"{len(unjustified)} CPT geotech band(s) have nad_class=null although their "
        f"qc covers them:\n"
        + "\n".join(
            f"  band {b['layer_id']} inv={b['inv_id']} "
            f"depth=[{b['depth_top_m']},{b['depth_base_m']}] "
            f"valid_qc={b['qc_valid_samples_in_band']}/{b['qc_samples_in_band']} "
            f"missing={b['qc_missing_fraction']:.3f} max_gap={b['qc_max_gap_m']:.3f} m"
            for b in unjustified[:10]
        )
        + ("\n  ... (truncated)" if len(unjustified) > 10 else "")
    )

    # Not an assertion: how many bands legitimately need review is a property of
    # the data, not of the code. Print it so a jump in the number is visible.
    print(f"\n  {len(null_cpt)} CPT band(s) unclassified for want of usable qc (all justified)")


@_skip
def test_every_sample_assigned() -> None:
    """Every CS1 corridor borehole sample must be assigned to a geotech band.

    After DivideBoreholes, each sample should have a non-null
    ``geotech_assignment_source`` that is not ``"unresolved"``.  An
    unresolved sample means its midpoint fell outside every litho-body extent
    on the borehole, which is a defect when the borehole has accepted litho
    layers at that depth.
    """
    data = _load()
    unassigned = [
        s
        for s in data["samples"]
        if s["geotech_assignment_source"] is None or s["geotech_assignment_source"] == "unresolved"
    ]
    assert len(unassigned) == 0, (
        f"{len(unassigned)} sample(s) without a valid geotech assignment:\n"
        + "\n".join(
            f"  sample {s['id']} bh={s['borehole_id']} "
            f"depth=[{s['depth_top_m']},{s['depth_base_m']}] "
            f"source={s['geotech_assignment_source']!r}"
            for s in unassigned[:10]
        )
        + ("\n  ... (truncated)" if len(unassigned) > 10 else "")
    )


@_skip
def test_no_sample_litho_contradiction() -> None:
    """Each sample's geotech NAD class family must equal the borehole's observed litho.

    For every assigned sample in the CS1 corridor:
    1. Find the borehole's accepted litho layer at the sample midpoint depth
       (from the litho model, not the geotech model).
    2. Map the sample's geotech_nad_class to its lithology family.
    3. Assert family == litho_main_soil_code of that layer.

    Samples whose midpoint has no covering litho layer (outside the modelled
    range, or within a gap between layers) are excluded — they have no litho
    ground-truth to check against.  Samples with nad_class=None are also
    excluded (skeleton bands carry no family commitment).
    """
    data = _load()

    # Build a lookup: borehole_id → list of (top, base, soil_code) sorted top→base.
    litho_by_bh: dict[str, list[tuple[float, float, str | None]]] = {}
    for lb in data["litho_bh_bands"]:
        bh_id = lb["bh_id"]
        litho_by_bh.setdefault(bh_id, []).append(
            (lb["depth_top_m"], lb["depth_base_m"], lb["litho_main_soil_code"])
        )

    def _litho_at_midpoint(bh_id: str, top: float, base: float) -> str | None:
        """Return the litho soil code at the sample midpoint, or None if none covers it."""
        mid = (top + base) / 2.0
        for lt, lb, soil in litho_by_bh.get(bh_id, []):
            if lt <= mid <= lb:
                return soil
        return None

    violations: list[str] = []
    excluded_no_litho = 0
    excluded_null_nc = 0
    checked = 0

    for sample in data["samples"]:
        nc = sample["geotech_nad_class"]
        source = sample["geotech_assignment_source"]
        if source is None or source == "unresolved":
            continue  # Already caught by test_every_sample_assigned.
        if nc is None:
            excluded_null_nc += 1
            continue

        litho_soil = _litho_at_midpoint(
            sample["borehole_id"], sample["depth_top_m"], sample["depth_base_m"]
        )
        if litho_soil is None:
            excluded_no_litho += 1
            continue

        family = _nad_family(nc)
        checked += 1
        if family != litho_soil:
            violations.append(
                f"sample {sample['id']} bh={sample['borehole_id']} "
                f"depth=[{sample['depth_top_m']},{sample['depth_base_m']}] "
                f"nad={nc} (family={family}) but litho={litho_soil!r}"
            )

    print(
        f"\n  Checked {checked} samples; excluded_no_litho={excluded_no_litho} "
        f"excluded_null_nc={excluded_null_nc}"
    )
    assert len(violations) == 0, (
        f"{len(violations)} sample(s) have geotech class contradicting observed litho:\n"
        + "\n".join(violations[:10])
        + ("\n  ... (truncated)" if len(violations) > 10 else "")
    )
