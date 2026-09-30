# Lab raw-data import — oedometer + triaxial raw exports (BUILT, phase 2)

Status: BUILT (phase 2, 2026-09-29): parsers, schema, import preview + import,
bundle round-trip, the borehole Lab tests list and the readings viewer. §6
records the owner's answers and where the build departs from this proposal.
The format / findings reference is [../parsers-lab.md](../parsers-lab.md).

Owner rule (2026-09-28): "geolib uses already processed files, we need to get the
raw data in the db". The target is the per-reading measurement series, not the
lab's summary tables. The summary / definitive listings are secondary: identity,
metadata, cross-checks.

Material: `labformats/qsdf/fileformats/` (scratchpad), three families, exported
by the lab's software (the listings name the native files
`I:\geo\data\<job>\<name>.OCT` / `.TRX` / `.ATT` and the program version).
Owner ruling 2026-09-30: the program is never named anywhere in Strix; the
formats are described by what they are.

---

## 1. Format inventory

### 1.0 Common to every file

| Property | Finding |
|---|---|
| Encoding | ISO-8859-1 (`ë` = 0xEB, `³`, `²`, `µ`, `°`). UTF-8 decoding fails. |
| Line ends | CRLF. |
| Numbers | Belgian locale: decimal COMMA, optional exponent (`-5,999565E-03`), no thousands separator. Timestamps carry comma milliseconds (`07:58:47,282`). No file mixes `.` and `,` as decimal separator. |
| Delimiter | `;` or TAB — NOT tied to the extension. Controle listings: `;` in both `.csv` and `.txt`. `200568B7-LstSMResultatenListing.txt` is TAB, `200569B7-LstSMResultatenListing.txt` is `;`. Triaxial `.txt` listings use TAB where the `.csv` uses `;`. Raw triaxial dumps: TAB header + 18-char fixed-width table. |
| Dates | Three spellings: `03/06/2020` (readings), `03/06/20` (oed mounting date), `2/07/2020` / `26/9/25` (stamps, ATT start date). |
| File names | 8.3 DOS names: `<6-digit sample number><2 chars>`. `200568B7` = sample 20/0568, borehole **B7A** truncated; `250389B1` = sample 25/0389, borehole **B17** truncated; `250448_0` = sample 25/0448, borehole B18 (no borehole chars at all). **The file name is NOT an identity** — read the labelled header. |

### 1.1 Oedometer (`samendrukking/`)

`old/` holds two tests; `new/` was empty. The newer module's RAW export was
found in the owner's own library (geolib_rvo gallery data
`uit_nieuwemodule.csv`) and is imported too — see parsers-lab.md §2.

| File | Size | What it is |
|---|---|---|
| `200568B7-LstSMControleListing.txt` + `.csv` | 50 129 B each | Control listing, sample 20/0568 (B7A, N002, 14,50-15,00 m). **Byte-identical pair.** 16 stages, 800 readings. |
| `200569B7-LstSMControleListing.txt` | 52 903 B | Sample 20/0569 (B7A, N003, 20,00-20,50 m). No `.csv` twin. 17 stages, 848 readings. |
| `200568B7-LstSMResultatenListing.txt` / `.csv` | 1 588 B each | Results listing. Pair differs ONLY in delimiter (TAB vs `;`). |
| `200569B7-LstSMResultatenListing.txt` | 1 642 B | Results listing, `;`-delimited despite `.txt`. |
| `200568B7.DAT`, `200569B7.DAT` | 36 KB | Quoted CSV (`"key","value"` lines, then tables). |

**Control listing** (`;`): a `label :;value` header (job, origin, borehole,
sequence, sample number, depth, description, height, diameter, masses, water
content, grain density + how obtained, apparatus, lever ratio
`Overbrengingsverhouding kracht`, dial coefficient `Coëff. meethorloge`,
mounting date, remarks), then per stage:

```
TRAP : 01 Belasting : 3,05 kg op het apparaat    93,568 kPa op het monster
Afgelezen tijd;;Afgelezen;Tijd;Zetting;Totale zetting
;;verplaatsing;(min);(mm);(mm)
03/06/2020 07:58:47,282;-8,742;0,00;0,000;0,000
...
hi,0= 19,960 mm  Zetting= 0,751 mm            (+ "  A= 1271,0" / "  C= 713,7" from stage 2)
```

Columns per reading: absolute timestamp; raw dial reading ("afgelezen
verplaatsing", gauge units, coefficient -1 mm/unit); elapsed time (min); stage
settlement (mm); cumulative settlement (mm). Stage direction token: `Belasting`
(loading) / `Ontlasting` (unloading) — reloading is not a separate token.
After the stages: the lab's per-stage table `Trap;Druk;Dhi;h;volumemassa droog;e;C (A);av;mv;Cc`,
an EMPTY `Trap;Druk;s0;t;st;s100;cv;k` table (the lab computed no cv / k),
`Algemene gegevens` (CreationMark, LastModifiedMark, Filename = native `.OCT`,
Version), then `Controlegrafiek` chart-axis numbers and a SECOND copy of both
tables and the general section.

**`.DAT` vs listing** — the `.DAT` holds the same readings (`Trap;Tijd;Zetting;Totale Zetting`,
verified identical on all 1 648 readings to 0.005 min / 0.0000 mm) but WITHOUT
timestamps and dial values, plus extra header fields (masses to 0.001 g, area
`Oppervlakte`, `EquivalenteHoogte` Hs, e0, ρd0, last loading/unloading steps) and
the lab's per-stage derived tables. **The control listing is the raw source of
truth**; the `.DAT` is a secondary cross-check. Both are renderings of the
native `.OCT`, which we do not have.

**Results listing**: rounded header + the per-stage derived table only (no
readings). Secondary.

Reproduced from the raw data with simple formulas:

* stage stress = hanger kg × lever ratio × 9.81 / (π d²/4) — every stage of both
  files to ≤ 0.06 kPa (with g = 9.80665 up to 0.5 kPa off → the lab uses 9.81).
* stage settlement = (dial − dial at stage start) × coefficient — exact, EXCEPT
  at the two re-zero events below.
* e0 = Gs / ρd0 − 1 with ρd0 = (M / (1+w)) / (A·H0) → 0.6824 (listed 0.682);
  stage e = (h − Hs)/Hs with Hs = 11.864 mm → 0.619 (listed 0.619).
* height chain hi,0(n+1) = hi,0(n) − Zetting(n) — holds on every stage.
* elapsed "Tijd" = timestamp − first timestamp of the stage — to 0.006 min.

### 1.2 Triaxial, TX module (`tx/`)

| File | Size | What it is |
|---|---|---|
| `250389B1-LstTrxControleListing.csv` / `.txt` | 22 070 B | Control listing, CD, sample 25/0389 (GEO-25/022, B17, N003, 5,00-5,50 m), 3 specimens. Pair identical modulo TAB↔`;`. |
| `250389B1-LstTrxDefinitieveListing.csv` / `.txt` | 15 401 B | Definitive (report) listing, same test. Pair identical modulo delimiter. |
| `cd.txt` | 808 KB | **Raw per-point dump of the SAME test** (25/0389 CD): specimens a/b/c, 1130 / 1139 / 1133 points. |
| `cu.txt` | 518 KB | Raw dump of a DIFFERENT test: CU, sample **20/0670, GEO-19/122, B8A**, 16,00-16,50 m; specimens a/b, 1132 / 1049 points. **No listing for it in the material.** |

**The raw dumps are ONE test each** (one sample, n specimens), not many tests
concatenated. Structure: `Gegevens van het monster` header (TAB-separated
`label:<tabs>value`), then per specimen `Identificatiegegevens deelmonster <TAB>a`,
its metadata (strain rate, grain density — labelled `Volumemassa` —, initial
height/diameter/mass, import file `Normalised`, consolidation stress and dV,
post-test masses and dV, failure mode, before/after geometry pairs, calibration
a/b per channel — all a=1, b=0), then:

```
Meetpunt          Kracht            Verpl.            Stnsp.            P.W.S.            Verv.             Sigma 1-3         Sigma' 3           Sigma' 1         dV
60                0                 0                 595,4404          499,2014          0                 0                 96,23898          96,23898          0
```

Fixed-width, 18-char columns, left-aligned (verified: slicing at 18 reproduces
every label and value in all five dumps). File ends with two dash lines.

Channels: **measured** = Kracht (force, N), Verpl. (displacement, µm), Stnsp.
(cell pressure, kPa), P.W.S. (pore pressure, kPa), dV (volume change, cm³,
drained only). **Lab-derived** = Verv. (axial strain, %), Sigma 1-3, Sigma' 3,
Sigma' 1, and in CU dumps Sigma'1/Sigma'3, Sigma 3, Sigma 1, Sigma1/Sigma3.

**Listings vs dump**: the Controle and Definitieve listings print a ~43-row
subsample (first 10 points, then every ~33rd) of this same table, rounded
(max |ΔF|, |Δdisp| = 0.005 N / µm at shared point numbers). Their rows carry one
fewer leading cell than their header (header `;Meet;Kracht;…`, rows `60 ;0,00 ;…`).
Controle = per-specimen blocks with everything (zero readings, burette readings,
masses before/after, B-value, consolidation, the subsampled table, "Waarden bij
breukcriterium" at the failure point, E50). Definitieve = the report: a
specimen-per-column table (specimen depth interval, drainage conditions, back
pressure, consolidation strains, failure values) **plus the lab's φ′ / c′**.

**What the TX dump is NOT** (i.e. how "raw" it really is):

* No time column at all. The shear phase has no time axis; only the set rate
  (0,020 mm/min) is known.
* No saturation / consolidation / B-check readings — only their totals.
* Starts at the lab's chosen zero reading (point 60 / 51 / 57 in cd.txt, 26 / 14
  in cu.txt): **earlier readings are not in the file**, and force and
  displacement are already zero-referenced (`Nulaflezing kracht 211,7106 N`).
* `Importbestand: Normalised` — the GDS machine log was imported/normalised
  before this dump.

### 1.3 Triaxial, Advanced TX module (`AdvancedTriaxiaalTesting/`)

| File | Pairs with | Test |
|---|---|---|
| `250388B1-LstAttControleListing.txt` (5.7 KB) | `advtxuutxt.txt` (96 KB) | UU, 25/0388, B17, N002, 4,00-4,50 m, 1 specimen, 399 points. **No Definitieve listing.** |
| `250448_0-LstAttControleListing.txt` + `…DefinitieveListing.txt` | `advtxcutxt.txt` (509 KB) | CU, 25/0448, B18, N002, 4,00-4,50 m, 3 specimens, 708 / 717 / 709 points. |
| `250450B1-LstAttControleListing.txt` + `…DefinitieveListing.txt` | `advtxtxt.txt` (142 KB) | CD, 25/0450, B18, N004, 8,50-9,00 m, specimens **a and c** (b set inactive: "Aantal deelproeven actief: 2"). 309 / 276 points. |

Same dump layout and same listing layout as TX. Differences: native `.ATT`,
program v1.0.17 (TX: `.TRX`, v1.2.243); `Importbestand: -`, `Gebruikte pers: -`,
`Gebruikt ijkbestand: -`; the zero reading is point 1 (nothing cut); far fewer
points; displacement zero with decimals (`11,7000 µm`); a UU variant (ISO
17892-8) whose table has BLANK header slots where the effective stresses sit.

### 1.4 Weird-flag list

Oedometer

1. `new/` was empty — the newer module's raw export came from geolib_rvo instead.
2. **Gauge re-zero**: 20/0569 stage 10 and stage 13 each carry a repeated
   timestamp where the dial jumps 0.086 mm / 1.669 mm while the settlement column
   does not move. The dial column is therefore NOT a continuous raw series; the
   settlement column is the lab-corrected continuous one. (Stages 10 and 13 have
   51 readings; stage 2 of 20/0569 has 46; all others 50.)
3. Sampling depth disagrees: `.DAT` `14,90-15,00` vs listings `14,50-15,00`
   (20/0568); `20,30-20,35` vs `20,00-20,50` (20/0569). Likely the `.DAT` holds the
   SPECIMEN interval, the listing the SAMPLE interval — unconfirmed.
4. Visual description differs between `.DAT` ("sterk kalkh, zand met beetje
   klei") and listing ("sterk kalkh. weinig kleih. zand").
5. Grain density provenance contradicts itself: control listing "(uit volumemassa
   - watergehaltebepaling)", results listing "(aangenomen)" = assumed, same 2,65.
6. Column header has 6 cells, reading rows 5 (`Afgelezen tijd;;Afgelezen;…`).
7. The listing prints its tables and general section twice (before and after the
   chart-axis dump).
8. Program version date (12/10/2022) is AFTER the listing's creation mark
   (2/07/2020): the listing was re-rendered from the `.OCT` later.
9. The cv / k table and the `.DAT` `Primzetting` block are EMPTY: the lab did not
   compute cv / t50 — they can only come from the raw readings (which is why the
   timestamps must be kept).
10. Only ~50 readings per stage over 20–98 h: log-spaced then hourly. Whether this
    is the logger's full record or a thinning by the lab software is unknown.

Triaxial

11. Dumps are one test each (not concatenated); `cu.txt` has no listing and belongs
    to a different job (GEO-19/122, 2020) than everything else in `tx/`.
12. No time channel; no consolidation / saturation readings; readings before the
    zero point are cut (TX); force/displacement already zero-referenced.
13. **CU deviator offset**: every CU specimen (cu.txt a/b, advtxcutxt a/b/c) starts
    at sigma1-3 = −10 kPa at zero force. A constant correction applied from point 1.
14. **Deviator not reproducible as F/A exactly**: CD (with dV area correction) and
    UU reproduce as F / A_corr minus a residual that grows exactly 0.225 kPa per %
    axial strain (−4.5 kPa at 20 %) on every specimen → a membrane correction whose
    parameters are not in the file. CU = −10 kPa − the same membrane term, plus an
    unexplained extra residual on cu.txt b and advtxcutxt (the 250448_0 listing
    says "verwerkt met massaverschil" = processed with the mass difference, so the
    lab's consolidated volume is not the file's dV).
15. **Strain not reproducible on cu.txt specimen b**: −0.38 % strain at zero
    displacement; displacement/strain gives heights from 79.8 to 136 mm. On every
    other specimen strain = displacement / h_c with h_c = V_c / A_c (e.g. 87.537 mm
    for cd.txt a, listed A_c 1127,67 mm², V_c 98713 mm³).
16. `σ'3 = cell − pore pressure` holds to 0.0001 kPa everywhere (sanity OK).
17. UU dump: blank header slots (no effective stresses) — a width-based reader is
    required; a whitespace-split reader misassigns columns.
18. Line gluing in listings: `…E'50-modulus; = 22,2 MPa;Gegevens van het monster`,
    `Version & date :;v1.0.17 (…);;D;h;v;ss;…` (a results table header glued onto
    the version line), `Triaxiaalproef : ICDNBN EN ISO 17892-9:2018`,
    `Isotroop Geconsolideerd GedraineerdNBN EN …`.
19. `250388B1` has no Definitieve listing; `Volumeverandering … : ; cm³` (empty
    value with unit) in it.
20. Specimen depth interval printed with mixed precision (`8,8 - 8,90`).
21. `Nulaflezing` lines end with a sentence period (`211,7106 N.`).
22. The Definitieve listings carry the lab's **φ′ and c′** (e.g. 30° / 26 kPa) and
    E50 / Eu50 — lab-reported design-flavoured values (see open question 5).

---

## 2. Schema proposal (additive only)

### 2.1 Where it fits

`LabTest` hangs off `Sample` (domain-model.md). The six existing families are
scalar or one-curve rows. A raw oedometer / triaxial test is a 3-level shape —
test → specimen → stage → channels — so it is a NEW typed family (the
catch-all-vs-typed rule (a): structural columns the catch-all cannot express).
One family for both kinds, discriminated by `kind`, because the storage shape
(specimens × stages × named channel arrays) is identical and the next lab tests
(direct shear, CRS, permeability) fit it too.

### 2.2 Tables

```
lab_series_test                one per imported test, FK sample.id ON DELETE CASCADE
  id uuid7 PK
  sample_id uuid FK sample
  kind                TEXT  'oedometer' | 'triaxial'           (our vocabulary)
  test_type_token     TEXT  lab token verbatim: 'CD' 'CU' 'UU' (NULL for oedometer)
  standard_token      TEXT  e.g. 'NBN EN ISO 17892-9:2018' when a listing names it
  lab_job_number      TEXT  'GEO-25/022'
  lab_sample_number   TEXT  '25/0389'
  lab_borehole_name   TEXT  'B17'      (as the lab writes it; the match is on sample_id)
  lab_sequence_number TEXT  'N003'
  sampling_depth_top_m / sampling_depth_base_m  DOUBLE  (lab's, pass-through)
  visual_description  TEXT
  test_start_date     DATE NULL
  source_format       TEXT  'oed_control_listing' | 'tx_point_dump'
  source_file_name    TEXT  the imported file name
  source_sha256       TEXT  content hash (idempotency)
  source_native_file  TEXT  'I:\geo\data\19122\200568B7.OCT'
  source_program_version TEXT
  source_header       JSONB every header label → value verbatim (display only)
  import_issues       JSONB the parser findings frozen at import (code, level, message)
  n_specimens         INT   (denormalised, §4)
  created_at / updated_at

lab_series_specimen            one per specimen ('a','b','c'; oedometer: one row, label NULL)
  id, test_id FK lab_series_test CASCADE
  specimen_label      TEXT
  initial_height_mm, initial_diameter_mm, initial_wet_mass_g, dry_mass_g,
  initial_water_content_pct, grain_density_t_m3, grain_density_note TEXT,
  specimen_depth_top_m / _base_m (TX listing 'Diepte interval proefstuk'; oed .DAT?)
  strain_rate_mm_per_min, consolidation_stress_kpa, consolidation_volume_change_cm3,
  back_pressure_kpa, b_value,                       (from the listing when paired)
  apparatus_id TEXT (oed frame / GDS press), lever_ratio, dial_coefficient_mm_per_unit,
  mounting_date DATE, failure_description TEXT, calibration JSONB,
  source_header JSONB
  n_points INT (denormalised)

lab_series_stage               one per stage per specimen
  id, specimen_id FK CASCADE
  stage_index         INT   1-based, test order
  stage_kind          TEXT  'load_step' (oed) | 'shear' (tx); later 'saturation',
                            'consolidation' when an export carries them
  direction_token     TEXT  'Belasting' / 'Ontlasting' verbatim (oed); NULL (tx)
  hanger_load_kg, target_stress_kpa           (oed, pass-through)
  height_at_start_mm                          (oed 'hi,0', pass-through)
  lab_stage_settlement_mm, lab_coefficient_label, lab_coefficient   (lab-derived)
  started_at          TIMESTAMP NULL (first reading)
  reading_timestamps  TIMESTAMP[] NULL        (oed; absolute, raw)
  point_numbers       INT[] NULL              (tx; the lab's point numbers)
  n_readings          INT (denormalised)

lab_series_channel             one per channel per stage — the series arrays
  id, stage_id FK CASCADE
  channel_key   TEXT   canonical: 'elapsed_min','dial_reading','settlement_mm',
                       'total_settlement_mm','force_n','displacement_um',
                       'cell_pressure_kpa','pore_pressure_kpa','volume_change_cm3',
                       'axial_strain_pct','deviator_stress_kpa', …
  source_label  TEXT   the lab's column label verbatim ('Verpl.', 'Zetting')
  unit          TEXT
  provenance    TEXT   'measured' | 'lab_derived'   (Data Integrity §1: a lab-derived
                       channel is stored pass-through but can never be shown or
                       exported as a measurement)
  values        DOUBLE PRECISION[]  (NULL elements allowed = unreadable cell)
  UNIQUE (stage_id, channel_key)

lab_series_lab_result          the lab's summary rows, pass-through, secondary
  id, test_id FK, specimen_id FK NULL, stage_index INT NULL,
  parameter TEXT (lab label verbatim, e.g. 'e', 'Cc', "s'1/s'3 at failure", "j'"),
  value_numeric, value_text, unit
```

### 2.3 Arrays per channel vs row-per-reading

Arrays, like `cpt_series` and `grain_size`:

* Volume: a triaxial test ≈ 3 specimens × 1 130 points × 10-13 channels ≈ 40 k
  values; an oedometer ≈ 1 000 readings × 5 channels. A project with 50 tests is
  ~2 M values: ~2 k channel rows as arrays vs ~2 M reading rows.
* Access is always "the whole series of one specimen" (plot, export, downstream
  analysis) — one indexed fetch per specimen. No workload queries individual
  readings across tests in SQL.
* Channel-per-row (not a fixed column per channel) because the channel set
  differs per test type (dV only drained, total stresses only CU, empty effective
  stresses in UU, unknown future channels), and because each channel needs its own
  `provenance`, `unit`, `source_label`. A fixed wide row would need ~15 nullable
  arrays plus 15 provenance columns.
* Cost accepted: cross-test SQL over readings needs unnest — same trade-off as
  grain_size, same escape hatch (denormalised summaries when a query needs it).

### 2.4 Raw vs derived (Data Integrity rules 1-2)

* Measured channels and every header value are pass-through (rule 2).
* The lab's strain / stress / e / Cc / cv / φ′ / c′ are the LAB's derivations:
  stored pass-through with `provenance = 'lab_derived'` (channels) or in
  `lab_series_lab_result` (tables) — never recomputed at ingest, never promoted to
  a measurement. Strix computes nothing in this slice.
* The oedometer settlement column is kept as the lab gives it (it bridges the
  gauge re-zeros); the raw dial column is kept too (`dial_reading`, measured) so
  the re-zero stays auditable.

### 2.5 Idempotent re-import (refresh, not skip)

Natural key: `(sample_id, kind, test_type_token, lab_sample_number)` plus
`source_native_file` when present. Re-import of the same key:

* same `source_sha256` → no-op, reported "unchanged";
* different content → the CPT pattern: `409 lab_series_refresh_confirmation_required`
  + a diff (specimens, point counts, changed header values) unless
  `confirm_refresh=true`; then specimens / stages / channels are replaced in one
  transaction, **same test id**. A parse with ERROR findings never overwrites.

### 2.6 Bundle (`.strix`)

Additive, no version bump: each bundle sample gains an optional
`lab_series_tests: [...]` array (test → specimens → stages → channels, arrays as
JSON lists). Missing key → `[]`. `format_version` stays 4, `.strix` stays 3. The
`LAB_TEST_FAMILIES` registry assumes a flat leaf ORM per family, so this family
needs its own nested builder/serialiser (or a nested hook on the registry), plus
caps (tests per sample, points per stage) in the restore path. An older build
opening a newer file drops the key silently (forward-compat loss — acceptable,
flagged in release notes). Size: ~40 k floats per triaxial test ≈ 0.5 MB JSON
before the `.strix` gzip.

### 2.7 Minimum testable slice (phase 2)

Import (preview + commit) → list tests per sample in the borehole detail → view
raw readings (one chart per stage / specimen: settlement vs log time; q vs axial
displacement; pore pressure; volume change) → bundle round-trip. No analysis,
no cv / Cc / φ′ computed by Strix.

---

## 3. Import entry

* **What the user picks**: one or more FILES in an "Import lab tests"
  dialog. The kind is sniffed from CONTENT (`TRAP :` → oedometer control listing;
  `Identificatiegegevens deelmonster` + `Meetpunt` → triaxial dump), never from the
  extension or the name (`cd.txt` is not unique; `.csv`/`.txt` do not fix the
  delimiter).
  * Oedometer: the **control listing** (`*-LstSMControleListing.txt|.csv`). The
    `.DAT` and results listing are not needed (optional cross-check later).
  * Triaxial: the **raw dump** (one per test). The Definitieve / Controle listing is
    an OPTIONAL companion that adds specimen depth interval, B-value, back pressure,
    start date and the lab's failure values / φ′ / c′; paired by
    (lab sample number, test type).
  * A folder pick is a convenience over the same per-file sniffing.
* **Matching to the project**:
  1. Borehole: the lab writes job `GEO-25/022` + borehole `B17`; DOV names
     boreholes `GEO-25/022-B17` (sometimes with a prefix, `1411-GEO-24/159-B2`).
     Rule: a project borehole whose name ends with `<job>-<borehole>` (case- and
     space-insensitive); exactly one hit → auto; zero or several → the user picks
     in the preview. Never the file name.
  2. Sample: an existing sample on that borehole whose interval overlaps the lab's
     sampling interval (or whose `sample_number` equals the lab's) → attach; none →
     create a sample (interval + `sample_number` from the lab), shown as "new
     sample" in the preview.
* **Flags shown at import** (from the parsers, per file): `MISSING_SAMPLE_IDENTITY`
  (blocks), `DIAL_REZERO`, `DUPLICATE_TIMESTAMP`, `ELAPSED_TIME_NOT_MONOTONIC`,
  `STRESS_NOT_REPRODUCED`, `HEIGHT_CHAIN_BROKEN`, `EMPTY_STAGE`,
  `NO_TIME_CHANNEL`, `READINGS_BEFORE_ZERO_NOT_IN_FILE`, `SPECIMEN_LETTER_GAP`,
  `DEVIATOR_OFFSET_AT_ZERO_FORCE`, `STRAIN_OFFSET_AT_ZERO_DISPLACEMENT`,
  `DISPLACEMENT_NOT_MONOTONIC`, `POINT_NUMBER_GAP`, `UNREADABLE_VALUE`,
  `UNKNOWN_CHANNEL`, `VALUE_UNDER_BLANK_HEADER`, plus the matcher's
  "borehole not found / ambiguous" and "new sample will be created".

---

## 4. Parsers written in phase 1

`src/groundmodel/infrastructure/parsers/lab/raw_export/` (pure, plain dataclasses,
`ValidationIssue` findings, `GroundModelLogger`):

* `OedometerControlListingParser` → `OedometerListingResult` (header, stages with
  every reading: timestamp, dial, elapsed, settlement, total; the lab summary table;
  findings). Delimiter sniffed.
* `TriaxialRawDumpParser` → `TriaxialDumpResult` (identity, specimens with
  `measured` / `lab_derived` / `unclassified` channel dicts, metadata; findings).
  Serves TX and Advanced TX.

Not written: `.DAT` parser, results / definitive listing parsers (secondary).

## 5. Open questions for the owner

Answered 2026-09-29 — see §6.

## 6. Owner answers (2026-09-29) and the build

1. "no what we have is what we have, no other exports" — the listings and
   dumps are the raw data; triaxial readings are stored against point numbers
   and the UI says there is no time channel.
2. The newer oedometer export: geolib_rvo's reader is the format spec; third
   parser `OedometerNewExportParser`, fixture `tests/fixtures/lab/oedometer_new/`.
3. "don't use default values, you can list them but we'll be doing our own
   interpretations" — lab summary values are `lab_reported` rows, shown under
   "Reported by the lab" / "Gerapporteerd door het labo", never inputs.
4. "ask user, to double check, there should be a sample; if no, default create
   one; overlapping depths, yes same sample" — the preview proposes; the import
   attaches or creates.
5. Default taken: the listing interval is the SAMPLE interval, the .DAT /
   specimen interval the SPECIMEN interval (no raw export carries the latter).
6. "yeah remove all names" — `scripts/anonymise_lab_fixtures.py`.

Later additions: the owner's delta_h / h0 vertical strain (the one Strix-derived
channel, `provenance = 'derived'`); review findings `CHANNEL_CONSTANT`,
`STAGE_SHORT`, `SETTLEMENT_STEPS_BACK`, and `rezero_indices`.

Where the build departs from §2:

* `lab_series_lab_result` names its place by the lab's own `specimen_label` +
  `stage_index`, not a specimen FK (the value is the lab's statement; a refresh
  re-creates the specimen rows).
* `lab_series_channel.values` is named `series_values` (VALUES is an SQL
  keyword); it gains `formula` / `derivation_inputs` for derived channels.
* `lab_series_stage` gains `rezero_indices INT[]`.
* The refresh identity is (kind, lab test type, lab job, lab sample number)
  within the project; a refresh keeps the test id and its sample.
* Not built: the `.DAT`, results and definitive listings (so no φ′ / c′ / B /
  back pressure yet), the triaxial listing companion pairing.
