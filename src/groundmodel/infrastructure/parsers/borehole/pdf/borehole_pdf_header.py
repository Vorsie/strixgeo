"""BoreholePdfHeader: the header of one digitised borehole, merged over its sheets."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class BoreholePdfHeader:
    """Header fields of a borehole read from a PDF, parallel to ``Borehole``.

    Every value is what the sheets print; nothing is guessed. Phase 2 maps
    it onto ``Borehole`` (name, location_x/y, epsg, elevation_m, z_epsg,
    total_depth_m, start_date, executor, water_table_depth_m).

    Parameters
    ----------
    name : str
        "Boring:" value.
    x, y : float or None
        Printed position.
    epsg : int or None
        System the coordinate labels name (31370 for "Lambert72"); None when
        not named.
    ground_level_m : float or None
        Ground level (header), else the first printed level.
    z_epsg : int or None
        Vertical datum the header names (5710 for "mTAW").
    ground_level_source : str or None
        ``"header"`` or ``"first-level"``.
    total_depth_m : float or None
        Deepest interval base.
    date_text, date_iso : str or None
        Printed date and its ISO form.
    driller : str or None
        "Uitvoering door" / "Boormeester" value.
    project_code, project_name, remark : str or None
        As printed.
    surface_text : str
        Text printed above the first rule of the first sheet (the surface
        cover: "asfalt", "akker"), raw.
    identification_standard : str or None
        The identification standard the sheets name ("NEN-EN-ISO 14688").
    raw_fields : dict
        Field name -> ``{"label", "value"}`` as printed, first sheet that
        prints it.
    """

    name: str
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    ground_level_m: float | None = None
    z_epsg: int | None = None
    ground_level_source: str | None = None
    total_depth_m: float | None = None
    date_text: str | None = None
    date_iso: str | None = None
    driller: str | None = None
    project_code: str | None = None
    project_name: str | None = None
    remark: str | None = None
    surface_text: str = ""
    identification_standard: str | None = None
    raw_fields: dict[str, dict[str, str]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return the header as a JSON-ready dict."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BoreholePdfHeader:
        """Return the header a :meth:`to_dict` dict describes.

        Parameters
        ----------
        data : dict
            From :meth:`to_dict`.

        Returns
        -------
        BoreholePdfHeader
            The header.
        """
        return cls(**data)
