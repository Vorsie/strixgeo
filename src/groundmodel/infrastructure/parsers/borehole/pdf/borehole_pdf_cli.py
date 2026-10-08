"""Offline runner: triage and parse borehole-log PDFs, write a digest, the parse and overlays.

Phase 1 tooling (no API route, no desktop). Usage::

    uv run python -m groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_cli \
        report.pdf [more.pdf ...] --out OUT_DIR [--ocr] [--overlays 3] [--max-pages 200]

Per file it writes ``<stem>.digest.json`` (the triage), ``<stem>.boreholes.json``
(every parsed borehole) and ``<stem>.p<page>.overlay.png`` for the first
``--overlays`` parsed sheets; for the whole run ``digest.md`` (one table row
per file, then the boreholes of each file). OCR is optional (the
``pdf-ocr`` extra); its page words are cached by the report's SHA-256 under
``<DOV cache dir>/borehole_pdf`` (or ``--cache-dir``), so a second run never
OCRs a page again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import (
    ground_level_of,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_overlay_renderer import (
    BoreholeOverlayRenderer,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class import (
    BoreholePageClass,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_triage_result import (
    BoreholeTriageResult,
)
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import ocr_available
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.shared.config import settings
from groundmodel.shared.logging.logger_factory import LoggerFactory

_log = LoggerFactory.get_logger(__name__)

# The table columns of digest.md, in page-class order.
_CLASS_COLUMNS = (
    BoreholePageClass.LOG_SHEET,
    BoreholePageClass.CONTINUATION_SHEET,
    BoreholePageClass.LEGEND,
    BoreholePageClass.PHOTO,
    BoreholePageClass.NEEDS_OCR,
    BoreholePageClass.BLANK,
    BoreholePageClass.OTHER,
)


def main(argv: list[str] | None = None) -> int:
    """Run the triage + parse over the given PDFs.

    Parameters
    ----------
    argv : list of str or None
        Command-line arguments (``sys.argv[1:]`` when None).

    Returns
    -------
    int
        0 on success, 2 when a file could not be opened.
    """
    args = _parser().parse_args(argv)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    use_ocr = bool(args.ocr) and ocr_available()
    if args.ocr and not use_ocr:
        _log.warning("OCR asked for but the pdf-ocr extra is not installed: pages stay 'needs OCR'")
    cache_dir: Path = args.cache_dir or settings.dov_cache_dir / "borehole_pdf"
    code = 0
    for i, pdf in enumerate(args.pdfs, start=1):
        _log.info("[%d/%d] %s", i, len(args.pdfs), pdf.name)
        try:
            data = pdf.read_bytes()
            doc = pymupdf.open(stream=data, filetype="pdf")
        except (OSError, RuntimeError, ValueError) as exc:
            _log.error("%s could not be opened: %s", pdf, exc)
            code = 2
            continue
        started = time.perf_counter()
        sha = hashlib.sha256(data).hexdigest()
        cache = None
        if use_ocr:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache = OcrWordCache(cache_dir / f"{sha}.ocr.json")
        triager = BoreholePdfTriager(ocr=OcrReader() if use_ocr else None)
        result = triager.triage(
            doc, file_name=pdf.name, file_sha=sha, max_pages=args.max_pages, ocr_cache=cache
        )
        identity = PdfReportIdentity(file_name=pdf.name, file_sha=sha, ocr_available=use_ocr)
        boreholes = BoreholePdfDigitiser().digitise(result, identity)
        digest = result.digest.to_dict()
        digest["elapsed_s"] = round(time.perf_counter() - started, 1)
        _write_json(out / f"{pdf.stem}.digest.json", digest)
        _write_json(out / f"{pdf.stem}.boreholes.json", [b.to_dict() for b in boreholes])
        _overlays(doc, result, out, pdf.stem, args.overlays, args.overlay_pages)
        print(
            f"{pdf.name}: {doc.page_count} pages, {len(result.digest.boreholes)} borehole(s), "
            f"{len(boreholes)} parsed, classes {result.digest.class_counts}"
        )
    (out / "digest.md").write_text(_markdown(out), encoding="utf-8")
    return code


def _parser() -> argparse.ArgumentParser:
    """Return the command-line parser."""
    p = argparse.ArgumentParser(description="Triage and parse borehole-log PDF reports.")
    p.add_argument("pdfs", nargs="+", type=Path, help="report file(s)")
    p.add_argument("--out", type=Path, required=True, help="output directory")
    p.add_argument("--ocr", dest="ocr", action="store_true", help="OCR pages without a text layer")
    p.add_argument("--no-ocr", dest="ocr", action="store_false", help="never OCR (default)")
    p.set_defaults(ocr=False)
    p.add_argument(
        "--overlays", type=int, default=3, help="overlay PNGs of the first N parsed sheets"
    )
    p.add_argument(
        "--overlay-pages", type=str, default="", help="comma-separated pages to overlay as well"
    )
    p.add_argument("--max-pages", type=int, default=None, help="triage only the first N pages")
    p.add_argument("--cache-dir", type=Path, default=None, help="OCR word cache directory")
    return p


def _write_json(path: Path, data: Any) -> None:
    """Write ``data`` as indented UTF-8 JSON."""
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _overlays(
    doc: pymupdf.Document,
    result: BoreholeTriageResult,
    out: Path,
    stem: str,
    count: int,
    pages: str,
) -> None:
    """Write overlay PNGs for the first ``count`` parsed sheets and any named pages."""
    wanted = [p for p, s in sorted(result.sheets.items()) if s.rows][: max(count, 0)]
    wanted += [int(p) for p in pages.split(",") if p.strip().isdigit()]
    renderer = BoreholeOverlayRenderer()
    for page in dict.fromkeys(wanted):
        sheet = result.sheets.get(page)
        if sheet is None or not sheet.rows:
            continue
        group = next((b for b in result.digest.boreholes if page in b.pages), None)
        group_sheets = [result.sheets[p] for p in group.pages] if group else [sheet]
        ground, _, _ = ground_level_of(group_sheets)
        png = renderer.overlay_png(doc, sheet, dpi=110, ground_m=ground)
        (out / f"{stem}.p{page}.overlay.png").write_bytes(png)


def _markdown(out: Path) -> str:
    """Return the digest of every report in ``out``: one table row per file, then its boreholes.

    Reads every ``*.digest.json`` (and its ``*.boreholes.json``) in the folder,
    so separate runs (OCR on for the scanned reports, off for a huge one)
    build one table.
    """
    files = sorted(out.glob("*.digest.json"))
    head = [
        "file",
        "pages",
        "boreholes",
        "parsed",
        "intervals",
        *[c.value for c in _CLASS_COLUMNS],
        "OCR pages",
        "s",
    ]
    lines = [
        "# Borehole PDF triage digest",
        "",
        "| " + " | ".join(head) + " |",
        "|" + "---|" * len(head),
    ]
    reports: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for path in files:
        d = json.loads(path.read_text(encoding="utf-8"))
        parse_path = path.with_name(path.name.replace(".digest.json", ".boreholes.json"))
        parsed = json.loads(parse_path.read_text(encoding="utf-8")) if parse_path.exists() else []
        reports.append((d, parsed))
        counts = d["class_counts"]
        skipped = d["pages_not_triaged"]
        cells = [
            d["file_name"],
            str(d["page_count"]) + (f" ({skipped} not triaged)" if skipped else ""),
            str(len(d["boreholes"])),
            str(len(parsed)),
            str(sum(len(b["intervals"]) for b in parsed)),
            *[str(counts.get(c.value, 0)) for c in _CLASS_COLUMNS],
            str(len(d["ocr_pages"])),
            str(d.get("elapsed_s", "-")),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    for d, parsed in reports:
        lines += ["", f"## {d['file_name']}", ""]
        if d["needs_ocr_pages"]:
            lines += [f"Needs OCR: pages {_ranges(tuple(d['needs_ocr_pages']))}.", ""]
        if d["ocr_pages"]:
            lines += [f"Read by OCR: pages {_ranges(tuple(d['ocr_pages']))}.", ""]
        if not d["boreholes"]:
            lines.append("No borehole found.")
            continue
        issues = {b["key"]: len(b["issues"]) for b in parsed}
        lines.append(
            "| borehole | pages | profile | text | depth (m) | X | Y | EPSG | ground (m) | date "
            "| findings | repeat of |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for b in d["boreholes"]:
            top, base = b["depth_top_m"], b["depth_base_m"]
            depth = f"{top:.2f}-{base:.2f}" if top is not None and base is not None else "-"
            epsg = _cell(b["epsg"]) + (" (assumed)" if b.get("crs_assumed") else "")
            repeat = b["repeat_of"] or "-"
            if b.get("repeat_differences"):
                repeat += f" ({len(b['repeat_differences'])} row(s) differ)"
            lines.append(
                f"| {b['name']} | {_ranges(tuple(b['pages']))} | {b['profile']} | "
                f"{b['text_verdict']} | {depth} | {_cell(b['x'])} | {_cell(b['y'])} | "
                f"{epsg} | {_cell(b['ground_level_m'])} | {b['date_text'] or '-'} | "
                f"{issues.get(b['key'], '-')} | {repeat} |"
            )
        for dropped in d.get("dropped", []):
            lines += [
                "",
                f"Dropped: {dropped['key']} (pages {_ranges(tuple(dropped['pages']))}), "
                f"{dropped['reason']}: {dropped['note']}.",
            ]
    return "\n".join(lines) + "\n"


def _cell(value: object) -> str:
    """Return a table cell ("-" for None)."""
    return "-" if value is None else str(value)


def _ranges(pages: tuple[int, ...]) -> str:
    """Return page numbers as compact ranges ("1-3, 7")."""
    runs: list[list[int]] = []
    for p in pages:
        if runs and p == runs[-1][-1] + 1:
            runs[-1].append(p)
        else:
            runs.append([p])
    return ", ".join(str(r[0]) if len(r) == 1 else f"{r[0]}-{r[-1]}" for r in runs)


if __name__ == "__main__":  # pragma: no cover - command-line entry
    raise SystemExit(main())
