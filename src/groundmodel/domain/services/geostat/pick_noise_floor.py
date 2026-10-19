"""Smallest pick standard deviation per investigation kind (owner ruling 2026-10-19)."""

from __future__ import annotations

from groundmodel.domain.services.geostat.geostat_constants import PICK_NOISE_FLOOR_M


def pick_noise_floor_m(investigation_kind: str) -> float:
    """Return the noise floor (m) of a pick on this kind of investigation.

    Parameters
    ----------
    investigation_kind : str
        ``"cpt"`` or ``"borehole"``.

    Returns
    -------
    float
        Floor standard deviation (m).

    Raises
    ------
    ValueError
        For a kind without a ruled floor.
    """
    try:
        return PICK_NOISE_FLOOR_M[investigation_kind]
    except KeyError as exc:
        raise ValueError(
            f"no pick noise floor for investigation kind {investigation_kind!r}; "
            f"known kinds: {sorted(PICK_NOISE_FLOOR_M)}"
        ) from exc
