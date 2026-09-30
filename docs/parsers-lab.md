# Raw lab exports — the three formats and their findings

Current state (2026-09-30). Owner rule 2026-09-28: "geolib uses already
processed files, we need to get the raw data in the db". Owner 2026-09-29 (Q1):
"what we have is what we have, no other exports" — the listings and dumps below
ARE the raw data; there is no native file and no machine log to import.

Code: `src/groundmodel/infrastructure/parsers/lab/raw_export/`. Entry point
`LabExportReader.read(bytes, source_name)` sniffs the kind from the CONTENT
(never the name or extension) and hands the text to one of three parsers. All
return plain dataclasses + `ValidationIssue` findings; nothing is derived.

**A generic importer (owner ruling 2026-09-30).** The lab program that writes
these exports is never named in Strix — not in the UI, the code, the docs or
the fixtures; the formats are described by what they are. A file that is none
of the three raises `LabFileFormatNotRecognisedError` (a `ParseError`); the
preview and the import answer **400** `code = "lab_file_format_not_recognised"`
with "This file format is not recognised. Contact the StrixGeo dev team to have
it added." and the desktop dialog lists the file (in the user's language) and
moves on to the next. A new format = a new parser + a sniff rule in
`lab_export_reader.detect_lab_export_format`.

**Missing borehole → DOV (owner 2026-09-30).** When no project borehole's name
ends with `<job>-<borehole>`, the preview asks DOV for it
(`DovBoreholeClient.find_by_name`: WFS `dov-pub:Boringen`, `CQL_FILTER =
boornummer ILIKE '%<job>-<borehole>'`, sieved with the same ends-with rule; DOV
often prefixes the name, e.g. `1445-GEO-25/022-B17`) and imports it through the
bbox import's building blocks (`ImportBoreholeDov.execute_by_name`: per-permkey
XML download + parse, the same persist phase, interpretations + samples over a
50 m box around the borehole, one commit). The preview's `dov_lookup` says
`fetched` (proposed), `not_found` or `unreachable` (timeout / no network / DOV
error: never a 500); in the last two cases nothing is proposed and the file is
not imported unless the user picks another borehole. This is the ONE write the
preview makes (the borehole, never the lab test).
Fixtures: `tests/fixtures/lab/` (names stripped by
`scripts/anonymise_lab_fixtures.py`, repeatable, label-driven).

## 1. Incremental-loading oedometer control listing — `OedometerControlListingParser`

`*-LstSMControleListing.txt|.csv`. ISO-8859-1, CRLF, `;` or TAB (sniffed),
Belgian decimal comma. Sniff: a `TRAP : NN <direction> : <kg> kg op het apparaat
<kPa> kPa op het monster` line. Header `label :;value` (job, borehole, sequence,
sample number, sampling depth = the SAMPLE interval, specimen dimensions, lever
ratio, dial coefficient in mm per gauge unit, mounting date, native `.OCT` file,
program version). Per stage every reading: timestamp, dial (gauge units),
elapsed min, stage settlement mm, cumulative settlement mm; the stage footer
`hi,0= … Zetting= … A|C= …`. The lab's per-stage table (`Trap;Druk;Dhi;h;…;e;
C (A);av;mv;Cc`) is read once (the listing prints it twice). Stored as source
format `oed_control_listing`.

## 2. Oedometer stage export (newer module) — `OedometerNewExportParser`

Format after geolib_rvo `gui/gui_03_consolidatie.lees_nieuwe_module` (the
owner's own library). `uit_nieuwemodule.csv`: UTF-8 WITH a BOM, `;`. Header
lines `#<label>: <value>;;;;;;;;` (dossier = job, sample number, test name,
specimen height / diameter / mass, lever ratio, initial water content). Rows
between `#START_METINGEN` and `#EINDE_METINGEN` (the sniff): stage number,
timestamp (`dd/mm/yyyy hh:mm:ss.fff`), s since test start, s since stage start,
dial in **mm**, cumulative and stage deformation mm, hanger load kg, min since
stage start. **No borehole, no sampling depth, no stage stress, no direction
token, no lab summary** — the preview asks for the borehole and the new sample's
interval. Stored as `oed_new_module_raw`; the load and the two seconds
columns become their own measured channels.

(The same module's "klantenrapport" CSV is processed output — no readings — and
is not imported.)

## 3. Triaxial raw per-point dump — `TriaxialRawDumpParser`

`cd.txt` / `cu.txt` (TX module) and `advtx*.txt` (Advanced TX); one test per
file. Sniff: `Identificatiegegevens deelmonster` + a `Meetpunt` table. TAB
header, 18-character fixed-width point table (a whitespace split misreads the UU
blank slots). Measured: Kracht (N), Verpl. (µm), Stnsp. (kPa), P.W.S. (kPa), dV
(cm³, drained only). Lab-derived: Verv. (%), Sigma 1-3, Sigma' 3/1, ratios,
total stresses. **No time column**: stored against the lab's point numbers.
Stored as `tx_point_dump`. The before / after table and the failure mode are
stored as lab-reported values. The Controle / Definitieve listings (φ′, c′, B,
back pressure) are NOT parsed.

## Findings (shown in the import preview and frozen on the test)

| Code | Level | Where | Meaning |
|---|---|---|---|
| `MISSING_SAMPLE_IDENTITY` | error | all | no borehole / sample number (listing, dump) or no sample number (new module) |
| `MISSING_SAMPLING_DEPTH` | warning | listing | depth interval unreadable |
| `NO_BOREHOLE_IN_EXPORT` | info | new module | the export names no borehole and no depth — pick them |
| `UNREADABLE_ROW` / `UNREADABLE_VALUE` | error | all | a row / cell that is not what the format says (value kept as null) |
| `EMPTY_STAGE` | warning | oedometer | a stage with no reading |
| `ELAPSED_TIME_NOT_MONOTONIC` | warning | oedometer | elapsed time steps back inside a stage |
| `DIAL_REZERO` | warning | oedometer | repeated timestamp, dial jumps, settlement flat: the gauge was re-zeroed; the duplicate reading is kept and marked in the stage's `rezero_indices` so plots and counts skip it |
| `DUPLICATE_TIMESTAMP` | info | oedometer | two readings share a timestamp (no re-zero) |
| `SETTLEMENT_STEPS_BACK` | info / warning | oedometer | the stage's last reading sits back from its own peak settlement; ≤ 2 print steps (0.0021 mm) = rounding (info), more = warning |
| `STAGE_SHORT` | info | listing | fewer readings than the file's usual per-stage count |
| `STRESS_NOT_REPRODUCED` / `STRESS_NOT_CHECKED` | warning / info | listing | hanger kg × lever × 9.81 / area vs the listed stress |
| `HEIGHT_CHAIN_BROKEN` | warning | listing | a stage does not start at the previous start height minus its settlement |
| `LOAD_CHANGES_IN_STAGE` | warning | new module | the logged load changes inside one stage |
| `UNREADABLE_DATE` / `UNREADABLE_SUMMARY_VALUE` | warning | listing | header date / lab table cell unreadable |
| `NO_TIME_CHANNEL` | info | triaxial | always: no time axis in the dump |
| `READINGS_BEFORE_ZERO_NOT_IN_FILE` | info | triaxial | the table starts at the lab's zero point > 1 |
| `SPECIMEN_LETTER_GAP` | info | triaxial | a specimen letter is missing (set inactive) |
| `POINT_NUMBER_GAP` / `DISPLACEMENT_NOT_MONOTONIC` | warning | triaxial | sequence breaks |
| `DEVIATOR_OFFSET_AT_ZERO_FORCE` / `STRAIN_OFFSET_AT_ZERO_DISPLACEMENT` | warning | triaxial | the lab-derived columns carry a correction from point 1 |
| `CHANNEL_CONSTANT` | info | triaxial | a channel with one value at every point (probably not logged); values kept |
| `UNKNOWN_CHANNEL` / `VALUE_UNDER_BLANK_HEADER` | info / warning | triaxial | unclassified column kept as lab-derived / a value under a blank header dropped |

## Derived by Strix

One value only, on request of the owner ("can we add delta_h/h0 from
il-oedometer?"): the oedometer **vertical strain** epsilon_v = delta_h / h0 per
reading, delta_h = the cumulative settlement column (which already bridges a
re-zero), h0 = the header's initial height. Stored as channel `vertical_strain`,
provenance `derived`, `formula = "epsilon_v = delta_h / h0"`,
`derivation_inputs = {h0_mm, delta_h_channel}`. Everything else the lab
computed stays the lab's (`lab_derived` channels, `lab_reported` rows).
