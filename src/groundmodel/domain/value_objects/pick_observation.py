"""One contact pick as an (x, y, elevation) observation for the geostatistics."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PickObservation:
    """A formation-top pick at one investigation.

    Attributes
    ----------
    contact_id : str
        The ``formation_contact`` id.
    investigation_id : str
        The CPT or borehole id.
    investigation_kind : str
        ``"cpt"`` or ``"borehole"``.
    investigation_name : str
        Display name of the test (e.g. ``GEO-02/146-B16``).
    x_m, y_m : float
        Position in the project's horizontal CRS (m).
    elevation_m : float
        Contact elevation (m TAW) = ground elevation - pick depth.
    noise_floor_m : float
        Smallest pick standard deviation allowed for this source (m).
    """

    contact_id: str
    investigation_id: str
    investigation_kind: str
    investigation_name: str
    x_m: float
    y_m: float
    elevation_m: float
    noise_floor_m: float
