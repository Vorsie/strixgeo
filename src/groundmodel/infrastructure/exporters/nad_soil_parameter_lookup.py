"""Resolve a section unit to its NAD characteristic soil parameters, or nothing.

Both Deltares exporters ask the same question of every unit they emit — does
the owner's NAD table carry parameters for this unit's packing class? — so the
lookup is a shared pure function rather than a copy in each (CLAUDE.md "don't
repeat logic"). It reads :data:`NAD_SOIL_PARAMETERS` through its module so a
test can swap the table with ``monkeypatch.setattr`` and the resolution follows.

Absent by default: the shipped table is empty, so this returns ``None`` for
every class until the owner transcribes the workbook. A ``None`` tells the
exporter to write the soil with no parameters — GEOLib's blank initial values —
never an invented default.
"""

from __future__ import annotations

from groundmodel.application.section_polygon_set import SectionPolygonUnit
from groundmodel.domain.services import nad_soil_parameters_constants


def soil_parameters_for_unit(
    unit: SectionPolygonUnit,
) -> nad_soil_parameters_constants.NadSoilParameters | None:
    """Return the NAD characteristic parameters for a unit, or ``None``.

    Parameters
    ----------
    unit : SectionPolygonUnit
        The section unit being exported. Only its ``nad_class`` is read.

    Returns
    -------
    NadSoilParameters | None
        The characteristic parameters for the unit's NAD packing class, or
        ``None`` when the unit has no NAD class (a geological formation or a
        litho unit) or when its class has not been transcribed into
        ``NAD_SOIL_PARAMETERS`` yet.
    """
    if unit.nad_class is None:
        return None
    # Read through the module (not a bound name) so a monkeypatched table
    # is honoured, and so the empty shipped table resolves to None cleanly.
    return nad_soil_parameters_constants.NAD_SOIL_PARAMETERS.get(unit.nad_class)
