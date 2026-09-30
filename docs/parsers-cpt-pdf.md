# PDF CPT digitiser (Data → Import → CPTs from a PDF report)

Reads the CPT graphs of a contractor's test report (proefverslag) back into
depth series, so a campaign that was only delivered as a PDF can be imported
like a GEF. Package: `infrastructure/parsers/cpt/pdf/` (compiled to `.pyd` in
the installer like every parser module). Load before touching the digitiser,
the `/cpt/pdf/*` routes or the import dialog.

## Pipeline

1. **Triage** (`PageTriage`, per page): text layer, images, drawing commands,
   axis tick runs and CPT keywords → a page class (text, table, photo, map,
   cpt-graph, dissipation, borehole log, …). CPT graph pages get an **origin**
   from the report's campaign fingerprint (the most frequent campaign code,
   e.g. `CAMZ-001`, plus the contractor project numbers seen on its own
   sheets): `campaign`, `desk-study` (a DOV sheet or another project's sheet)
   or `unknown`. The sounding block is read by geometry (`SoundingBlockReader`):
   id, project, location, ground level + datum (`HOOGTE MAAIVELD 6.02 m TAW` →
   5710), **position** (`X-/Y-COÖRDINAAT (Lambert72)` → EPSG 31370; RD →
   28992; a position whose system the sheet does not name is left unread,
   never guessed) and the printed date.
2. **Report triage** (`PdfReportTriager`): desk-study sheets are **thrown away**
   (owner 2026-09-30) and listed once by id ("Not imported, look these up
   yourself: GEO-22/040-S2, …"); every campaign and unknown sheet is
   digitised; continuation sheets join their sounding; **a sheet printed twice
   is dropped with a notice** (`merge_continuations(..., repeats=)`); a sheet
   that cannot be read is named ("unread"). Output: `PdfReportDigest` (what the
   dialog lists) + the digitised soundings by key.
3. **Calibrate + extract** per page: vector pages from the drawing commands
   (the polyline vertices ARE the scans, exact), raster pages rendered,
   deskewed, grid-detected, OCR-calibrated where possible and traced row by
   row. Every page carries a `PageCalibration` (frames + two anchors per axis +
   curve colour + assumptions) that round-trips through `to_dict`/`from_dict`.
   `CptPdfDigitiser.digitise_with_calibration` re-reads a page through a
   user-edited calibration; `join_sheets` folds a sounding's pages back into one.
4. **Adapt** (`DigitisedSoundingAdapter`): a sounding → the `GEFParseResult`
   every CPT importer persists through `ImportCpt.persist` (coordinate guard,
   duplicate key, refresh consent). Header: name/test_id = sounding id,
   project_id = campaign code (or `"PDF"`), XY/EPSG, Z = ground level
   (`elevation_source = "pdf"`), date (ISO when day-month-year), CPT type from
   the curves (u2 → CPTU, fs → CPTE, qc alone → UNKNOWN).

## Owner rulings (2026-09-30) and where they live

| Ruling | Implementation |
|---|---|
| Clipped points stay at the axis maximum with a flag; the printed arrow value is a note; never interpolated | values kept as read; `PDF_CLIPPED_POINTS` (WARNING, count + axis max); provenance `clipped.<curve>.{count, axis_max, intervals_m}` + `printed_values` |
| Desk-study reprints thrown away, ids listed once | `PdfReportTriager` → `DroppedSheet(reason="desk-study")`, `digest.desk_study_ids`; never listed, so never importable |
| Elevation-axis sheets: depth = printed ground level − elevation | digitiser converts; `PDF_DEPTH_FROM_ELEVATION` (INFO); provenance `depth_source = "derived from plotted elevation"` |
| Vector vertices stored as the scans; raster resampled to 0.02 m | `stored_series_helpers.stored_table`: qc vertices are the depth array, the other curves read at those depths (their own vertex within 0.5 mm, else linear between vertices); raster → `to_frame(0.02)`; provenance `series_sampling` |
| A sheet printed twice is dropped with a notice | `DroppedSheet(reason="duplicate")` |
| OCR optional | see below |

Also: a point plotted **above** ground level (negative depth — the plotter
starts its line a few millimetres above the surface) is not a scan and is not
stored (`points_above_ground_dropped` in the provenance). Rf printed on the
sheet is `rf_source = measured`; without an Rf panel it is computed from fs/qc
(`computed`), like the GEF parser.

## Validation issues

`PDF_CLIPPED_POINTS` (WARNING, one per clipped curve), `PDF_DEPTH_FROM_ELEVATION`
(INFO), `PDF_NO_XY` (ERROR: no position printed and none typed — the import
refuses that sounding with `code = "pdf_no_xy"`), `PDF_OCR_UNAVAILABLE` (INFO: a
raster sounding read without OCR).

## Provenance on the CPT

`cpt.import_provenance` (JSONB, nullable; migration `b7c1d2e3f4a5`, additive;
NULL for GEF / DOV). Written verbatim from `GEFParseResult.import_provenance`
and replaced on a consented refresh. Keys: `source = "pdf-digitised"`,
`digitiser_version` (`DIGITISER_VERSION` — bump when a change moves digitised
values), `report_file_name`, `report_sha256`, `pages`, `graph_kind`,
`series_sampling`, `depth_source`, `rf_source`, `clipped`, `printed_values`,
`header_sources` (field → `sheet` / `user`), `printed_test_date`,
`calibrations` (one `PageCalibration.to_dict()` per page), `ocr_available`,
`points_above_ground_dropped`. It rides in the `.strix` bundle column by column
(pinned in `bundle_columns_expected.py`); no format bump. The desktop shows it
as "digitised from <file>, p. <pages>" on the CPT chart (`CptProvenanceTag`).

## Layout profiles

Company specifics (label words, curve colours, units, sounding-block labels,
campaign-code pattern) live in `LayoutProfile`s (`layout_profile_constants.py`):
`van-der-straaten`, `dov` (always desk study), and the `generic` fallback. A new
company's report needs a profile, not new code.

## OCR is optional (`pdf-ocr` extra)

PyMuPDF is a runtime dependency; RapidOCR + OpenCV are the optional extra
`pdf-ocr` (`uv sync --extra pdf-ocr`; the dev group carries both so the tests
run). Every module imports without them: OpenCV is loaded at call time through
`optional_engines.require_cv2()` and probed with `raster_available()` /
`ocr_available()`. Without the extra: vector pages with a text layer work fully;
vector pages whose tick labels are outlined text, and all scanned pages, are not
read (listed as "unread", or as image pages not looked at), and the dialog says
"Tick reading unavailable: type the axis values". The overlay is drawn by
PyMuPDF alone (`PdfPageRenderer`). The unit pin `test_optional_ocr.py` runs the
vector path in a subprocess where `cv2` / `rapidocr_onnxruntime` cannot import.

## The import flow (API + dialog)

`POST /cpt/pdf/triage` spools the upload into `PdfReportStore`
(`<CPT_PDF_STORE_DIR>/<project>/<sha256>.pdf`, oldest pruned beyond 5 per
project) and runs `TriageCptPdfReport` as a job (progress `classify` /
`digitise`, the DOV SSE pattern); the digest + digitised soundings are kept in
memory (last 4 reports). `POST /cpt/pdf/digitise` re-reads one sounding through
the posted calibration dicts and returns the series + one overlay PNG per page.
`POST /cpt/pdf/import` runs `ImportCptPdf`: per sounding, the GEF import's own
consent flow. All PyMuPDF work runs under one lock (`PdfReportStore.opened`):
PyMuPDF is not thread-safe. A restarted backend forgets the triage: the dialog
gets `cpt_pdf_report_unknown` and the user picks the report again. Routes:
[api.md](api.md); dialog: [desktop.md](desktop.md).

Timing on CAMZ-001 (397 pages, 161 CPT graph pages, vector): ~25–75 s for the
triage without OCR depending on machine load; 74 campaign soundings, 42
desk-study ids, 1 repeat (66 on p. 215), 1 unread without OCR (19b, p. 184:
outlined tick labels — read with the `pdf-ocr` extra, giving 75).
