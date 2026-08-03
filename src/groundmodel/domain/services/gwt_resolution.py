"""Single resolver for "which water table did this derived value use?".

Every Robertson-2015 consumer normalises against an effective-stress profile,
and that profile needs a groundwater depth.  Three consumers need one:

* the Ic curve behind ``GET /cpt/{id}/plot``,
* the litho segmenter's ghost boundaries (``SuggestLithoContacts``),
* the SBT profile behind ``GET /cpt/{id}/sbt-profile``.

If any two of them resolved the depth differently, the engineer would validate
boundaries against a curve computed on a different effective-stress profile
than the one that proposed them — and neither surface would say so.  So the
fallback lives here once, and the resolver also reports the PROVENANCE of the
number it picked (Data Integrity Rule 1: a surface showing a derived value must
be able to say what it was derived from).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from groundmodel.domain.services.robertson_2015_constants import DEFAULT_GWT_DEPTH_M
from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource

# The three provenance labels a UI may show. Deliberately NOT the stored
# ``WaterDepthSource`` enum: "assumed" is the absence of a stored value, so it
# has no column representation, and "gef" is an implementation detail the
# engineer does not care about ("recorded" is what he reads).
GwtProvenance = Literal["recorded", "engineer", "assumed"]


@dataclass(frozen=True)
class ResolvedGwt:
    """The groundwater depth a derivation used, plus where it came from.

    Attributes
    ----------
    gwt_m : float
        Depth to groundwater below ground surface in metres (positive down).
    source : GwtProvenance
        ``"recorded"`` — parsed from the investigation file.
        ``"engineer"`` — typed by the engineer, outranks the file.
        ``"assumed"``  — nothing recorded; ``DEFAULT_GWT_DEPTH_M`` was used.
    """

    gwt_m: float
    source: GwtProvenance


def resolve_gwt(
    water_depth_m: float | None,
    water_depth_source: str | None,
) -> ResolvedGwt:
    """Resolve a CPT's groundwater depth and the provenance of that number.

    Parameters
    ----------
    water_depth_m : float | None
        The row's stored water-table depth below ground surface in metres.
        ``None`` means no water table is recorded for this investigation —
        every DOV-imported CPT is in that state.
    water_depth_source : str | None
        The row's stored ``WaterDepthSource`` token, or ``None`` for a row
        written before the provenance column existed.  Only consulted when a
        depth is present.

    Returns
    -------
    ResolvedGwt
        The depth to use and its provenance label.
    """
    if water_depth_m is None:
        # No record → the ONE project-wide assumption, shared by every
        # consumer. Reporting it as "assumed" is what keeps the UI honest.
        return ResolvedGwt(gwt_m=DEFAULT_GWT_DEPTH_M, source="assumed")
    if water_depth_source == WaterDepthSource.ENGINEER.value:
        return ResolvedGwt(gwt_m=water_depth_m, source="engineer")
    # Anything else with a depth is file-derived: the parser is the only other
    # writer of this column, and a legacy row (NULL source) can only have come
    # from the parser too.
    return ResolvedGwt(gwt_m=water_depth_m, source="recorded")
