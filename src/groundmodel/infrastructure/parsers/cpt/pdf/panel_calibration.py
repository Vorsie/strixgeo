"""PanelCalibration: frame + two linear scales for one graph panel."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind


@dataclass(frozen=True)
class PanelCalibration:
    """Everything needed to turn a point inside one panel into (depth, value).

    This is the "overlay that puts the axes correctly": a frame the UI can draw
    and let the user drag, a value scale along x and a depth scale along y,
    each held as two anchors the user can nudge or type. A raster panel whose
    labels could not be read starts as a :meth:`draft` with the scales unset;
    extraction refuses it until the user supplies them.

    Parameters
    ----------
    kind : PanelKind
        The quantity plotted.
    frame : FrameRect
        The plot frame in the page's coordinate space.
    value_scale : AxisScale or None
        x -> value (in ``unit``); None until known.
    depth_scale : AxisScale or None
        y -> vertical-axis value (depth or elevation, see the page's
        ``depth_reference``); None until known.
    unit : str
        The unit printed on the axis ("MPa", "kPa", "%").
    to_storage_factor : float
        Multiplier from ``unit`` to the unit Strix stores (kPa -> MPa is
        0.001; 1.0 otherwise).
    curve_colour : tuple of float or None
        RGB (0..1) of the curve in this panel, when known.
    source : str
        Where the scales came from: "text-layer", "ocr", "user" or "draft".
    assumptions : tuple of str
        Every assumption made while calibrating, for the report and the UI.
    """

    kind: PanelKind
    frame: FrameRect
    value_scale: AxisScale | None
    depth_scale: AxisScale | None
    unit: str = ""
    to_storage_factor: float = 1.0
    curve_colour: tuple[float, float, float] | None = None
    source: str = "text-layer"
    assumptions: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_complete(self) -> bool:
        """Return whether both scales are known (extraction can run)."""
        return self.value_scale is not None and self.depth_scale is not None

    @property
    def max_value_edge(self) -> float:
        """Return the x of the frame edge that carries the axis maximum.

        A curve drawn on this edge is clipped: its true value is at least the
        value there. Uses the frame, not the outermost tick label, because the
        labels read (by OCR) may cover only part of the axis.

        Raises
        ------
        ValueError
            When the value scale is unknown.
        """
        if self.value_scale is None:
            raise ValueError(f"{self.kind.value} panel has no value scale")
        left = self.value_scale.value_at(self.frame.x0)
        right = self.value_scale.value_at(self.frame.x1)
        return self.frame.x1 if right > left else self.frame.x0

    @classmethod
    def draft(
        cls,
        kind: PanelKind,
        frame: FrameRect,
        unit: str = "",
        curve_colour: tuple[float, float, float] | None = None,
    ) -> PanelCalibration:
        """Return a panel with a frame but no scales (awaiting the user).

        Parameters
        ----------
        kind : PanelKind
            The quantity plotted.
        frame : FrameRect
            The detected frame.
        unit : str
            The axis unit, if known.
        curve_colour : tuple of float or None
            The curve colour, if known.

        Returns
        -------
        PanelCalibration
            A draft calibration.
        """
        return cls(
            kind=kind,
            frame=frame,
            value_scale=None,
            depth_scale=None,
            unit=unit,
            curve_colour=curve_colour,
            source="draft",
            assumptions=("axis values not read; the user must type two ticks per axis",),
        )

    @classmethod
    def from_user_ticks(
        cls,
        kind: PanelKind,
        frame: FrameRect,
        value_ticks: tuple[tuple[float, float], tuple[float, float]],
        depth_ticks: tuple[tuple[float, float], tuple[float, float]],
        unit: str = "",
        to_storage_factor: float = 1.0,
        curve_colour: tuple[float, float, float] | None = None,
    ) -> PanelCalibration:
        """Build a panel from two user-placed ticks per axis.

        This is the whole calibration contract of the future UI: drag the
        frame corners, drop two markers on labelled grid lines per axis and
        type their values.

        Parameters
        ----------
        kind : PanelKind
            The quantity plotted.
        frame : FrameRect
            The frame the user settled on.
        value_ticks : pair of (x, value)
            Two horizontal-axis ticks.
        depth_ticks : pair of (y, value)
            Two vertical-axis ticks (depth or elevation).
        unit : str
            Axis unit.
        to_storage_factor : float
            Multiplier from ``unit`` to the stored unit.
        curve_colour : tuple of float or None
            The curve colour to trace.

        Returns
        -------
        PanelCalibration
            A complete calibration with ``source="user"``.
        """
        (x_a, v_a), (x_b, v_b) = value_ticks
        (y_a, d_a), (y_b, d_b) = depth_ticks
        return cls(
            kind=kind,
            frame=frame,
            value_scale=AxisScale(x_a, v_a, x_b, v_b),
            depth_scale=AxisScale(y_a, d_a, y_b, d_b),
            unit=unit,
            to_storage_factor=to_storage_factor,
            curve_colour=curve_colour,
            source="user",
        )

    def scaled(self, factor: float) -> PanelCalibration:
        """Return the panel in a coordinate space ``factor`` times larger.

        Parameters
        ----------
        factor : float
            E.g. ``dpi / 72`` from PDF points to image pixels.

        Returns
        -------
        PanelCalibration
            The same calibration in the new space.
        """
        return replace(
            self,
            frame=self.frame.scaled(factor),
            value_scale=self.value_scale.scaled(factor) if self.value_scale else None,
            depth_scale=self.depth_scale.scaled(factor) if self.depth_scale else None,
        )

    def to_dict(self) -> dict[str, Any]:
        """Return the panel as a plain dict (JSON-ready for the UI)."""
        return {
            "kind": self.kind.value,
            "frame": self.frame.to_dict(),
            "value_scale": self.value_scale.to_dict() if self.value_scale else None,
            "depth_scale": self.depth_scale.to_dict() if self.depth_scale else None,
            "unit": self.unit,
            "to_storage_factor": self.to_storage_factor,
            "curve_colour": list(self.curve_colour) if self.curve_colour else None,
            "source": self.source,
            "assumptions": list(self.assumptions),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PanelCalibration:
        """Rebuild a panel from :meth:`to_dict` output.

        Parameters
        ----------
        data : dict
            The dict form.

        Returns
        -------
        PanelCalibration
            The panel.
        """
        colour = data.get("curve_colour")
        return cls(
            kind=PanelKind(data["kind"]),
            frame=FrameRect.from_dict(data["frame"]),
            value_scale=AxisScale.from_dict(data["value_scale"])
            if data.get("value_scale")
            else None,
            depth_scale=AxisScale.from_dict(data["depth_scale"])
            if data.get("depth_scale")
            else None,
            unit=str(data.get("unit", "")),
            to_storage_factor=float(data.get("to_storage_factor", 1.0)),
            curve_colour=(float(colour[0]), float(colour[1]), float(colour[2])) if colour else None,
            source=str(data.get("source", "text-layer")),
            assumptions=tuple(data.get("assumptions", ())),
        )
