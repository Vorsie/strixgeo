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
   A sheet with a **short curve** (a refusal, "Obstakel", stopped after a
   metre) is still a CPT sheet when it carries the **graph frame**
   (`grid_line_helpers.has_graph_frame`: a depth axis down ≥ 30 % of the page
   and ≥ 2 value panels, all with their tick labels on long grid lines). With
   an unreadable text layer such a sheet's title strips go through OCR, which
   names it; with no text evidence at all (no OCR) it is kept on geometry
   alone (logged at INFO).
2. **Report triage** (`PdfReportTriager`): desk-study sheets are **thrown away**
   (owner 2026-09-30) and listed once by id ("Not imported, look these up
   yourself: GEO-22/040-S2, …"); every campaign and unknown sheet is
   digitised; continuation sheets join their sounding; **a sheet printed twice
   is dropped with a notice** (`merge_continuations(..., repeats=)`: a sheet of
   a known id that starts where its sounding started, or lies wholly inside
   the depth the sounding already covers, so a whole two-sheet sounding
   printed twice drops both reprinted sheets); a sheet
   that cannot be read is named ("unread"). Output: `PdfReportDigest` (what the
   dialog lists) + the digitised soundings by key.
3. **Calibrate + extract** per page: vector pages from the drawing commands
   (the polyline vertices ARE the scans, exact), raster pages rendered,
   deskewed, grid-detected, OCR-calibrated where possible and traced row by
   row. A raster sheet whose graph is ONE frame with no grid panels (or a grid
   too light to survive the render) is read too (owner 2026-10-08: "it should
   work on scanned pdf's"): `RasterFrameDetector` takes the largest rectangle
   the long lines close as a graph when a vertical axis line at or left of its
   left edge carries SHORT tick marks (the ink stops; a table's rules run on)
   at whole steps of one pitch over the frame's full height (>= 80 % of the
   steps, so a ruled table of uneven rows is not a graph); grid pieces that sit on
   ONE pitch lattice spanning that frame are its own faint grid
   (`framed_or_grid_panels`), side-by-side gridded panels stay panels.
   `RasterFrameCalibrator` fits each value axis from its OCR'd tick labels
   above / below the frame and names it by the axis label printed in the SAME
   colour (that colour is the curve's colour); the depth axis is the number
   column nearest the frame that grows downward, a falling column beside it
   (m TAW) gives the ground level at depth 0. A black curve's mask leaves out
   coloured pixels (the black fs curve crosses the red qc and blue Rf curves
   in one frame). Every page carries a `PageCalibration` (frames + two anchors per axis +
   curve colour + assumptions) that round-trips through `to_dict`/`from_dict`.
   `CptPdfDigitiser.digitise_with_calibration` re-reads a page through a
   user-edited calibration; `join_sheets` folds a sounding's pages back into one.
4. **Adapt** (`DigitisedSoundingAdapter`): a sounding → the `GEFParseResult`
   every CPT importer persists through `ImportCpt.persist` (coordinate guard,
   duplicate key, refresh consent). Header: name/test_id = sounding id,
   project_id = campaign code (or `"PDF"`), XY/EPSG, Z = ground level
   (`elevation_source = "pdf"`), date (ISO when day-month-year), CPT type from
   the curves (u2 → CPTU, fs → CPTE, qc alone → UNKNOWN).

## Printed-table reports (profile family `printed-table`)

Some reports print every sounding twice: a graph sheet (one pasted picture)
and the measured values as a numeric table, a row per 0.20 m, under the same
text header ("<report> - <id>", ISO 22476 test type, `Uitvoeringsdatum`,
`GPS X / GPS Y`, `GRW`, `Opmerking`). The table wins (owner 2026-10-08:
"the import takes the EXACT printed values"); the picture is the visual twin
and the raster fallback. Package files `printed_table_*.py`,
`printed_sheet_header.py`, `table_column_role.py`; the family's conventions in
`PrintedTableProfile` (`printed_table_constants.py`).

* **Triage**: `PrintedTableReportReader` reads every page's text; a sheet
  naming "<report> - <id>" is a data sheet (a column header D / TAW / qc / Fs /
  "Rf, %" / "Inclinatie, °" / φ' / C, or the mechanical D / TAW / qc / Qt / φ'
  / C, then right-aligned rows), a graph sheet (a picture covering >= 35 %), a
  calculation table (a column the profile does not know: bearing capacity,
  never read) or a header-only page (an empty continuation of a data sheet).
  Sheets join per sounding by their header; graph and table sheets are
  "claimed" and never digitised as graphs. The listed sounding: `graph_kind =
  printed-table`, origin campaign, project number = the report number (the
  GEF-compatible project id; display name per `cpt_display_name`), CPT type
  from the cone line (CPT-E -> CPTE, CPT-M -> CPTM). Position: the printed GPS
  X / Y in the system the REPORT names in its text (exactly one named, else
  left for the user, never guessed). Ground level = printed level + printed
  depth (median over the rows, `ground_level_source = "printed-table"`).
* **Values**: `PrintedTableDigitiser` turns the rows into curves with
  `source = GraphKind.TABLE`: qc, fs, Rf as printed, a blank cell empty, a row
  whose depth or qc (or any present cell) is not a number left out and named
  (`PDF_TABLE_ROWS_REJECTED`). Stored row for row, no resampling (`series_sampling
  = "printed table rows (no resampling)"`, `depth_source = "printed depth
  (table)"`). Not imported: the calculated columns (φ', C: listed under
  `derived_columns_ignored`), inclination and Qst (`columns_not_stored`, no
  stored column).
* **Qt of a CPT-M table** (role `TOTAL_RESISTANCE`): stored as `q_total_mpa`
  with the kN value kept as-is, the GEF quantity 128 rule (the standard
  10 cm² mechanical cone makes kN == MPa; see [parsers-gef.md](parsers-gef.md)),
  `printed_table.q_total_column = "Qt"`. Only a CPTM sounding (CPTM ⇒
  `q_total_mpa`, CPTU ⇒ `qt_mpa`, never both): a Qt column on a CPT-E / CPTU
  sheet is listed under `columns_not_stored`. A CPT-M sheet whose cone line
  names another area (`cone_area_cm2`, read from "CPT-x N cm²"; the test
  report's CPT-M sheets print "CPT-M M1", no area) leaves `q_total_mpa` empty
  and raises `PDF_TABLE_QTOTAL_CONE_AREA` (WARNING, `area_cm2`, `column`):
  never a conversion.
* **Pre-drill and gaps**: "voorgeduwd ... tot een diepte van N m" is the
  pre-drill (`pre_drill_m = N`, owner vocabulary voorboring); the table simply
  starts below it. Rows printing the floor value qc 0,01 MPa
  (`PRE_DRILL_FLOOR_QC_MPA`) as a run from the first printed row, below a
  PRINTED pre-drill, are no reading: every cell empty (qc, fs, Rf, Qt), no
  drilled gap, nothing interpolated. The curve starts at the first real row
  (`effective_pre_drill_m`, top-level and in `printed_table`;
  `pre_drill_floor_rows_m`; INFO `PDF_TABLE_PRE_DRILL_FLOOR_ROWS`; row note
  `PRE_DRILL_FLOOR_ROWS`); `pre_drill_m` stays the printed depth. A stored row
  needs a qc, so the emptied rows stay in the reading but not in the stored
  series. The same 0,01 later in a table, or at the top of a table that prints
  no pre-drill, stays as printed. A missing block of rows (a step > 1.5
  printed steps) or a printed "gesloten punt vanaf A m tot B m : geen
  meetwaarden" lying between two rows starts a new stroke: a drilled interval
  from the row above to the row below, both rows kept, never interpolated
  (owner ruling "a", 2026-10-04). A page break inside the table is no gap.
* **Checks**: a printed Rf its own printed fs and qc cannot give within their
  printed rounding is flagged AND dropped (`PDF_TABLE_RF_MISMATCH`, row note
  `TABLE_RF_MISMATCH`): the Rf cell empty, qc and fs as printed, the row kept,
  the printed value in `printed_table.rf_dropped` (`[depth, Rf]`). A row whose
  level + depth is off the ground level by more than the two values' rounding
  is flagged, never corrected (`PDF_TABLE_LEVEL_MISMATCH`).
* **Provenance**: `import_provenance.printed_table` (additive key, only on these
  CPTs): the header as printed (test type, standard, class, cone area, date,
  groundwater and free remark verbatim, pre-drill, no-measurement stretches),
  printed columns, ignored columns, `q_total_column`, ground level + first row,
  level / Rf mismatches, `rf_dropped`, floor rows + effective pre-drill,
  rejected rows, data / graph / calculation pages, the named systems, the
  stored `series_source` ("table" / "graph") and, when the graph sheet was
  read too, `graph_comparison` (`n`, `median_abs_qc_mpa`, `rms_qc_mpa`:
  picture qc minus printed qc at the printed depths).
* **The graph sheet is a CPT sheet** (owner ruling 2026-10-12, report
  Z2255777: "i see the thumbnail, i should be able to set the axes, that is a
  cpt"). The triage never reads it (OCR per sheet); `DigitiseCptPdfSounding`
  reads it on demand when the overlay opens: `digitise_raster` on each graph
  page (one-frame axes by OCR when installed), else a qc draft on the page's
  picture (`graph_twin_helpers.picture_draft`) so there is always a frame to
  drag. The automatic reading is cached on `CachedPdfReport.graph_twins`. A
  posted calibration on a graph page re-reads it through the raster path; one
  on a table page is refused (422). The digitise answer keeps `series` = the
  printed table and adds `graph_series`, `graph_comparison`,
  `series_source_default = "table"`; `calibrations` / `overlays` are the graph
  sheet's. The table stays the default stored series; the import body's
  additive `series_source: {key: "graph"}` stores the picture reading instead
  (a qc read off the picture is required, else the sounding fails with a
  message), under the printed header (id, pre-drill, CPT type). Desktop:
  "Assen controleren" works as for a raster sheet, with the switch "Bron:
  gedrukte tabel (standaard) / afgelezen grafiek", "afgelezen grafiek" enabled
  once a qc is read; a report that prints no graph sheet shows the header to
  correct instead of an empty panel.
* **Owner rulings 2026-10-09 (report Z1234567)**: a contradicting printed Rf
  is dropped ("laat die maar vallen die rf"); a closed-point stretch between
  two rows breaks the line row above to row below ("a, break the line"); Qt
  of a CPT-M table is stored like GEF quantity 128, another cone area is
  flagged; floor qc rows directly after the pre-drill are no reading ("they
  prolly drilled a bit too deep"). Pins in
  `tests/unit/infrastructure/parsers/cpt/pdf/test_printed_table_profile.py`.
* **App text**: every note / issue code above has its EN + NL sentence in
  `cptPdf.note.<code>` / `cptPdf.issue.<code>` (`utils/cptPdfNoteText.ts`).

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

Typed header values win per field over the printed ones (`_header` in
`application/import_cpt_pdf.py`; a typed Y alone corrects a printed Y and keeps
the printed X and system); `header_sources` records `user` or `sheet` per field;
half a position (one coordinate only) is no position. The triage adds the row
note `COORDINATE_OUT_OF_RANGE` when a printed position lies outside the extent
of its system (`coordinate_extent_constants.py`; only EPSG 31370 is listed,
other systems are not checked); the value itself is kept as printed.

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
company's report needs a profile, not new code. Reports that print their values
as tables use the separate `PrintedTableProfile` family (see above).

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
