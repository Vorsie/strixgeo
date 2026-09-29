"""One triaxial sub-specimen with every measuring point of its shear phase."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TriaxialSpecimen:
    """One sub-specimen ("deelmonster") of a triaxial test.

    Channels are parallel lists, one value per measuring point, keyed by the
    canonical names in ``triaxial_constants``. ``measured`` holds what the
    machine logged; ``lab_derived`` what the lab software computed from it.

    Parameters
    ----------
    specimen_id : str
        The lab's specimen letter (``"a"``, ``"b"``, ``"c"``).
    point_numbers : list[int]
        The lab's measuring-point numbers; the first is the chosen zero reading.
    measured : dict[str, list[float or None]]
        Force (N), displacement (µm), cell and pore pressure (kPa) and — for
        drained tests — volume change (cm3), each ABOVE the zero reading as
        Geosys wrote them.
    lab_derived : dict[str, list[float or None]]
        Strain and the stress columns the lab computed (pass-through).
    unclassified : dict[str, list[float or None]]
        Columns whose header label is not in either map, keyed by the label.
    strain_rate_mm_per_min : float or None
        Set axial displacement rate.
    initial_height_mm, initial_diameter_mm, initial_wet_mass_g : float or None
        Specimen before the test.
    grain_density_t_m3 : float or None
        Grain density (labelled "Volumemassa" in the dump).
    consolidation_stress_kpa : float or None
        Effective consolidation stress (UU: the cell pressure).
    consolidation_volume_change_cm3 : float or None
        Volume change during consolidation.
    final_wet_mass_g, dry_mass_g, final_volume_change_cm3 : float or None
        After-test values.
    failure_description : str or None
        Failure mode / shear-plane angle, verbatim ("breuk 2 / 57 °").
    area_before_mm2, volume_before_mm3, volume_after_mm3 : float or None
        Geometry as listed.
    import_file, calibration_file, press_id : str or None
        Machine import kind, calibration file and load frame, verbatim.
    calibration : dict[str, tuple[float or None, float or None]]
        Per channel word (``"kracht"``, ``"verplaatsing"`` …) its (a, b).
    raw : dict[str, list[str]]
        Every header label → its value cells as read.
    """

    specimen_id: str
    point_numbers: list[int] = field(default_factory=list)
    measured: dict[str, list[float | None]] = field(default_factory=dict)
    lab_derived: dict[str, list[float | None]] = field(default_factory=dict)
    unclassified: dict[str, list[float | None]] = field(default_factory=dict)
    strain_rate_mm_per_min: float | None = None
    initial_height_mm: float | None = None
    initial_diameter_mm: float | None = None
    initial_wet_mass_g: float | None = None
    grain_density_t_m3: float | None = None
    consolidation_stress_kpa: float | None = None
    consolidation_volume_change_cm3: float | None = None
    final_wet_mass_g: float | None = None
    dry_mass_g: float | None = None
    final_volume_change_cm3: float | None = None
    failure_description: str | None = None
    area_before_mm2: float | None = None
    volume_before_mm3: float | None = None
    volume_after_mm3: float | None = None
    import_file: str | None = None
    calibration_file: str | None = None
    press_id: str | None = None
    calibration: dict[str, tuple[float | None, float | None]] = field(default_factory=dict)
    raw: dict[str, list[str]] = field(default_factory=dict)
