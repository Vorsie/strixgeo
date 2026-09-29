"""PageCalibration: the calibration of every panel of one CPT graph page."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import IMAGE_PIXELS, PDF_POINTS


@dataclass(frozen=True)
class PageCalibration:
    """One page's panels plus what the vertical axis means.

    Parameters
    ----------
    page_number : int
        1-based page number in the report.
    coordinate_space : str
        ``"pdf-pt"`` (text-layer / vector calibration) or ``"image-px"``
        (raster calibration on an image rendered at ``dpi``).
    dpi : float or None
        Render resolution for ``image-px``; None for ``pdf-pt``.
    depth_reference : DepthReference
        Whether the vertical axis is depth below ground or elevation.
    panels : tuple of PanelCalibration
        One entry per panel / axis found.
    ground_level_m : float or None
        Ground level against the vertical datum (m TAW), read from the
        sounding block; converts elevation to depth.
    sounding_id : str or None
        The sounding's id as printed on the sheet.
    profile_name : str
        The layout profile used.
    assumptions : tuple of str
        Page-level assumptions (datum, ground level source, ...).
    """

    page_number: int
    coordinate_space: str
    dpi: float | None
    depth_reference: DepthReference
    panels: tuple[PanelCalibration, ...]
    ground_level_m: float | None = None
    sounding_id: str | None = None
    profile_name: str = "generic"
    assumptions: tuple[str, ...] = field(default_factory=tuple)

    def panel(self, kind: PanelKind) -> PanelCalibration:
        """Return the (first) panel of a kind.

        Parameters
        ----------
        kind : PanelKind
            The quantity wanted.

        Returns
        -------
        PanelCalibration
            The panel.

        Raises
        ------
        KeyError
            When the page has no such panel.
        """
        for p in self.panels:
            if p.kind is kind:
                return p
        raise KeyError(f"page {self.page_number} has no {kind.value} panel")

    def has_panel(self, kind: PanelKind) -> bool:
        """Return whether the page has a panel of a kind.

        Parameters
        ----------
        kind : PanelKind
            The quantity.

        Returns
        -------
        bool
            True when present.
        """
        return any(p.kind is kind for p in self.panels)

    @classmethod
    def for_image(
        cls,
        page_number: int,
        dpi: float,
        panels: list[PanelCalibration],
        depth_reference: DepthReference,
        ground_level_m: float | None = None,
        sounding_id: str | None = None,
    ) -> PageCalibration:
        """Build a calibration in image-pixel space (raster path, user input).

        Parameters
        ----------
        page_number : int
            1-based page number.
        dpi : float
            Resolution of the image the pixel coordinates refer to.
        panels : list of PanelCalibration
            The panels.
        depth_reference : DepthReference
            What the vertical axis measures.
        ground_level_m : float or None
            Ground level (m TAW), needed for an elevation axis.
        sounding_id : str or None
            Sounding id, when known.

        Returns
        -------
        PageCalibration
            The calibration.
        """
        return cls(
            page_number=page_number,
            coordinate_space=IMAGE_PIXELS,
            dpi=dpi,
            depth_reference=depth_reference,
            panels=tuple(panels),
            ground_level_m=ground_level_m,
            sounding_id=sounding_id,
        )

    def to_image_space(self, dpi: float) -> PageCalibration:
        """Return a PDF-point calibration expressed on an image at ``dpi``.

        Parameters
        ----------
        dpi : float
            The render resolution.

        Returns
        -------
        PageCalibration
            The calibration in pixels.

        Raises
        ------
        ValueError
            When the calibration is already in image space.
        """
        if self.coordinate_space != PDF_POINTS:
            raise ValueError("calibration is already in image space")
        factor = dpi / 72.0
        return replace(
            self,
            coordinate_space=IMAGE_PIXELS,
            dpi=dpi,
            panels=tuple(p.scaled(factor) for p in self.panels),
        )

    def to_dict(self) -> dict[str, Any]:
        """Return the calibration as a plain dict (JSON-ready for the UI)."""
        return {
            "page_number": self.page_number,
            "coordinate_space": self.coordinate_space,
            "dpi": self.dpi,
            "depth_reference": self.depth_reference.value,
            "panels": [p.to_dict() for p in self.panels],
            "ground_level_m": self.ground_level_m,
            "sounding_id": self.sounding_id,
            "profile_name": self.profile_name,
            "assumptions": list(self.assumptions),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PageCalibration:
        """Rebuild a calibration from :meth:`to_dict` output.

        Parameters
        ----------
        data : dict
            The dict form.

        Returns
        -------
        PageCalibration
            The calibration.
        """
        return cls(
            page_number=int(data["page_number"]),
            coordinate_space=str(data["coordinate_space"]),
            dpi=float(data["dpi"]) if data.get("dpi") is not None else None,
            depth_reference=DepthReference(data["depth_reference"]),
            panels=tuple(PanelCalibration.from_dict(p) for p in data["panels"]),
            ground_level_m=(
                float(data["ground_level_m"]) if data.get("ground_level_m") is not None else None
            ),
            sounding_id=data.get("sounding_id"),
            profile_name=str(data.get("profile_name", "generic")),
            assumptions=tuple(data.get("assumptions", ())),
        )
