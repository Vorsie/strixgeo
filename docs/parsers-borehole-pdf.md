# PDF borehole-log digitiser (phase 1: offline tooling)

Reads the borehole logs (boorstaten / boorprofielen) of a contractor's PDF
report back into depth intervals with their descriptions verbatim, samples
and the printed water level, so a campaign delivered only as a PDF can later
be imported like a DOV borehole XML file. The sibling of the CPT digitiser
([parsers-cpt-pdf.md](parsers-cpt-pdf.md)). Package:
`infrastructure/parsers/borehole/pdf/` (compiled to `.pyd` in the installer
like every parser module). Load before touching the borehole digitiser.

**Phase 1 (current):** triage, two layout profiles, sheet reading, the
per-borehole parse (`DigitisedBorehole`), overlays and an offline runner. No
API route, no desktop, nothing is stored.

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
   name, sheet range, printed X/Y/EPSG, ground level, date, driller, project
   code, depth covered, text-vs-OCR verdict, `repeat_of`) plus the sheets
   read, so the parse never reads a page twice. `max_pages` caps a huge
   report.
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
   * the **surface cover**: words just above the first rule ("asfalt",
     "akker"), kept raw on the header, not an interval;
   * **sample bars**: thin white (open) or black (filled) rectangles left of
     the level column with an id printed right of them (tight words joined
     as printed); a coloured fill is lithology, never a bar;
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
   Any other overlap is kept as printed with a WARNING. Samples are placed
   through each sheet's axis and merged by id over sheets.

## Layout profiles (`borehole_layout_profile_constants.py`)

| Profile | Layout | Levels | Axis | Header |
|---|---|---|---|---|
| `boorstaat` | 149d / 24.13-002 boorstaten (+ the 21.04 report wording) | cm TAW, integers | cm below ground | "Boring:", "x-coordinaat [m Lambert72]:" (-> 31370), "Maaiveldhoogte in mTAW:" / "Hoogte tov TAW in m':" (-> 5710), "Grondwaterstand [cm-mv]:", "Uitgevoerd op:", "Uitvoering door:", "Projectcode:", "Identificatie volgens NEN-EN-ISO 14688" |
| `boorprofiel` | CAMZ-007 location-A boorprofielen | m TAW, 2 decimals | elevation m TAW | "Boring:", "Datum:", "X:" / "Y:" (no system named -> EPSG None + WARNING), "GWS:" (unit not printed -> raw), "Opmerking: Maaiveld = +6.01 TAW" when printed, "Projectcode:", "Bijlage:", "Pagina: n / N" |
| `generic` | any other log (scans, outlined text, other contractors) | - | - | triage only: classifies and names ("Boring nr:", "Location or core name"), reads no rows |

The boorstaat legend prints an open bar = "geroerd monster" and a filled bar =
"ongeroerd monster"; that profile maps the mark to that `sample_type`. No
other profile maps a mark (its legend was not checked).

## DigitisedBorehole (kept parallel to `DovBoringFileEntry`)

`header` (`BoreholePdfHeader` -> `Borehole`: name, x/y/epsg,
ground_level_m/z_epsg -> elevation, total_depth_m, date, driller ->
executor, project code/name, remark, surface_text,
identification_standard, raw_fields), `intervals` (`DigitisedInterval`:
depth_top/base, printed levels and labels, description + lines, pages ->
the layers of one lithological-description observation, description only),
`samples` (`DigitisedSample`: id -> sample_number, depth range, mark,
sample_type, pages), `water_levels` (`DigitisedWaterLevel`, header only ->
`water_table_depth_m`), `provenance` (`source = "pdf-digitised"`,
`digitiser_version`, report name + SHA-256, profile, pages, text source per
page, per-sheet columns / axis fit / labels), `issues`
(`PDF_BOREHOLE_*`, see `borehole_pdf_constants.py`). `to_dict`/`from_dict`
round-trip through JSON.

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

## Phase 2 (not built)

Routes like the CPT digitiser's (`POST /borehole/pdf/triage` as a job with a
spooled report store, `.../import`), an `ImportBoreholeFile`-style consented
import (refresh confirmation, provenance on the borehole), a desktop triage
dialog listing the boreholes with their overlays, the description track
coded through the track editor. Open for later: the water / special
constituent symbols drawn in the log, the standpipe column, the coloured
lithology column, scanned logs (OCR rows), more layout profiles.
