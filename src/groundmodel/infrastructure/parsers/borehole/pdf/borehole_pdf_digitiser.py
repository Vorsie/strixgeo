"""BoreholePdfDigitiser: turn the triaged sheets of a report into DigitisedBoreholes."""

from __future__ import annotations

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import (
    depth_below,
    ground_level_of,
    header_value,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_helpers import (
    coordinates,
    water_depth_m,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile_constants import (
    BOREHOLE_LAYOUT_PROFILES,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    BOREHOLE_DIGITISER_VERSION,
    DEPTH_DECIMALS,
    GROUND_FROM_FIRST_LEVEL,
    GROUND_LEVEL_TOLERANCE_M,
    ISSUE_GROUND_LEVEL_DISAGREES,
    ISSUE_GROUND_LEVEL_FROM_FIRST_LEVEL,
    ISSUE_NO_GROUND_LEVEL,
    ISSUE_NO_XY,
    ISSUE_OPEN_BASE,
    ISSUE_PRINTED_AGAIN,
    ISSUE_SAMPLE_WITHOUT_AXIS,
    ISSUE_WATER_UNIT_UNPRINTED,
    ISSUE_XY_SYSTEM_UNNAMED,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_header import (
    BoreholePdfHeader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_join_helpers import (
    join_sheets,
    sheet_intervals,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_triage_result import (
    BoreholeTriageResult,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_sample import DigitisedSample
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_water_level import (
    DigitisedWaterLevel,
)
from groundmodel.infrastructure.parsers.borehole.pdf.report_borehole import ReportBorehole
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import sheet_date_iso
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    make_issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BoreholePdfDigitiser(GroundModelLogger):
    """Read every listed borehole of a triaged report into a ``DigitisedBorehole``.

    Depths come from the printed levels only (depth = ground level - level);
    a level that cannot be read leaves its boundary without a depth. Rows a
    sheet cut are joined over sheets. Sample bars get their depth through
    the sheet's depth axis; the water level comes from the header field when
    its label names the unit and the reference. Descriptions stay verbatim:
    no DOV code is set here.
    """

    def __init__(self) -> None:
        super().__init__(__name__)
        self._profiles = {p.name: p for p in BOREHOLE_LAYOUT_PROFILES}

    def digitise(
        self, result: BoreholeTriageResult, identity: PdfReportIdentity
    ) -> list[DigitisedBorehole]:
        """Return the boreholes of a triaged report whose profile reads rows.

        Parameters
        ----------
        result : BoreholeTriageResult
            The triage (digest + sheets).
        identity : PdfReportIdentity
            The report file (name, SHA-256, whether OCR was available).

        Returns
        -------
        list of DigitisedBorehole
            In report order; boreholes of a triage-only profile are skipped.
        """
        listed = result.digest.boreholes
        self.info("digitise %s: %d borehole(s) listed", identity.file_name, len(listed))
        out: list[DigitisedBorehole] = []
        for i, listing in enumerate(listed, start=1):
            if not listing.parses_rows:
                self.info(
                    "[%d/%d] %s: profile %s reads no rows, skipped",
                    i,
                    len(listed),
                    listing.name,
                    listing.profile,
                )
                continue
            borehole = self._borehole(listing, [result.sheets[p] for p in listing.pages], identity)
            self.debug(
                "[%d/%d] %s: %d interval(s), %d sample(s), %d issue(s)",
                i,
                len(listed),
                listing.name,
                len(borehole.intervals),
                len(borehole.samples),
                len(borehole.issues),
            )
            out.append(borehole)
        self.success(
            "digitise %s: %d borehole(s), %d interval(s)",
            identity.file_name,
            len(out),
            sum(len(b.intervals) for b in out),
        )
        return out

    def _borehole(
        self,
        listing: ReportBorehole,
        sheets: list[BoreholeSheet],
        identity: PdfReportIdentity,
    ) -> DigitisedBorehole:
        """Return one borehole from its sheets."""
        first_page = sheets[0].page_number
        issues: list[ValidationIssue] = [i for s in sheets for i in s.issues]
        if listing.repeat_of is not None:
            issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_PRINTED_AGAIN,
                    f"{listing.name}: printed again from page {first_page}, inside the depth "
                    f"range of {listing.repeat_of}",
                    {"page": first_page, "repeat_of": listing.repeat_of},
                )
            )
        ground, z_epsg, source = ground_level_of(sheets)
        self._check_ground(sheets, ground, source, issues)
        intervals, join_issues = join_sheets([sheet_intervals(s, ground) for s in sheets])
        issues.extend(join_issues)
        if intervals and intervals[-1].depth_base_m is None and intervals[-1].base_label is None:
            issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_OPEN_BASE,
                    f"{listing.name}: the last layer has no closing level",
                    {"page": sheets[-1].page_number},
                )
            )
        x, y, epsg = None, None, None
        for sheet in sheets:
            x, y, epsg = coordinates(sheet.header)
            if x is not None or y is not None:
                break
        if x is None or y is None:
            issues.append(
                make_issue(
                    ValidationLevel.ERROR,
                    ISSUE_NO_XY,
                    f"{listing.name}: no position printed",
                    {"page": first_page},
                )
            )
        elif epsg is None:
            issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_XY_SYSTEM_UNNAMED,
                    f"{listing.name}: X/Y printed without a coordinate system; kept raw",
                    {"page": first_page, "x": x, "y": y},
                )
            )
        profile = self._profiles[sheets[0].profile]
        samples = self._samples(sheets, ground, profile.sample_mark_meaning, issues)
        water = self._water(sheets, issues)
        bases = [i.depth_base_m for i in intervals if i.depth_base_m is not None]
        date_text = header_value(sheets, "date")
        raw: dict[str, dict[str, str]] = {}
        for sheet in sheets:
            for name, (label, value) in sheet.header.fields.items():
                raw.setdefault(name, {"label": label, "value": value})
        header = BoreholePdfHeader(
            name=listing.name,
            x=x,
            y=y,
            epsg=epsg,
            ground_level_m=ground,
            z_epsg=z_epsg,
            ground_level_source=source,
            total_depth_m=max(bases) if bases else None,
            date_text=date_text,
            date_iso=sheet_date_iso(date_text),
            driller=header_value(sheets, "driller"),
            project_code=header_value(sheets, "project_code"),
            project_name=header_value(sheets, "project_name"),
            remark=header_value(sheets, "remark"),
            surface_text=sheets[0].surface_text,
            identification_standard=next(
                (
                    s.header.identification_standard
                    for s in sheets
                    if s.header.identification_standard
                ),
                None,
            ),
            raw_fields=raw,
        )
        provenance = {
            "source": "pdf-digitised",
            "digitiser_version": BOREHOLE_DIGITISER_VERSION,
            "report_file_name": identity.file_name,
            "report_sha256": identity.file_sha,
            "profile": profile.name,
            "pages": [s.page_number for s in sheets],
            "text_sources": {str(s.page_number): s.text_source for s in sheets},
            "ocr_available": identity.ocr_available,
            "sheets": [s.provenance() for s in sheets],
        }
        return DigitisedBorehole(
            key=listing.key,
            header=header,
            intervals=intervals,
            samples=samples,
            water_levels=water,
            provenance=provenance,
            issues=issues,
        )

    @staticmethod
    def _check_ground(
        sheets: list[BoreholeSheet],
        ground: float | None,
        source: str | None,
        issues: list[ValidationIssue],
    ) -> None:
        """Report where the ground level came from, and a header that disagrees."""
        page = sheets[0].page_number
        if ground is None:
            issues.append(
                make_issue(
                    ValidationLevel.ERROR,
                    ISSUE_NO_GROUND_LEVEL,
                    f"page {page}: neither a ground level nor a first level printed; no depths",
                    {"page": page},
                )
            )
            return
        if source == GROUND_FROM_FIRST_LEVEL:
            issues.append(
                make_issue(
                    ValidationLevel.INFO,
                    ISSUE_GROUND_LEVEL_FROM_FIRST_LEVEL,
                    f"page {page}: no ground level in the header; the first level "
                    f"{ground} is the top of the borehole",
                    {"page": page, "ground_level_m": ground},
                )
            )
            return
        first = sheets[0].first_level_m
        if first is not None and abs(first - ground) > GROUND_LEVEL_TOLERANCE_M:
            issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_GROUND_LEVEL_DISAGREES,
                    f"page {page}: header ground level {ground} m, first printed level {first} m;"
                    " depths use the header",
                    {"page": page, "ground_level_m": ground, "first_level_m": first},
                )
            )

    @staticmethod
    def _samples(
        sheets: list[BoreholeSheet],
        ground: float | None,
        meaning: dict[str, str],
        issues: list[ValidationIssue],
    ) -> list[DigitisedSample]:
        """Return the sample bars, merged by id over the sheets."""
        merged: dict[str, DigitisedSample] = {}
        for sheet in sheets:
            for mark in sheet.samples:
                top: float | None = None
                base: float | None = None
                if sheet.axis is None:
                    issues.append(
                        make_issue(
                            ValidationLevel.WARNING,
                            ISSUE_SAMPLE_WITHOUT_AXIS,
                            f"page {sheet.page_number}: sample {mark.sample_id} found but no "
                            "depth axis to place it",
                            {"page": sheet.page_number, "sample_id": mark.sample_id},
                        )
                    )
                else:
                    a: float | None = sheet.axis.value_m_at(mark.y0)
                    b: float | None = sheet.axis.value_m_at(mark.y1)
                    if sheet.axis.is_elevation:
                        a, b = depth_below(ground, a), depth_below(ground, b)
                    top = None if a is None else round(a, DEPTH_DECIMALS) + 0.0
                    base = None if b is None else round(b, DEPTH_DECIMALS) + 0.0
                known = merged.get(mark.sample_id)
                if known is not None:
                    tops = [v for v in (known.depth_top_m, top) if v is not None]
                    bases = [v for v in (known.depth_base_m, base) if v is not None]
                    top = min(tops) if tops else None
                    base = max(bases) if bases else None
                pages = (known.pages if known else ()) + (sheet.page_number,)
                merged[mark.sample_id] = DigitisedSample(
                    sample_id=mark.sample_id,
                    depth_top_m=top,
                    depth_base_m=base,
                    mark=mark.mark,
                    sample_type=meaning.get(mark.mark),
                    pages=tuple(dict.fromkeys(pages)),
                )
        return sorted(
            merged.values(),
            key=lambda s: (s.depth_top_m is None, s.depth_top_m or 0.0),
        )

    @staticmethod
    def _water(
        sheets: list[BoreholeSheet], issues: list[ValidationIssue]
    ) -> list[DigitisedWaterLevel]:
        """Return the water level the header prints (first sheet that prints one)."""
        for sheet in sheets:
            label = sheet.header.label("water")
            value = sheet.header.value("water")
            if label is None or not value:
                continue
            depth = water_depth_m(label, value)
            if depth is None:
                issues.append(
                    make_issue(
                        ValidationLevel.INFO,
                        ISSUE_WATER_UNIT_UNPRINTED,
                        f"page {sheet.page_number}: water level {value!r} ({label}) names no "
                        "unit or reference; kept raw",
                        {"page": sheet.page_number, "label": label, "value": value},
                    )
                )
            return [
                DigitisedWaterLevel(
                    depth_m=depth,
                    raw_text=value,
                    label=label,
                    source="header",
                    page=sheet.page_number,
                )
            ]
        return []
