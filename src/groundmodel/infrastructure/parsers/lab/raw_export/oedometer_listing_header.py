"""Sample identity and specimen metadata of an oedometer control listing."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class OedometerListingHeader:
    """Header of an incremental-loading oedometer control listing (all pass-through).

    Parameters
    ----------
    job_number : str or None
        "Opdrachtnummer" — the lab job, e.g. ``"GEO-19/122"``.
    origin : str or None
        "Herkomst en kenmerk" — site text.
    borehole_name : str or None
        "Boringnummer" — the borehole as the lab names it (``"B7A"``).
    sequence_number : str or None
        "Volgnummer" — sample sequence in the borehole (``"N002"``).
    sample_number : str or None
        "Monsternummer" — the lab sample number (``"20/0568"``).
    depth_top_m, depth_base_m : float or None
        "Diepte ontname" — sampling interval, m below ground.
    visual_description : str or None
        "Grondsoort op zicht" — the lab's visual description.
    initial_height_mm, diameter_mm, wet_mass_g : float or None
        Specimen dimensions and mass as listed.
    water_content_pct, grain_density_t_m3, bulk_density_t_m3 : float or None
        Index values as listed.
    grain_density_note : str or None
        How the grain density was obtained, verbatim (the control listing and
        the results listing disagree on this for the same test).
    apparatus_number : str or None
        "Apparaatnummer" — oedometer frame.
    lever_ratio : float or None
        "Overbrengingsverhouding kracht".
    dial_coefficient_mm_per_unit : float or None
        "Coëff. meethorloge".
    mounting_date : datetime.date or None
        "Inbouwdatum monster".
    remarks : str or None
        "Opmerkingen".
    source_filename : str or None
        The lab program's native file the listing was rendered from.
    source_saved_at : str or None
        The save timestamp printed after the file name, verbatim.
    program_version : str or None
        The lab program's version and build date.
    created_mark, modified_mark : str or None
        The lab's creation / last-modified stamps, verbatim.
    raw : dict[str, str]
        Every header label → value as read, for fields not promoted above.
    """

    job_number: str | None = None
    origin: str | None = None
    borehole_name: str | None = None
    sequence_number: str | None = None
    sample_number: str | None = None
    depth_top_m: float | None = None
    depth_base_m: float | None = None
    visual_description: str | None = None
    initial_height_mm: float | None = None
    diameter_mm: float | None = None
    wet_mass_g: float | None = None
    water_content_pct: float | None = None
    grain_density_t_m3: float | None = None
    grain_density_note: str | None = None
    bulk_density_t_m3: float | None = None
    apparatus_number: str | None = None
    lever_ratio: float | None = None
    dial_coefficient_mm_per_unit: float | None = None
    mounting_date: date | None = None
    remarks: str | None = None
    source_filename: str | None = None
    source_saved_at: str | None = None
    program_version: str | None = None
    created_mark: str | None = None
    modified_mark: str | None = None
    raw: dict[str, str] = field(default_factory=dict)
