"""Cross-section PDF report exporter — debt #52 slice 1.

First slice of the project-report subsystem.  Produces a single-section
PDF on A4 portrait with:

* Title block (user-editable: title, author, notes, date)
* Project metadata table (name, EPSG, vertical datum, section name)
* Main figure: section drawing — depth × along-section distance, with
  investigation columns rendered at packed-but-nudge-capped positions
  (35 m cap per the owner directive), formation contact polylines
  connecting picks across columns, formation legend
* Location-map inset (top-right of the figure): section line in plan
  view with explicit ``L`` / ``R`` end-of-line markers and every
  investigation as a small dot
* Footer: project name + page number + generation timestamp

The engine is ReportLab (layout + text) + matplotlib (figure rendering,
headless via the Agg backend).  Both deps were added to pyproject.toml
in the same commit.

Future slices (B / C / D in debt #52) reuse this exporter's primitives
for the geometries report / full geo+litho report / full + parameters
report.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")  # headless rendering — server-side, no DISPLAY needed

import matplotlib.patches as mpatches  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from groundmodel.application.section_snapshot import (  # noqa: E402
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.pdf_layout import (  # noqa: E402
    packed_column_positions,
)
from groundmodel.infrastructure.exporters.section_pdf_report_exporter_constants import (  # noqa: E402
    COLUMN_BAND_WIDTH_M,
    COLUMN_EDGE_GAP_M,
    DEFAULT_DEPTH_M,
    DEPTH_AXIS_LABEL,
    FIG_H_INCH,
    FIG_W_INCH,
    MAP_INSET_SIZE_INCH,
)
from groundmodel.infrastructure.exporters.unit_identifier import (  # noqa: E402
    naming_identifier,
)
from groundmodel.infrastructure.exporters.unit_identifier_constants import (  # noqa: E402
    UNIT_ID_NAME_SEPARATOR,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger  # noqa: E402


@dataclass(frozen=True)
class ReportMetadata:
    """User-editable header fields for the section PDF.

    Attributes
    ----------
    title : str
        Top-of-page report title.  Default = "Cross-section: <name>".
    author : str
        Engineer / responsible party.  Default = "" (left blank).
    notes : str
        Free-text description rendered under the metadata table.
    date : datetime
        Report date.  Default = now.
    """

    title: str
    author: str = ""
    notes: str = ""
    date: datetime | None = None


class SectionPdfReportExporter(GroundModelLogger):
    """Render a SectionSnapshot + ReportMetadata to PDF bytes.

    Does NOT inherit from ``SectionExporter`` because its
    ``export(snapshot, metadata)`` signature carries a second argument
    (the user-editable header fields).  The shared logging via
    ``GroundModelLogger`` is preserved.
    """

    def __init__(self) -> None:
        """Initialise with the canonical module-path logger."""
        super().__init__(__name__)

    def export(self, snapshot: SectionSnapshot, metadata: ReportMetadata) -> bytes:
        """Serialise the section + metadata to a PDF byte blob.

        Parameters
        ----------
        snapshot : SectionSnapshot
            Pre-assembled section data (built by ``BuildSectionSnapshot``).
        metadata : ReportMetadata
            User-editable header fields.

        Returns
        -------
        bytes
            PDF document bytes.  Always starts with the ``%PDF`` magic
            header (callers can assert on this in a smoke test).
        """
        self.info(
            f"Exporting section PDF: project={snapshot.project_id} "
            f"section={snapshot.section_name} "
            f"investigations={len(snapshot.investigations)} "
            f"formations={len(snapshot.formations)}"
        )

        report_date = metadata.date or datetime.now()
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=15 * mm,
            rightMargin=15 * mm,
            topMargin=18 * mm,
            bottomMargin=18 * mm,
            title=metadata.title,
            author=metadata.author or "Strix",
        )
        styles = getSampleStyleSheet()
        story: list = []

        # --- Title + metadata table -------------------------------------
        # ``metadata.title`` is user-controlled and the export route defaults
        # it to "Cross-section: <section_name>", so an attacker-controlled
        # section name from a crafted .strix reaches here. reportlab's
        # Paragraph parses an intra-paragraph markup (``<b>``, ``<img>``,
        # ...), so raw ``<`` breaks the render and ``<img src=...>`` opens a
        # local file — XML-escape it so the markup is rendered as literal
        # text. Ordinary names carry no ``<>&`` and pass through unchanged.
        story.append(Paragraph(escape(metadata.title), styles["Title"]))
        story.append(Spacer(1, 4 * mm))
        meta_rows = [
            ["Project", snapshot.project_name],
            ["Section", snapshot.section_name],
            ["EPSG", str(snapshot.crs_epsg)],
            ["Vertical datum", snapshot.vertical_datum_label],
            ["Section length", f"{snapshot.section_length_m:.1f} m"],
            ["Author", metadata.author or "—"],
            ["Date", report_date.strftime("%Y-%m-%d")],
        ]
        meta_table = Table(meta_rows, colWidths=[35 * mm, 130 * mm])
        meta_table.setStyle(
            TableStyle(
                [
                    ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                    ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(meta_table)

        if metadata.notes:
            story.append(Spacer(1, 3 * mm))
            # Same markup surface as the title — escape the free-text notes.
            story.append(Paragraph(escape(metadata.notes), styles["BodyText"]))

        # --- Section figure --------------------------------------------
        story.append(Spacer(1, 5 * mm))
        figure_png = _render_section_figure(snapshot)
        story.append(Image(figure_png, width=180 * mm, height=130 * mm))

        # --- Build the PDF + footer -------------------------------------
        def _footer(c: canvas.Canvas, _doc: SimpleDocTemplate) -> None:
            c.saveState()
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#6b7280"))
            footer_text = (
                f"{snapshot.project_name}  ·  Section {snapshot.section_name}  "
                f"·  Generated {report_date.strftime('%Y-%m-%d %H:%M')}  "
                f"·  Page {c.getPageNumber()}"
            )
            c.drawString(15 * mm, 10 * mm, footer_text)
            c.restoreState()

        doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        self.success(
            f"Section PDF exported: {len(pdf_bytes)} bytes, section={snapshot.section_name}"
        )
        return pdf_bytes


def _render_section_figure(snapshot: SectionSnapshot) -> io.BytesIO:
    """Render the main section figure + location-map inset to a PNG buffer.

    The main axes is the section drawing (depth × along-section
    distance); the inset is the section line + investigations in plan
    view with L / R end-markers (owner directive — engineers reading
    the report need to know which end of the line corresponds to which
    end of the section drawing).

    Returns a ``BytesIO`` positioned at the start so ReportLab's
    ``Image`` can ingest it directly.
    """
    fig, ax = plt.subplots(figsize=(FIG_W_INCH, FIG_H_INCH))

    # --- Main axes: section drawing -----------------------------------
    # Compute the maximum depth for the y-axis: deepest contact OR
    # deepest investigation total_depth_m OR the default fallback.
    max_depth = DEFAULT_DEPTH_M
    for c in snapshot.contacts:
        if c.depth_m > max_depth:
            max_depth = c.depth_m
    for inv in snapshot.investigations:
        if inv.total_depth_m is not None and inv.total_depth_m > max_depth:
            max_depth = inv.total_depth_m
    # Round up to nearest 5 m for a clean axis tick.
    y_max = (int(max_depth / 5) + 1) * 5

    # Column positions via the packed helper.
    investigations = list(snapshot.investigations)
    true_xs = [inv.along_distance_m for inv in investigations]
    band_widths = [COLUMN_BAND_WIDTH_M] * len(investigations)
    nudged_xs = packed_column_positions(true_xs, band_widths, edge_gap_m=COLUMN_EDGE_GAP_M)

    # Per-investigation columns: a thin vertical line from surface to
    # its total_depth_m (or max_depth fallback) + the test name above
    # the line.
    for inv, x in zip(investigations, nudged_xs):
        depth = inv.total_depth_m if inv.total_depth_m is not None else y_max
        ax.plot([x, x], [0, depth], color="#4b5563", linewidth=0.8)
        ax.text(
            x,
            -1.0,
            inv.name,
            rotation=90,
            ha="center",
            va="bottom",
            fontsize=6,
            color="#1f2937",
        )

    # Per-formation polylines (top picks across investigations).
    contacts_by_formation: dict = {}
    for c in snapshot.contacts:
        contacts_by_formation.setdefault(c.formation_id, []).append(c)

    # Map investigation_id → nudged_x for the polyline lookup.
    nudged_by_inv = {inv.investigation_id: nudged_xs[i] for i, inv in enumerate(investigations)}

    legend_handles: list = []
    for f in snapshot.formations:
        picks = contacts_by_formation.get(f.formation_id, [])
        if len(picks) < 1:
            continue
        # Sort picks by along-section distance, mapped to nudged x.
        pts = sorted(
            [
                (nudged_by_inv.get(c.investigation_id, c.along_distance_m), c.depth_m)
                for c in picks
                if c.investigation_id in nudged_by_inv
            ],
            key=lambda p: p[0],
        )
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        colour = f.color if f.color.startswith("#") else f"#{f.color}"
        ax.plot(xs, ys, color=colour, linewidth=1.5, marker="o", markersize=3)
        # Legend label leads with the machine identifier on a classified
        # unit (debt #104) so the figure and the DXF / Plaxis artefacts
        # from the same section name the units identically. Unclassified
        # levels keep the bare display name.
        identifier = naming_identifier(
            nad_class=f.nad_class, litho_main_soil_code=f.litho_main_soil_code
        )
        label = f.name if identifier is None else f"{identifier}{UNIT_ID_NAME_SEPARATOR}{f.name}"
        legend_handles.append(mpatches.Patch(color=colour, label=label))

    ax.set_xlim(0, snapshot.section_length_m if snapshot.section_length_m > 0 else 1.0)
    ax.set_ylim(y_max, 0)  # depth increases downward
    ax.set_xlabel("Distance along section (m)", fontsize=9)
    # The figure plots DEPTH below each column's own surface (every column
    # starts at 0, every contact is drawn at ``depth_m``), so the caption must
    # not name the vertical datum — ``m TAW`` / ``m NAP`` label absolute
    # LEVELS, and reading 8 on this axis as +8 m TAW is a metres-scale error
    # (audit 2026-08-02).  The datum stays in the metadata table above the
    # figure, where it describes the project rather than the plotted values.
    ax.set_ylabel(DEPTH_AXIS_LABEL, fontsize=9)
    ax.tick_params(axis="both", labelsize=8)
    ax.grid(True, linestyle="--", linewidth=0.4, color="#e5e7eb")
    if legend_handles:
        ax.legend(handles=legend_handles, loc="lower right", fontsize=7, framealpha=0.9)

    # --- Inset: plan-view location map --------------------------------
    inset = fig.add_axes(
        [
            1.0 - (MAP_INSET_SIZE_INCH / FIG_W_INCH) - 0.005,
            1.0 - (MAP_INSET_SIZE_INCH / FIG_H_INCH) - 0.005,
            MAP_INSET_SIZE_INCH / FIG_W_INCH,
            MAP_INSET_SIZE_INCH / FIG_H_INCH,
        ]
    )
    _render_location_map(inset, snapshot, investigations)

    fig.tight_layout()
    out = io.BytesIO()
    fig.savefig(out, format="png", dpi=160)
    plt.close(fig)
    out.seek(0)
    return out


def _render_location_map(
    ax,
    snapshot: SectionSnapshot,
    investigations: list[SectionInvestigationProjection],
) -> None:
    """Render the section line + investigations + L/R markers into ``ax``.

    The map is intentionally schematic — no basemap, no real geographic
    context — because rendering a tile basemap server-side is a big
    extra dependency.  The L / R markers are the load-bearing affordance
    (owner directive 2026-05-21): they tell the engineer which end of
    the section drawing corresponds to which end of the line, which is
    not obvious from the drawing alone.
    """
    # Pull line endpoints from the snapshot. If both are at the origin
    # (test fixture default) the map shows a single point + a single
    # marker — better than crashing.
    sx, sy = snapshot.start_x, snapshot.start_y
    ex, ey = snapshot.end_x, snapshot.end_y

    # Investigation locations are NOT in the snapshot — we synthesise
    # them along the line from the projection data (along-distance →
    # interpolate between start + end).  This is approximate (off-line
    # projection is lost) but sufficient for a schematic.
    line_dx = ex - sx
    line_dy = ey - sy
    length = max(snapshot.section_length_m, 1e-6)
    for inv in investigations:
        t = inv.along_distance_m / length
        ix = sx + t * line_dx
        iy = sy + t * line_dy
        ax.plot(ix, iy, marker="o", markersize=3, color="#1f2937")

    # The section line itself, plus L/R markers at the endpoints.
    ax.plot([sx, ex], [sy, ey], color="#dc2626", linewidth=1.5, zorder=2)
    ax.plot(sx, sy, marker="s", markersize=7, color="#dc2626", zorder=3)
    ax.plot(ex, ey, marker="s", markersize=7, color="#dc2626", zorder=3)
    # L = left end (= section start, where along_distance_m = 0);
    # R = right end (= section end). Same convention as the main
    # section drawing's x-axis (0 → length).
    ax.text(
        sx,
        sy,
        "L",
        fontsize=8,
        fontweight="bold",
        color="#ffffff",
        ha="center",
        va="center",
        zorder=4,
    )
    ax.text(
        ex,
        ey,
        "R",
        fontsize=8,
        fontweight="bold",
        color="#ffffff",
        ha="center",
        va="center",
        zorder=4,
    )

    ax.set_aspect("equal")
    ax.tick_params(axis="both", labelsize=5)
    ax.set_title("Plan view", fontsize=7, color="#374151")
    # Light grey frame to anchor the inset visually.
    for spine in ax.spines.values():
        spine.set_edgecolor("#9ca3af")
        spine.set_linewidth(0.5)
    ax.set_facecolor("#f9fafb")
