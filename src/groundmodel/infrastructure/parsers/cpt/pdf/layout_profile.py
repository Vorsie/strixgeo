"""LayoutProfile: everything company-specific about a CPT sheet layout."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import DEFAULT_CAMPAIGN_CODE_PATTERN


@dataclass(frozen=True)
class LayoutProfile:
    """One company's (or one database's) CPT sheet conventions.

    Owner 2026-09-28: "every company's report will be slightly different". The
    digitiser's algorithms (tick runs, grid snap, curve tracing) are generic;
    what differs per company lives here, so a third company's report needs a
    new profile, not new code.

    Parameters
    ----------
    name : str
        Registry key ("van-der-straaten", "dov", "generic").
    fingerprint : re.Pattern or None
        Text that identifies the layout on a page; None for the generic
        fallback.
    panel_labels : dict
        PanelKind -> pattern searched in the label phrases near an axis to
        name the quantity it plots.
    curve_colours : dict
        PanelKind -> RGB (0..1) of that curve's stroke.
    default_units : dict
        PanelKind -> the unit the axis carries when the label does not say.
    field_labels : dict
        Sounding-block field ("sounding_id", "project", "location",
        "ground_level") -> pattern of its printed label; the value is the
        text to the right of the label on the same line.
    campaign_code_pattern : re.Pattern
        Pattern of the campaign code the report fingerprint is built from
        ("CAMZ-001").
    is_desk_study_source : bool
        True for a layout that only ever shows reprinted data (a DOV sheet);
        such pages are desk study whatever else they carry.
    preferred_depth_reference : DepthReference or None
        Which vertical axis to use when a sheet prints both depth and
        elevation (DOV prints both); None = take depth when present.
    min_curve_width : float
        Thinnest stroke (pt) that can be a data curve; thinner strokes of a
        curve colour are grid, hatching or arrows. Van der Straaten draws its
        grid at 0.24 pt and its curves at 0.84 pt; DOV draws everything at
        0.3 pt but keeps the grid pink, so it needs no width filter.
    bottom_axis_kind : PanelKind or None
        The quantity of a value axis printed BELOW the plot, used only when
        the axis has to be named by curve colour (unreadable labels): Van der
        Straaten prints its u2 axis there, over the qc panel.
    """

    name: str
    fingerprint: re.Pattern[str] | None
    panel_labels: dict[PanelKind, re.Pattern[str]]
    curve_colours: dict[PanelKind, tuple[float, float, float]] = field(default_factory=dict)
    default_units: dict[PanelKind, str] = field(default_factory=dict)
    field_labels: dict[str, re.Pattern[str]] = field(default_factory=dict)
    campaign_code_pattern: re.Pattern[str] = DEFAULT_CAMPAIGN_CODE_PATTERN
    is_desk_study_source: bool = False
    preferred_depth_reference: DepthReference | None = None
    min_curve_width: float = 0.5
    bottom_axis_kind: PanelKind | None = None

    def matches(self, text: str) -> bool:
        """Return whether this profile's fingerprint occurs in ``text``.

        Parameters
        ----------
        text : str
            A page's text layer.

        Returns
        -------
        bool
            True for a fingerprint hit (never for the generic profile).
        """
        return self.fingerprint is not None and self.fingerprint.search(text) is not None

    def kind_of_label(self, word: str) -> PanelKind | None:
        """Return the quantity a label phrase names, if any.

        Parameters
        ----------
        word : str
            A phrase of the text layer ("Conusweerstand (MPa)").

        Returns
        -------
        PanelKind or None
            The quantity, or None when the word names none.
        """
        for kind, pattern in self.panel_labels.items():
            if pattern.search(word):
                return kind
        return None
