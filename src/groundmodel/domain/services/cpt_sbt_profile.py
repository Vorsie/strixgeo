"""Per-depth soil-behaviour-type profile for one CPT — BOTH classifiers.

Owner ruling (dogfeed 2026-08-03): a per-CPT plot surface shows the full
normalised Robertson-2015 pipeline's zone-per-depth strip (which carries the
extended organic/peat boundary of Lengkeek & Brinkgreve 2022) AND the
non-normalised ``I_SBT`` strip alongside it.  Showing one alone hides the
disagreement, and it is exactly the disagreement — shallow, or where the
effective-stress profile is unreliable — that the engineer needs to see.

This module is a THIN DRIVER.  It owns no soil mechanics of its own:

* ``robertson_2015`` — the frozen normalised Robertson (2009/2015) method.  Driven
  here exactly as the litho segmenter drives it (stress profile → iterative
  Qtn/F/Ic convergence → zone ladder) and under the SAME inputs — water table
  AND unit weights — so the zones the engineer reads and the ghost boundaries
  he is offered come from one pipeline.  Pinned by
  ``tests/unit/application/test_gwt_source_parity.py``.  NOT extended.
* ``robertson_sbt_non_normalised`` — the published closed-form ``I_SBT``.

**Phase 4 scope carve-out (CLAUDE.md).** SBT zone is a CHARACTERISATION output
shown to the engineer, never a committed design parameter.  Nothing here is
persisted; the profile is derived on read (Data Integrity Rule 1) and carries
the water table it was derived under.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.gwt_resolution import GwtProvenance, ResolvedGwt
from groundmodel.domain.services.robertson_2015 import (
    qtn_f_ic_series,
    sbt_zone_series,
    stress_profile,
)
from groundmodel.domain.services.robertson_2015_constants import (
    DEFAULT_GUNSAT_KNM3,
    DEFAULT_GWATER_KNM3,
)
from groundmodel.domain.services.robertson_sbt_non_normalised import i_sbt, i_sbt_to_zone


@dataclass(frozen=True)
class SbtProfile:
    """Both SBT classifications for one CPT, aligned on a single depth axis.

    Every list has the same length as ``depths_m``.  ``None`` marks a depth
    point the classifier could not evaluate (missing sleeve friction, or a
    non-positive net cone resistance near the surface) — never a filled-in
    guess.

    Attributes
    ----------
    depths_m : list[float]
        Measurement depths in metres below ground surface, ascending.
    ic : list[float | None]
        Normalised soil-behaviour-type index Ic (Robertson 2015 pipeline).
    zone_normalised : list[int | None]
        Robertson (2009) chart zone 1–9 from the full normalised pipeline,
        including the extended organic/peat outcome.
    i_sbt : list[float | None]
        Non-normalised soil-behaviour-type index I_SBT (Robertson 2010).
    zone_non_normalised : list[int | None]
        SBT zone 2–7 from ``I_SBT``.  Zones 1, 8 and 9 are not identifiable
        from the index alone and are never emitted.
    gwt_m : float
        Depth to groundwater below ground surface used for the normalised
        pipeline, in metres.
    gwt_source : GwtProvenance
        Where ``gwt_m`` came from — ``"recorded"`` / ``"engineer"`` /
        ``"assumed"``.  The non-normalised column does not use it at all.
    """

    depths_m: list[float]
    ic: list[float | None]
    zone_normalised: list[int | None]
    i_sbt: list[float | None]
    zone_non_normalised: list[int | None]
    gwt_m: float
    gwt_source: GwtProvenance


def compute_sbt_profile(
    depths_m: Sequence[float],
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
    gwt: ResolvedGwt,
    gunsat_kNm3: float = DEFAULT_GUNSAT_KNM3,
    gwater_kNm3: float = DEFAULT_GWATER_KNM3,
) -> SbtProfile:
    """Classify a CPT series with both Robertson classifiers, per depth point.

    Parameters
    ----------
    depths_m : Sequence[float]
        Measurement depths in metres below ground surface, ascending.
    qc_mpa : Sequence[float]
        Cone resistance in MPa, parallel to ``depths_m``.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa; ``None`` rows are unclassifiable in both
        columns (no friction ratio → no index).
    gwt : ResolvedGwt
        The groundwater depth to normalise against plus its provenance, from
        ``gwt_resolution.resolve_gwt``.  Passed in rather than resolved here so
        the caller cannot end up with a profile whose label and whose maths
        disagree.
    gunsat_kNm3 : float
        Unit weight of soil above the water table in kN/m³.  Must be the same
        value the litho segmenter is driven with (Settings → Litho segmenter),
        or the strip and the ghost boundaries normalise against different
        effective stresses.
    gwater_kNm3 : float
        Unit weight of water in kN/m³, same parity requirement.

    Returns
    -------
    SbtProfile
        Both zone series, both indices, and the water-table provenance.
    """
    # Truncate to the shortest column BEFORE anything reads an index. The GEF
    # importer always writes equal-length arrays, but a ``.strix`` restore
    # (``_apply_json_to_kwargs``) accepts whatever the bundle carries, and a
    # ragged one must degrade to "classified the rows we have" rather than
    # raising IndexError out of a GET. Truncating here (not in each loop) also
    # keeps every output list parallel to ``depths_m``, which is the contract
    # the renderer draws on.
    n_points = min(len(depths_m), len(qc_mpa), len(fs_mpa))
    depths = list(depths_m[:n_points])
    qc = list(qc_mpa[:n_points])
    fs = list(fs_mpa[:n_points])
    if not depths:
        return SbtProfile(
            depths_m=[],
            ic=[],
            zone_normalised=[],
            i_sbt=[],
            zone_non_normalised=[],
            gwt_m=gwt.gwt_m,
            gwt_source=gwt.source,
        )

    # --- Normalised pipeline (identical drive to ``ic_series_2015``) ---
    # The stress profile takes ABSOLUTE elevations, but the only quantity that
    # selects between its three water-position branches is ``niveau - yw``.
    # niveau=0 / yw=-gwt makes that difference the depth to water without
    # needing a surveyed collar — CPTs imported from DOV have none.
    stress = stress_profile(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=fs,
        niveau_m=0.0,
        yw_m=-gwt.gwt_m,
        gunsat_kNm3=gunsat_kNm3,
        gwater_kNm3=gwater_kNm3,
    )
    qtn_results = qtn_f_ic_series(
        depths_m=depths,
        qc_mpa=qc,
        fs_mpa=fs,
        stress=stress,
    )
    ic = [r.ic if r is not None else None for r in qtn_results]
    zone_normalised = sbt_zone_series(qtn_results)

    # --- Non-normalised classifier (no stress profile, no water table) ---
    # Zipped, mirroring ``sbt_zone_series_non_normalised``'s own loop — the
    # index-per-row form is what made a ragged column a 500 instead of a
    # shorter answer.
    i_sbt_values: list[float | None] = []
    zone_non_normalised: list[int | None] = []
    for qc_k, fs_k in zip(qc, fs):
        value = i_sbt(qc_k, fs_k)
        i_sbt_values.append(value)
        zone_non_normalised.append(i_sbt_to_zone(value) if value is not None else None)

    return SbtProfile(
        depths_m=depths,
        ic=ic,
        zone_normalised=zone_normalised,
        i_sbt=i_sbt_values,
        zone_non_normalised=zone_non_normalised,
        gwt_m=gwt.gwt_m,
        gwt_source=gwt.source,
    )
