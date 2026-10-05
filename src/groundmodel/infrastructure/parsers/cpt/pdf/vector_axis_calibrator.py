"""VectorAxisCalibrator: calibrate a CPT graph page from its text layer and grid."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.colour_helpers import matches_colour
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.grid_line_helpers import (
    best_label_shift,
    grid_positions,
    long_grid_lines,
)
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile import LayoutProfile
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants import (
    UNIT_TO_STORAGE_FACTOR,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    AXIS_LABEL_BELOW_PT,
    AXIS_LABEL_REACH_PT,
    COLOUR_AXIS_SHARE,
    GRID_SNAP_TOLERANCE_PT,
    GRID_WALK_TOLERANCE_PT,
    MIN_CURVE_SEGMENTS,
    PDF_POINTS,
    UNIT_PATTERN,
    UNIT_REACH_PT,
)
from groundmodel.infrastructure.parsers.cpt.pdf.sounding_block_reader import SoundingBlockReader
from groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation import TickOrientation
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run import TickRun
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import TickRunFinder
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content import VectorPageContent
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import phrases
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class VectorAxisCalibrator(GroundModelLogger):
    """Build a :class:`PageCalibration` from tick labels, axis words and grid lines.

    1. Tick labels form runs (:class:`TickRunFinder`); a horizontal run is a
       value axis, a vertical run a depth / elevation axis.
    2. Each horizontal run is named by the nearest axis word ("Conusweerstand"
       -> qc) and gets its unit from the label ("(MPa)", "kPa", "%").
    3. Label centres are snapped to the long grid lines they sit on, and the
       scale is refitted on those exact positions.
    4. The frame is the extent of the grid lines at the axis ends.
    5. Depth vs elevation follows from the direction: depth grows downward,
       elevation falls; the ground level comes from the sounding block.

    Parameters
    ----------
    profile : LayoutProfile
        The company layout profile.
    """

    def __init__(self, profile: LayoutProfile) -> None:
        super().__init__(__name__)
        self._profile = profile
        self._runs = TickRunFinder()
        self._reader = VectorPageReader()
        self._block = SoundingBlockReader()

    def calibrate(
        self,
        page: pymupdf.Page,
        page_number: int | None = None,
        content: VectorPageContent | None = None,
        meta_words: Sequence[PageWord] | None = None,
        tick_words: Sequence[PageWord] | None = None,
    ) -> PageCalibration:
        """Return the calibration of one CPT graph page.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        page_number : int or None
            1-based page number for the result (defaults to the page's own).
        content : VectorPageContent or None
            Pre-read page content (saves a second read).
        meta_words : sequence of PageWord or None
            Words for axis names and the sounding block (never for tick
            values). None = the text layer's own words; the OCR of the title
            strips when the text layer is unreadable.

        tick_words : sequence of PageWord or None
            Words the tick labels are read from. None = the text layer; the
            OCR of the whole page when the labels are not text (fonts
            converted to outlines).

        Returns
        -------
        PageCalibration
            Panels in PDF points.

        Raises
        ------
        ValueError
            When no value axis or no depth axis is found.
        """
        number = page_number if page_number is not None else page.number + 1
        content = content or self._reader.read(page)
        self.debug("calibrate page %d with profile %s", number, self._profile.name)
        runs = self._runs.find(content.words if tick_words is None else tick_words)
        meta_words = list(content.words if meta_words is None else meta_words)
        label_phrases = phrases(meta_words)
        v_lines, h_lines = long_grid_lines(content)
        assumptions: list[str] = []

        depth_run, depth_ref = self._pick_depth_run(runs)
        if depth_run is None:
            raise ValueError(f"page {number}: no depth axis found among {len(runs)} tick runs")
        depth_scale, depth_note = _fit(depth_run, h_lines, vertical=True)
        assumptions.append(f"vertical axis: {depth_ref.value}; {depth_note}")

        panels: list[PanelCalibration] = []
        horizontal = [r for r in runs if r.orientation is TickOrientation.HORIZONTAL]
        named = {id(r): self._name_run(r, label_phrases) for r in horizontal}
        # Longest axes first: when names come from curve colours, the full
        # qc axis must claim the blue curve before the short inclination axis
        # printed inside the same panel.
        for run in sorted(horizontal, key=lambda r: r.end - r.start, reverse=True):
            kind, unit = named[id(run)]
            if kind is None:
                kind = self._kind_by_colour(run, content, depth_run, {p.kind for p in panels})
                unit = self._profile.default_units.get(kind, "") if kind else ""
                if kind is not None:
                    assumptions.append(
                        f"{kind.value} axis named by its curve colour (no readable label)"
                    )
            if kind is None or any(p.kind is kind for p in panels):
                continue
            value_scale, note = _fit(run, v_lines, vertical=False)
            frame = _frame(value_scale, run, v_lines, depth_run)
            panels.append(
                PanelCalibration(
                    kind=kind,
                    frame=frame,
                    value_scale=value_scale,
                    depth_scale=depth_scale,
                    unit=unit,
                    to_storage_factor=UNIT_TO_STORAGE_FACTOR.get(unit, 1.0),
                    curve_colour=self._profile.curve_colours.get(kind),
                    source="text-layer",
                    assumptions=(note,),
                )
            )
        if not panels:
            raise ValueError(f"page {number}: no named value axis among {len(runs)} tick runs")

        fields = self._block.read(meta_words, self._profile.field_labels)
        ground = SoundingBlockReader.number(fields.get("ground_level"))
        if depth_ref is DepthReference.ELEVATION:
            if ground is None:
                assumptions.append("elevation axis but no ground level found: depth not derivable")
            else:
                assumptions.append(f"depth = ground level {ground:.2f} m - elevation")
        calibration = PageCalibration(
            page_number=number,
            coordinate_space=PDF_POINTS,
            dpi=None,
            depth_reference=depth_ref,
            panels=tuple(panels),
            ground_level_m=ground,
            sounding_id=fields.get("sounding_id"),
            profile_name=self._profile.name,
            assumptions=tuple(assumptions),
        )
        self.info(
            "page %d calibrated: %s, %s axis, sounding %s, ground %s",
            number,
            ", ".join(
                f"{p.kind.value} {p.value_scale.value_min:g}..{p.value_scale.value_max:g} {p.unit}"
                for p in panels
                if p.value_scale
            ),
            depth_ref.value,
            calibration.sounding_id,
            ground,
        )
        return calibration

    def _pick_depth_run(self, runs: list[TickRun]) -> tuple[TickRun | None, DepthReference]:
        """Choose the vertical axis: depth grows downward, elevation falls."""
        vertical = [r for r in runs if r.orientation is TickOrientation.VERTICAL]
        depth = [r for r in vertical if r.values[-1] > r.values[0]]
        elevation = [r for r in vertical if r.values[-1] < r.values[0]]
        prefer = self._profile.preferred_depth_reference
        order = (
            [(elevation, DepthReference.ELEVATION), (depth, DepthReference.DEPTH_BELOW_GROUND)]
            if prefer is DepthReference.ELEVATION
            else [(depth, DepthReference.DEPTH_BELOW_GROUND), (elevation, DepthReference.ELEVATION)]
        )
        for candidates, ref in order:
            if candidates:
                return max(candidates, key=lambda r: len(r.values)), ref
        return None, DepthReference.DEPTH_BELOW_GROUND

    def _kind_by_colour(
        self,
        run: TickRun,
        content: VectorPageContent,
        depth_run: TickRun,
        taken: set[PanelKind],
    ) -> PanelKind | None:
        """Name an axis by the profile curve colour drawn over its span.

        The axis claims a colour when at least half of that colour's curve
        segments lie within its x-span (a short axis inside a panel claims
        none) and the colour is not taken yet. An axis printed below the plot
        prefers the profile's bottom-axis quantity (u2 on Van der Straaten).
        """
        seg = content.segments
        if len(seg) == 0:
            return None
        mid_x = (seg[:, 0] + seg[:, 2]) / 2
        mid_y = (seg[:, 1] + seg[:, 3]) / 2
        in_depth = (mid_y >= depth_run.start - 20) & (mid_y <= depth_run.end + 20)
        wide = content.widths >= self._profile.min_curve_width
        scores: list[tuple[int, PanelKind]] = []
        for kind, colour in self._profile.curve_colours.items():
            if kind in taken:
                continue
            match = matches_colour(content.colours, colour) & wide & in_depth
            total = int(match.sum())
            inside = int((match & (mid_x >= run.start - 2) & (mid_x <= run.end + 2)).sum())
            if total >= MIN_CURVE_SEGMENTS and inside >= COLOUR_AXIS_SHARE * total:
                scores.append((inside, kind))
        if not scores:
            return None
        below_plot = run.cross > (depth_run.start + depth_run.end) / 2
        preferred = self._profile.bottom_axis_kind
        if below_plot and preferred is not None and any(k is preferred for _, k in scores):
            return preferred
        return max(scores, key=lambda s: s[0])[1]

    def _name_run(self, run: TickRun, words: list[PageWord]) -> tuple[PanelKind | None, str]:
        """Name a horizontal run by its nearest axis phrase; read its unit."""
        best: tuple[float, float, PageWord, PanelKind] | None = None
        cross = run.cross
        for word in words:
            kind = self._profile.kind_of_label(word.text)
            if kind is None:
                continue
            dy = word.cy - cross
            if dy < -AXIS_LABEL_REACH_PT or dy > AXIS_LABEL_BELOW_PT:
                continue
            gap = max(0.0, run.start - word.x1, word.x0 - run.end)
            cost = gap + 2.0 * abs(dy)
            tie = abs(word.x0 - run.start)
            if best is None or (cost, tie) < (best[0], best[1]):
                best = (cost, tie, word, kind)
        if best is None:
            return None, ""
        label = best[2]
        unit = self._profile.default_units.get(best[3], "")
        # The unit is part of the label phrase ("Conusweerstand (MPa)") or
        # the next phrase on its line.
        for phrase in sorted(words, key=lambda w: w.x0):
            same_line = abs(phrase.cy - label.cy) < 3.0
            if same_line and (phrase is label or 0 <= phrase.x0 - label.x1 < UNIT_REACH_PT):
                match = UNIT_PATTERN.search(phrase.text)
                if match:
                    unit = match.group(0)
                    break
        return best[3], unit


def _fit(run: TickRun, lines: np.ndarray, vertical: bool) -> tuple[AxisScale, str]:
    """Fit a scale on a run, snapping label centres to the grid lines under them.

    The candidate lines and the label shift come from :mod:`grid_line_helpers`
    (shared with the triage's graph-frame test).
    """
    positions = grid_positions(run, lines, vertical)
    best = best_label_shift(run.coords, positions)
    if best is not None:
        coords = np.asarray(run.coords, dtype=float)
        snapped_c: list[float] = []
        snapped_v: list[float] = []
        for c, value in zip(coords, run.values, strict=True):
            k = int(np.argmin(np.abs(positions - (c + best))))
            if abs(positions[k] - (c + best)) <= GRID_SNAP_TOLERANCE_PT:
                snapped_c.append(float(positions[k]))
                snapped_v.append(value)
        if len(set(snapped_v)) >= 2:
            note = f"{len(snapped_v)}/{len(run.values)} ticks snapped to grid lines"
            if abs(best) > GRID_SNAP_TOLERANCE_PT / 3:
                note += f" (labels sit {best:+.1f} pt off their lines)"
            return AxisScale.fit(snapped_c, snapped_v), note
    return (
        AxisScale.fit(run.coords, run.values),
        "fitted on label centres (no grid lines to snap to)",
    )


def _frame(
    value_scale: AxisScale, run: TickRun, v_lines: np.ndarray, depth_run: TickRun
) -> FrameRect:
    """Return the panel frame: axis ends in x, grid-line extent in y."""
    xa = value_scale.coord_of(value_scale.value_min)
    xb = value_scale.coord_of(value_scale.value_max)
    x0, x1 = min(xa, xb), max(xa, xb)
    reach = AXIS_LABEL_REACH_PT + 15.0
    near_run = (v_lines[:, 1] <= run.bottom + reach) & (v_lines[:, 2] >= run.top - reach)
    # When only some tick labels were read (OCR merged "121416"), the ticks
    # span part of the panel: walk on along the grid, one tick pitch at a
    # time, while a grid line is there.
    steps = np.abs(np.diff(run.values))
    if len(steps) and len(v_lines):
        pitch = abs(value_scale.coord_of(float(np.median(steps))) - value_scale.coord_of(0.0))
        xs = v_lines[near_run, 0]

        def has_line(x: float) -> bool:
            return bool(np.any(np.abs(xs - x) <= GRID_WALK_TOLERANCE_PT))

        while has_line(x1 + pitch):
            x1 += pitch
        while has_line(x0 - pitch):
            x0 -= pitch
    at_ends = (np.abs(v_lines[:, 0] - x0) <= 1.0) | (np.abs(v_lines[:, 0] - x1) <= 1.0)
    at_ends &= near_run
    if at_ends.any():
        y0 = float(v_lines[at_ends, 1].min())
        y1 = float(v_lines[at_ends, 2].max())
    else:
        y0, y1 = depth_run.start, depth_run.end
    return FrameRect(x0, y0, x1, y1)
