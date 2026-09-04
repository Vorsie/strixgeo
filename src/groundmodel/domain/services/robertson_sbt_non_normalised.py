"""Non-normalised Robertson soil-behaviour-type classifier (I_SBT, Robertson 2010).

A SEPARATE module from ``robertson_2015`` on purpose: that module is the frozen
normalised Robertson (2009/2015) implementation and is marked "do NOT
extend". The non-normalised index is a different, simpler classifier and lives
here so the faithful port stays pristine.

What this is
------------
The normalised SBTn pipeline (``robertson_2015``) needs an effective-stress
profile (unit weights + groundwater table) and an iterative stress-exponent
convergence. The NON-normalised soil-behaviour-type index ``I_SBT`` (Robertson,
"Soil behaviour type from the CPT: an update", 2010) needs none of that — it
reads ``qc/pa`` and the friction ratio ``Rf`` directly:

``I_SBT = sqrt[(3.47 - log10(qc/pa))^2 + (log10(Rf) + 1.22)^2]``
where ``Rf = (fs/qc) * 100`` (%) and ``pa`` is atmospheric pressure (~0.1 MPa).

This is the appropriate classifier at SHALLOW depth or when the effective-stress
profile is unreliable (unknown groundwater table, made ground), because there
stress-normalisation is itself unreliable. Robertson defined ``I_SBT`` with the
SAME numeric zone-boundary values as the normalised ``Ic``, so the band → zone
mapping below mirrors the standard ``Ic`` thresholds.

**Phase 4 scope carve-out (CLAUDE.md).** Like the normalised SBT zone, the
non-normalised zone is used STRICTLY as a segmentation input for litho-model
suggestions — never committed as an engineering parameter. Zones 1, 8 and 9
cannot be identified from the index alone (they need the full chart position),
so this classifier emits only zones 2–7, which is sufficient for lithology
segmentation.

Units
-----
- qc, fs : MPa (as stored in ``cpt_series_orm``)
- pa     : MPa (default 0.1 = 100 kPa atmospheric pressure)
"""

from __future__ import annotations

import math
from collections.abc import Sequence

# Atmospheric reference pressure in MPa (100 kPa). qc/pa is dimensionless.
ATMOSPHERIC_PRESSURE_MPA = 0.1

# I_SBT band → Robertson 2010 SBT zone. Identical numeric boundaries to the
# normalised Ic thresholds (Robertson designed I_SBT that way). Smaller index =
# coarser/denser soil = higher-numbered sand zone.
_I_SBT_ZONE_BOUNDARIES: tuple[tuple[float, int], ...] = (
    (1.31, 7),  # I_SBT < 1.31      → gravelly sand to dense sand
    (2.05, 6),  # 1.31 ≤ I_SBT < 2.05 → clean sand to silty sand
    (2.60, 5),  # 2.05 ≤ I_SBT < 2.60 → silty sand to sandy silt
    (2.95, 4),  # 2.60 ≤ I_SBT < 2.95 → clayey silt to silty clay
    (3.60, 3),  # 2.95 ≤ I_SBT < 3.60 → clay to silty clay
)
_I_SBT_ORGANIC_ZONE = 2  # I_SBT ≥ 3.60 → organic soil / peat


def i_sbt(
    qc_mpa: float, fs_mpa: float | None, pa_mpa: float = ATMOSPHERIC_PRESSURE_MPA
) -> float | None:
    """Compute the non-normalised Robertson soil-behaviour-type index I_SBT.

    Parameters
    ----------
    qc_mpa : float
        Cone tip resistance in MPa.
    fs_mpa : float | None
        Sleeve friction in MPa. ``None`` (missing measurement) yields ``None``.
    pa_mpa : float
        Atmospheric reference pressure in MPa (default 0.1 = 100 kPa).

    Returns
    -------
    float | None
        The I_SBT index, or ``None`` when the result is mathematically
        undefined (qc ≤ 0, fs ≤ 0/missing, or a non-positive log argument).
    """
    if fs_mpa is None:
        return None
    if qc_mpa <= 0.0 or fs_mpa <= 0.0:
        # Rf = fs/qc → division by zero or log10 of a non-positive number.
        return None
    rf = fs_mpa / qc_mpa * 100.0
    if rf <= 0.0:
        return None
    qc_pa = qc_mpa / pa_mpa
    if qc_pa <= 0.0:
        return None
    return math.sqrt((3.47 - math.log10(qc_pa)) ** 2 + (math.log10(rf) + 1.22) ** 2)


def i_sbt_to_zone(i_sbt_value: float) -> int:
    """Map an I_SBT index to a Robertson 2010 SBT zone (2–7).

    Parameters
    ----------
    i_sbt_value : float
        The non-normalised soil-behaviour-type index.

    Returns
    -------
    int
        SBT zone in 2–7 (7 = coarsest/densest sand, 2 = organic). Zones 1, 8
        and 9 are not identifiable from the index alone and are never emitted.
    """
    for upper, zone in _I_SBT_ZONE_BOUNDARIES:
        if i_sbt_value < upper:
            return zone
    return _I_SBT_ORGANIC_ZONE


def sbt_zone_series_non_normalised(
    qc_mpa: Sequence[float],
    fs_mpa: Sequence[float | None],
) -> list[int | None]:
    """Classify a CPT series into non-normalised SBT zones, one per depth point.

    Mirrors the output shape of ``robertson_2015.sbt_zone_series`` (one zone or
    ``None`` per row, in order) so the litho segmenter can swap the two zone
    sources behind a single flag.

    Parameters
    ----------
    qc_mpa : Sequence[float]
        Cone resistance in MPa.
    fs_mpa : Sequence[float | None]
        Sleeve friction in MPa; ``None`` rows yield ``None``.

    Returns
    -------
    list[int | None]
        SBT zone (2–7) per depth point, or ``None`` where the index is
        undefined. Same length as ``qc_mpa``.
    """
    zones: list[int | None] = []
    for qc, fs in zip(qc_mpa, fs_mpa):
        value = i_sbt(qc, fs)
        zones.append(i_sbt_to_zone(value) if value is not None else None)
    return zones
