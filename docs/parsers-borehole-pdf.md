# PDF borehole-log digitiser (Data → Import → Boring → Uit een pdf-rapport)

Reads the borehole logs (boorstaten / boorprofielen) of a contractor's PDF
report back into depth intervals with their descriptions verbatim, samples
and the printed water level, so a campaign delivered only as a PDF is
imported like a DOV borehole XML file. The sibling of the CPT digitiser
([parsers-cpt-pdf.md](parsers-cpt-pdf.md)), on the same user path. Package:
`infrastructure/parsers/borehole/pdf/` (compiled to `.pyd` in the installer
like every parser module). Load before touching the borehole digitiser, the
`/borehole/pdf/*` routes or the import dialog.

**Built:** triage, two layout profiles, sheet reading, the per-borehole parse
(`DigitisedBorehole`), overlays and an offline runner (phase 1); the import
(phase 2): routes, the consented import into the borehole tables, the desktop
dialog with the two confirmations. See "The import flow" below.

## Reuse from the CPT digitiser (by import)

`PageWord` + `word_geometry` (line grouping, garbled-text test),
`VectorPageReader` (words + stroked segments), `OcrReader` + `OcrWordCache`
(optional OCR, words cached per report SHA-256), `sheet_header_helpers`
(Lambert72 / TAW named by the sheet -> EPSG, printed dates),
`tick_run_finder.parse_number`, `PdfReportIdentity`. If a third digitiser
needs these, move them to a shared `parsers/pdf/` sibling then.

## Pipeline

1. **Triage** (`BoreholePdfTriager`, per page): text layer measured
   (characters, readability), images and drawing items counted. A page
   without a usable text layer is OCR'd when an `OcrReader` is given, else
   it is `needs-ocr` and nothing about it is guessed. The first layout
   profile whose required words the page carries reads it: a page with a
   borehole name (and, for a profile that reads rows, a level column) is a
   `log-sheet`, or a `continuation-sheet` when the page before printed the
   same name. A triage-only (generic) log whose title says it is a log
   ("Log sheet") but whose name could not be read is a log sheet with an
   empty name (never an invented one). Else `legend` ("Legenda" as the
   page title, top 20 %), `photo` (an image over half the page, < 300
   characters, judged on the OCR words after OCR), `blank` or `other`
   (cover, table, report text). Words printed bold by overprinting (each
   word two or three times a fraction of a point apart) are read once. Output:
   `BoreholeReportDigest` (`to_dict`) listing the boreholes (`ReportBorehole`:
   name, sheet range, printed X/Y/EPSG + `crs_assumed`, ground level, date,
   driller, project code, depth covered, text-vs-OCR verdict, `repeat_of` +
   `repeat_differences`), the prints set aside (`dropped`:
   `DroppedBorehole`), plus the sheets read, so the parse never reads a page
   twice. `max_pages` caps a huge report. A borehole printed again inside an
   earlier print's depth range is compared row by row
   (`borehole_repeat_helpers`): every repeat row must be a first-print row
   with the same text and boundaries (only the repeat's first top and last
   base may lie inside a row, its sheets cut there); samples by id, mark and
   depth within 0.05 m or 1.5 pt of the coarser print (the 24.13-002
   overview draws each bar ~1 pt shorter at each end); a first-print sample
   wholly inside the overlap must be printed again. Identical -> dropped
   (`dropped`, reason `duplicate`); different -> both listed, the repeat
   with `repeat_of` and the differing rows.
2. **Sheet reading** (`BoreholeSheetReader`, by profile):
   * the description **rules**: the largest family of long horizontal lines
     sharing one right end;
   * the **level column**: the left-aligned column of mostly-number words at
     the rules' left end whose readable values fall down the sheet, one per
     rule. Labels and rules pair **in order**: a leader line may push a
     thin layer's rule away from its label, the order never changes. A
     label that does not parse ("15O") is an unreadable boundary (ERROR,
     depth None, never interpolated); a mostly-letters word in that column
     ("TR1", a sample code) is not a level;
   * the **rows**: the words under each rule down to the next one,
     verbatim, lines joined by a space (words past the rule's right end
     included);
   * the **surface label**: words on the surface line, just above the
     first rule ("asfalt", "akker", "braak"), kept raw on the header
     (`surface_label`), never an interval;
   * **sample bars**: thin white (open) or black (filled) rectangles left of
     the level column, at least 1 pt high, with an id printed right of them
     (tight words joined as printed, kept verbatim with any trailing
     character); a coloured fill is lithology, never a bar. A bar is stored
     as drawn (top and base), never as a spot depth;
   * the **depth axis**: the leftmost column of 3+ numbers left of the level
     column lying on one line within 1.5 pt; a 2-label column only when
     none fits (the last sheet of a borehole may print two). A sheet
     printing a single label takes the slope of the previous sheet of the
     same borehole (`slope_from_page` on the provenance).
3. **Parse** (`BoreholePdfDigitiser`): depth = ground level - printed level
   (the header's ground level; a layout that prints none uses the first
   level of the first sheet, INFO). Sheets are joined
   (`borehole_sheet_join_helpers`): rows wholly above the previous sheet's
   cut level are reprints (the boorstaat repeats ~1 m) and are dropped when
   the earlier sheet printed the same text there; the row straddling the cut
   (or a row the previous sheet left open, on the same level) joins the
   previous sheet's last row into ONE interval when the text is the same.
   Any other overlap is kept as printed with a WARNING. An interval whose
   comma-separated phrases are all drill techniques ("Sonic Drill",
   "Edelmanboor", ...) and sample remarks ("steekbus niet vol", "geen
   monster", ...), at least one a remark, gets `lithology_absent_reason =
   "sampled"` and an empty `lithology_text`; its text stays the
   description. Samples are placed through each sheet's axis, merged by id
   over sheets and get `sample_label` (the printed prefix before the dash).
   X/Y without a named system -> EPSG 31370 with `crs_assumed` +
   `CRS_ASSUMED`; a water level without unit or reference and a digits-only
   value -> cm below ground with `unit_assumed` + `WATER_UNIT_ASSUMED`
   (both also on the provenance). A listed repeat that differs puts
   `REPEAT_DIFFERS` (the rows, the other print's key) on both prints; a
   dropped identical repeat puts `REPEAT_DROPPED` (INFO) on the kept print.

## Layout profiles (`borehole_layout_profile_constants.py`)

| Profile | Layout | Levels | Axis | Header |
|---|---|---|---|---|
| `boorstaat` | 149d / 24.13-002 boorstaten (+ the 21.04 report wording) | cm TAW, integers | cm below ground | "Boring:", "x-coordinaat [m Lambert72]:" (-> 31370), "Maaiveldhoogte in mTAW:" / "Hoogte tov TAW in m':" (-> 5710), "Grondwaterstand [cm-mv]:" (explicit) / "Grondwaterstand in cm':" (no reference -> cm below ground assumed), "Uitgevoerd op:", "Uitvoering door:", "Projectcode:", "Identificatie volgens NEN-EN-ISO 14688" |
| `boorprofiel` | CAMZ-007 location-A boorprofielen | m TAW, 2 decimals | elevation m TAW | "Boring:", "Datum:", "X:" / "Y:" (no system named -> 31370 assumed, `CRS_ASSUMED`), "GWS:" (no unit or reference -> cm below ground assumed, `WATER_UNIT_ASSUMED`), "Opmerking: Maaiveld = +6.01 TAW" when printed, "Projectcode:", "Bijlage:", "Pagina: n / N" |
| `generic` | any other log (scans, outlined text, other contractors) | - | - | triage only: classifies and names ("Boring nr:", "Location or core name"), reads no rows |

The boorstaat legend prints an open bar = "geroerd monster" and a filled bar =
"ongeroerd monster"; that profile maps the mark to that `sample_type`. No
other profile maps a mark (its legend was not checked).

## DigitisedBorehole (kept parallel to `DovBoringFileEntry`)

`header` (`BoreholePdfHeader` -> `Borehole`: name, x/y/epsg +
crs_assumed, ground_level_m/z_epsg -> elevation, total_depth_m, date,
driller -> executor, project code/name, remark, surface_label,
identification_standard, raw_fields), `intervals` (`DigitisedInterval`:
depth_top/base, printed levels and labels, description + lines, pages,
lithology_absent_reason, lithology_text (what the rule parser maps) -> the
layers of one lithological-description observation, description only),
`samples` (`DigitisedSample`: id -> sample_number, sample_label, depth
range as drawn, mark, sample_type, pages), `water_levels`
(`DigitisedWaterLevel` + unit_assumed, header only ->
`water_table_depth_m`), `provenance` (`source = "pdf-digitised"`,
`digitiser_version`, report name + SHA-256, profile, pages, text source per
page, per-sheet columns / axis fit / labels, `crs_assumed`,
`water_unit_assumed`), `issues` (`PDF_BOREHOLE_*` read defects, and the
bare-code findings the import asks the user about: `CRS_ASSUMED`,
`WATER_UNIT_ASSUMED`, `REPEAT_DIFFERS`, `REPEAT_DROPPED`; see
`borehole_pdf_constants.py`). `to_dict`/`from_dict` round-trip through JSON.

## Owner rulings (2026-10-08)

1. The word printed on the surface line ("asfalt", "akker", "braak") is the
   header note `surface_label`, never a layer; the first layer is the first
   printed interval (149d: 6.50 -> 6.40 mTAW, "Asfalt, Asfaltboor").
2. An interval printing only the drill technique / sample remark ("Sonic
   Drill, steekbus niet vol") is a layer with an EMPTY lithology
   (`lithology_absent_reason = "sampled"`, `lithology_text` empty), its raw
   text kept, its sample kept; a later grain-size result on that sample may
   fill it (a lab-link feature, not a parser rule).
3. X/Y printed without a named system are Lambert 72 (EPSG 31370,
   `crs_assumed`, `CRS_ASSUMED`); the import lets the user confirm: this
   test / every test of the report / another CRS from a list. Never silent,
   never blocking. A printed "[m Lambert72]" is not an assumption.
4. A water level printed as a bare number ("GWS: 380") or "in cm" without a
   reference ("Grondwaterstand in cm': 234") is cm BELOW GROUND (3.80,
   2.34 m), `unit_assumed` + `WATER_UNIT_ASSUMED`; an explicit reference
   ("[cm-mv]") is not an assumption.
5. A borehole printed again: identical over the overlap (depths,
   descriptions, samples) -> dropped with a notice; anything different ->
   both listed with `REPEAT_DIFFERS`, the user chooses which to withhold.
   Never merged.
6. Sample ids stay verbatim, trailing character included ("9-0550471461X");
   `sample_label` exposes the printed prefix ("S10", "9"): the lab reports
   reference the S-number.
7. A fixed-size sample box is stored as the interval as drawn (top/base),
   never a spot depth.

**No DOV code is set here.** The description -> codes path is the track
editor's rule parser (`desktop/.../utils/describedLithologyToCodes.ts`,
"Start from" a description track); phase 2 imports the description track and
the user codes it there.

## Running it (offline)

```
uv run python -m groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_cli \
    report.pdf [more.pdf ...] --out OUT [--ocr] [--overlays 3] [--overlay-pages 11] [--max-pages 200]
```

Writes `<stem>.digest.json`, `<stem>.boreholes.json`,
`<stem>.p<page>.overlay.png` (rules cyan, labels magenta, rows orange with
their depth range, samples green, axis ticks every metre) and `digest.md`
(every digest in OUT). OCR (`--ocr`, the `pdf-ocr` extra) caches page words
under `<DOV cache dir>/borehole_pdf/<sha>.ocr.json`. The runner is source-only
tooling: it is in the compiled manifest with the package, and `python -m`
does not run a compiled module.

## The import flow (API + dialog)

**Triage.** `POST /borehole/pdf/triage` spools the upload into its own
`PdfReportStore` (`<BOREHOLE_PDF_STORE_DIR>/<project>/<sha256>.pdf`; the
store class is shared with the CPT import, generic over the cached report,
but the root is separate so neither import prunes the other's reports) and
runs `TriageBoreholePdfReport` as a job: the triager (OCR when the `pdf-ocr`
extra is installed, words cached per report SHA-256 next to the file), then
the digitiser; progress `classify` per page (`ocr: true` on a page OCR read),
then `digitise`; a cooperative cancel checked before every page and between
OCR regions (`TriageCancelled`). The result is remembered in memory as a
`CachedBoreholePdfReport` (digest + parsed boreholes), so a second triage of
the same file answers at once. The stream's `done` result is
`to_triage_dict()`: the digest plus, per borehole, `parsed`, the interval and
sample counts, the water level and `water_unit_assumed`, every finding
(`level/code/message/params`) and `importable` (parsed, with a position and a
ground level: `IMPORT_BLOCKING_ISSUES`). The job plumbing, the upload spool
and the 404 shape are shared with the CPT routes
(`api/routers/_pdf_report_helpers.py`).

**Import.** `POST /borehole/pdf/import` runs `ImportBoreholePdf`. Each ticked
borehole is shaped by `DigitisedBoreholeAdapter` into a
`PdfBoreholeImportEntry` and stored through the DOV borehole ORM builders
(`dov_borehole_orm_builders`, the XML file import's own):

* identity: printed project code (`"PDF"` when none) + printed name;
* header -> `borehole` (X/Y, EPSG, ground level -> `elevation_m` with
  `elevation_source = "pdf"`, total depth, date, driller -> `executor`,
  water level -> `water_table_depth_m`); no drill segments, no field log;
* intervals -> ONE `lithological_description` observation, `source =
  "pdf-digitised"` (`TrackSource.PDF_DIGITISED`), one layer per interval with
  the printed description verbatim and no code; an interval without readable
  depths is not stored (`PDF_BOREHOLE_INTERVAL_NOT_STORED`);
* samples -> `sample` rows as drawn (top/base), id verbatim in
  `sample_number` (cut at 50 characters with `PDF_BOREHOLE_SAMPLE_ID_CUT`, the
  whole id in the description), the printed prefix in the new
  `sample.sample_label`, the legend's mark meaning in `sample_type`;
* `borehole.import_provenance` (JSONB, migration `p6d7e8f9a0b1`): the
  digitiser provenance plus the printed `header` in full (surface label,
  remark, project name, raw fields), `sampled_intervals_m` (ruling 2) and the
  user's `confirmations` (`crs: {epsg, scope}` or null,
  `water_unit_confirmed`).

Refused before anything is written (`BoreholePdfImportRefusedError` -> 422):
a key the triage did not parse (`borehole_pdf_borehole_not_offered`), an EPSG
outside 31370 / 28992 (`borehole_pdf_crs_unsupported`), a `CRS_ASSUMED` or
`WATER_UNIT_ASSUMED` finding without its answer
(`borehole_pdf_assumption_unconfirmed`; a CRS answer with scope `report`
answers every borehole of the import), two prints of one borehole
(`borehole_pdf_repeat_choose_one`). A borehole already in the project follows
the XML import's consent rule (409 + diff, nothing written; with
`confirm_refresh` the same id is refreshed: header, elevation unless manual,
provenance, the `pdf-digitised` track IN PLACE, samples matched by number +
top depth). A description track the engineer edited by hand is kept
(`PDF_BOREHOLE_EDITED_TRACK_KEPT`). A new borehole with no position or ground
level is skipped (`NOT_IMPORTED`); as a refresh it is refused
(`borehole_refresh_refused`). One commit per import.

**Dialog** (`desktop/.../components/boreholePdf/`): Data -> Import -> Boring ->
"Uit een pdf-rapport" (and File -> Boringen importeren, channel
`menu:import-borehole-pdf`) picks the report; `BoreholePdfImportDialog`
follows the triage through the shared registry (`hooks/pdfTriageRegistry.ts`,
spawn-or-attach, StrictMode-safe), `BoreholePdfTriageList` lists one row per
borehole (thumbnail through a blob URL, sheets, depth, X/Y, ground level,
date, counts, the OCR marker, the findings as notes in the app language via
`importFlagText`), `BoreholePdfQuestions` asks the two questions on the rows
that carry them ("Deze boring is Lambert 72" / "Alle boringen in dit rapport
zijn Lambert 72" / "Ander stelsel" + EPSG list; "cm onder maaiveld"). Import
stays disabled while a ticked row waits for an answer or two prints are
ticked. A 409 opens `BoreholeRefreshConfirmDialog`; the settled answer goes to
`useBoreholePdfImport` (toast, 10 s for several boreholes; adopted into the
project; the XML import's flags report).

**Not built:** typing X/Y or a ground level for a row that prints none (the
CPT dialog's header edit); an overlay view per borehole in the dialog; the
water / special constituent symbols drawn in the log, the standpipe column,
the coloured lithology column; scanned logs read row by row (OCR rows); more
layout profiles; a sample panel / lab link keyed on `sample_label`.
