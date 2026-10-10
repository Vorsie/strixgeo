"""BoreholePdfDigitiser: turn the triaged sheets of a report into DigitisedBoreholes."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import (
    depth_below,
    ground_level_of,
    header_value,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_helpers import (
    assumed_crs,
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
    ISSUE_CRS_ASSUMED,
    ISSUE_GROUND_LEVEL_DISAGREES,
    ISSUE_GROUND_LEVEL_FROM_FIRST_LEVEL,
    ISSUE_NO_GROUND_LEVEL,
    ISSUE_NO_XY,
    ISSUE_OPEN_BASE,
    ISSUE_REPEAT_DIFFERS,
    ISSUE_REPEAT_DROPPED,
    ISSUE_SAMPLE_WITHOUT_AXIS,
    ISSUE_WATER_UNIT_ASSUMED,
    ISSUE_WATER_UNIT_UNPRINTED,
    PDF_DIGITISED_SOURCE,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_header import (
    BoreholePdfHeader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_join_helpers import (
    join_sheets,
    sheet_intervals,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_text_helpers import (
    lithology_absent_reason,
    sample_label,
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
    the sheet's depth axis (the interval as drawn); the water level comes from
    the header field. Descriptions stay verbatim: no DOV code is set here.

    The owner's 2026-10-08 rulings: the surface word is a header note; an
    interval printing only the technique and a sample remark has an empty
    lithology (``"sampled"``); X/Y without a named system are Lambert 72 and a
    water level without unit or reference is cm below ground, both flagged for
    the user to confirm; a repeat print that differs is flagged on both prints
    (an identical one is dropped by the triage, with a notice here).
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
            borehole = self.parse(listing, [result.sheets[p] for p in listing.pages], identity)
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
        self._repeat_findings(result, out)
        self.success(
            "digitise %s: %d borehole(s), %d interval(s)",
            identity.file_name,
            len(out),
            sum(len(b.intervals) for b in out),
        )
        return out

    def parse(
        self,
        listing: ReportBorehole,
        sheets: list[BoreholeSheet],
        identity: PdfReportIdentity,
    ) -> DigitisedBorehole:
        """Return one borehole read from its sheets.

        Parameters
        ----------
        listing : ReportBorehole
            The borehole as the triage lists it.
        sheets : list of BoreholeSheet
            Its sheets, in order.
        identity : PdfReportIdentity
            The report file.

        Returns
        -------
        DigitisedBorehole
            The borehole; a listed repeat that differs carries
            ``REPEAT_DIFFERS`` with the differing rows.
        """
        first_page = sheets[0].page_number
        issues: list[ValidationIssue] = [i for s in sheets for i in s.issues]
        if listing.repeat_of is not None and listing.repeat_differences:
            issues.append(
                _repeat_differs(
                    listing.name, first_page, listing.repeat_of, listing.repeat_differences
                )
            )
        ground, z_epsg, source = ground_level_of(sheets)
        self._check_ground(sheets, ground, source, issues)
        intervals, join_issues = join_sheets([sheet_intervals(s, ground) for s in sheets])
        issues.extend(join_issues)
        intervals = [
            replace(i, lithology_absent_reason=lithology_absent_reason(i.description))
            for i in intervals
        ]
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
        epsg, crs_assumed = assumed_crs(x, y, epsg)
        if crs_assumed:
            issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_CRS_ASSUMED,
                    f"{listing.name}: X/Y printed without a coordinate system; read as "
                    f"EPSG:{epsg} (Lambert 72), to confirm at import",
                    {"page": first_page, "x": x, "y": y, "epsg": epsg},
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
            crs_assumed=crs_assumed,
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
            surface_label=sheets[0].surface_text,
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
            "source": PDF_DIGITISED_SOURCE,
            "digitiser_version": BOREHOLE_DIGITISER_VERSION,
            "report_file_name": identity.file_name,
            "report_sha256": identity.file_sha,
            "profile": profile.name,
            "pages": [s.page_number for s in sheets],
            "text_sources": {str(s.page_number): s.text_source for s in sheets},
            "ocr_available": identity.ocr_available,
            "crs_assumed": crs_assumed,
            "water_unit_assumed": any(w.unit_assumed for w in water),
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

    def _repeat_findings(
        self, result: BoreholeTriageResult, boreholes: list[DigitisedBorehole]
    ) -> None:
        """Put the repeat findings on the first prints.

        A dropped identical repeat leaves ``REPEAT_DROPPED`` (INFO) on the
        print that stays; a listed repeat that differs puts ``REPEAT_DIFFERS``
        on the first print too (the repeat itself got it in :meth:`parse`).
        """
        by_key = {b.key: b for b in boreholes}
        for dropped in result.digest.dropped:
            kept = by_key.get(dropped.kept_key)
            if kept is None:
                continue
            kept.issues.append(
                make_issue(
                    ValidationLevel.INFO,
                    ISSUE_REPEAT_DROPPED,
                    f"{dropped.name}: printed again on page(s) {list(dropped.pages)} with "
                    "exactly the same data; that print is dropped",
                    {
                        "page": dropped.pages[0],
                        "dropped_key": dropped.key,
                        "pages": list(dropped.pages),
                    },
                )
            )
            self.info("%s: identical repeat %s dropped", kept.key, dropped.key)
        for listing in result.digest.boreholes:
            if listing.repeat_of is None or not listing.repeat_differences:
                continue
            kept = by_key.get(listing.repeat_of)
            if kept is None:
                continue
            kept.issues.append(
                _repeat_differs(
                    listing.name, listing.pages[0], listing.key, listing.repeat_differences
                )
            )
            self.warning(
                "%s: printed again as %s with %d differing row(s); both kept",
                kept.key,
                listing.key,
                len(listing.repeat_differences),
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
                    sample_label=sample_label(mark.sample_id),
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
            depth, assumed = water_depth_m(label, value)
            params: dict[str, Any] = {"page": sheet.page_number, "label": label, "value": value}
            if assumed:
                issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        ISSUE_WATER_UNIT_ASSUMED,
                        f"page {sheet.page_number}: water level {value!r} ({label}) names no "
                        f"unit or reference; read as {depth} m below ground, to confirm at import",
                        {**params, "depth_m": depth},
                    )
                )
            elif depth is None:
                issues.append(
                    make_issue(
                        ValidationLevel.INFO,
                        ISSUE_WATER_UNIT_UNPRINTED,
                        f"page {sheet.page_number}: water level {value!r} ({label}) cannot be "
                        "read as a depth below ground; kept raw",
                        params,
                    )
                )
            return [
                DigitisedWaterLevel(
                    depth_m=depth,
                    raw_text=value,
                    label=label,
                    source="header",
                    page=sheet.page_number,
                    unit_assumed=assumed,
                )
            ]
        return []


def _repeat_differs(
    name: str, page: int, other_key: str, rows: tuple[dict[str, Any], ...]
) -> ValidationIssue:
    """Return the ``REPEAT_DIFFERS`` finding of one print, naming the other print."""
    return make_issue(
        ValidationLevel.WARNING,
        ISSUE_REPEAT_DIFFERS,
        f"{name}: printed twice with {len(rows)} differing row(s) (other print {other_key}); "
        "choose the print to withhold",
        {"page": page, "other_key": other_key, "rows": [dict(r) for r in rows]},
    )
