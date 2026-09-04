groundmodel.infrastructure.parsers.cpt.gef.gef_parser
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one-line description and its toolbox: the regular-expression library (``re``, for pattern-matching in text), Polars (the fast table library), the provenance labels, the CPT-type enum, the constants, the coordinate-code translators, the header and result types, the shared ``ParseError``, and the logging base class. The last small line names the two header keys that declare separators.

**Why it is here.** This is the parser that turns the raw text of a ``.gef`` file into a clean, checked table. It inherits from ``GroundModelLogger`` (further down) so it can write progress and warnings to the log the way every service in this codebase does. ``ParseError`` is the one exception type the whole import path already knows how to turn into a polite HTTP error, so this parser raises that and nothing more exotic.

.. CG-EXPLANATION-END id=module-header

Function ``def _declares_separator``
------------------------------------

.. CG-BLOCK id=function:_declares_separator lines=39-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 39-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:_declares_separator

**What this does.** Answers a narrow yes/no: is this header line one of the two that declare a separator character (``#COLUMNSEPARATOR=`` or ``#RECORDSEPARATOR=``)?

**Why it is here.** In a GEF header a semicolon normally starts a throwaway comment, so the parser usually cuts a line at the first ``;``. But these two lines are the exception: DOV really writes ``#COLUMNSEPARATOR=;``, where the semicolon is the declared value, not a comment. This test lets the header reader spare those two lines from the comment-stripping so the file's own separator is not silently thrown away.

.. CG-EXPLANATION-END id=function:_declares_separator

Function ``def _value_split_pattern``
-------------------------------------

.. CG-BLOCK id=function:_value_split_pattern lines=58-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 58-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:_value_split_pattern

**What this does.** Builds the pattern used to chop a data line into separate numbers. It combines the file's declared column separator with the historic defaults (semicolon and any run of spaces).

**Why it is here.** Real files often declare ``;`` and *also* pad the columns with spaces, so both must split. Widening the split this way is safe — it can only merge characters that were never part of a number. Any character that can appear inside a number (a digit, a dot, a minus sign) is dropped from the separator set first, because splitting on a minus sign would tear ``-9999.0`` in half.

.. CG-EXPLANATION-END id=function:_value_split_pattern

Function ``def _effective_column_separators``
---------------------------------------------

.. CG-BLOCK id=function:_effective_column_separators lines=81-103

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 81-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:_effective_column_separators

**What this does.** Returns the exact set of characters that split values apart on a data line: always the historic defaults, plus the file's declared separator, minus any character that can occur inside a number.

**Why it is here.** It is the shared source of truth for "what counts as a value separator", used both to build the split pattern above and to check the record separator below, so the two can never disagree.

.. CG-EXPLANATION-END id=function:_effective_column_separators

Function ``def _effective_record_separator``
--------------------------------------------

.. CG-BLOCK id=function:_effective_record_separator lines=104-151

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 104-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:_effective_record_separator

**What this does.** Decides whether a declared record separator (the character that marks the end of a data record) is safe to apply, and if not, returns a short reason. It refuses two kinds: a character that can occur inside a number, and a character that also splits values apart.

**Why it is here.** A record separator is used to cut off the tail of every data line, so a bad one is far more destructive than a bad column separator: it would silently truncate every line, the table would still come back with all its columns (padded with blanks), no row would be counted as dropped, and the parser would report success on a file it had quietly emptied. The worst case is real — a file that declares ``#RECORDSEPARATOR=;`` names the same semicolon DOV uses between columns, so honouring it would keep only the first number of every row. Refusing it and reading each record to the end of its line is the safe choice; the reason travels back so the caller can log exactly why it was ignored.

.. CG-EXPLANATION-END id=function:_effective_record_separator

Class ``GEFParser`` — header
----------------------------

.. CG-BLOCK id=class:GEFParser lines=152-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 152-154
   :lineno-match:

.. CG-EXPLANATION-START id=class:GEFParser

**What this does.** Opens the parser class and states its job in one line: turn a GEF-CPT file into a validated result with a Polars table inside.

**Why it is here.** It inherits from ``GroundModelLogger`` so every step can log at the right level, which is the project convention for any class with real logic.

.. CG-EXPLANATION-END id=class:GEFParser

Method ``GEFParser``. ``def __init__``
--------------------------------------

.. CG-BLOCK id=method:GEFParser.__init__ lines=155-157

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 155-157
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser.__init__

**What this does.** The set-up method. It only registers the logger under this file's name.

**Why it is here.** The parser holds no state between files — each call to ``parse`` is self-contained — so there is nothing else to set up. Passing ``__name__`` makes every log line say it came from this module.

.. CG-EXPLANATION-END id=method:GEFParser.__init__

Method ``GEFParser``. ``def parse``
-----------------------------------

.. CG-BLOCK id=method:GEFParser.parse lines=158-224

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 158-224
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser.parse

**What this does.** The main entry point, and a map of the whole parsing flow read top to bottom: split the text into lines, read the header up to the ``#EOH=`` end-of-header marker, read the data block into a raw table, detect the CPT type, then clean the table in order — apply the "this-means-missing" void values, rename the positional columns to their real names, convert units to MPa, guarantee a depth column, and null out any not-a-number values. It then records whether Rf was measured or computed, runs every validation check, stamps where the elevation came from, packages the result, logs a one-line success, and returns.

**Why it is here.** The order is deliberate and commented. Non-finite values are nulled *before* Rf is derived (an infinite qc would otherwise poison the fs/qc ratio) and before validation, so the checks always see a finite table. Rf's provenance is captured *before* the parser might compute it, so "the file gave us Rf" (stamp ``MEASURED``) stays distinguishable from "we divided fs by qc ourselves" (stamp ``COMPUTED``) — the data-integrity rule that a measurement must never be confused with a derivation.

.. CG-EXPLANATION-END id=method:GEFParser.parse

Method ``GEFParser``. ``def parse_bytes``
-----------------------------------------

.. CG-BLOCK id=method:GEFParser.parse_bytes lines=225-262

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 225-262
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser.parse_bytes

**What this does.** Accepts the file as raw bytes and decodes it to text before parsing, trying UTF-8 first, then Windows-1252, then Latin-1. If a fallback (non-UTF-8) encoding is what worked, it logs which one. If none decode, it raises a ``ParseError``.

**Why it is here.** GEF files come from many tools and are not always saved as UTF-8; the two fallbacks cover the Western-European encodings a Belgian or Dutch file is likely to use. Logging the fallback is a breadcrumb: if a company or project name later shows garbled characters, the log already says which encoding was guessed.

.. CG-EXPLANATION-END id=method:GEFParser.parse_bytes

Method ``GEFParser``. ``def _parse_header``
-------------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_header lines=263-286

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 263-286
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_header

**What this does.** Walks the header lines one by one. It skips lines that are not header lines (those not starting with ``#``), strips an inline ``;`` comment except on the two separator-declaration lines, stops at the ``#EOH=`` end-of-header marker (returning the finished header and the line number where the data begins), and otherwise splits each line at its ``=`` and hands the key and value to the field-applier. If it never finds ``#EOH=`` it raises a ``ParseError``.

**Why it is here.** ``#EOH=`` (End Of Header) is the GEF marker that separates the metadata from the block of numbers, so it is the natural hinge of the parse. Refusing a file with no ``#EOH=`` is honest: without it there is no reliable way to tell where the data starts.

.. CG-EXPLANATION-END id=method:GEFParser._parse_header

Method ``GEFParser``. ``def _apply_header_field``
-------------------------------------------------

.. CG-BLOCK id=method:GEFParser._apply_header_field lines=287-318

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 287-318
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._apply_header_field

**What this does.** Takes one header key and its value and stores it in the right place: project and test ids, file date, company, report code, the declared column count, and — by handing off to small helpers — the column-info, void, coordinate, and measurement-variable lines. Anything that fails to parse is logged as a warning rather than crashing the whole read.

**Why it is here.** A single malformed header line should never sink an otherwise-good file. The ``match`` statement lists exactly which header keys this platform cares about; any key not listed is simply ignored, which is why an unfamiliar GEF variant still imports.

.. CG-EXPLANATION-END id=method:GEFParser._apply_header_field

Method ``GEFParser``. ``def _parse_columninfo``
-----------------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_columninfo lines=319-335

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 319-335
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_columninfo

**What this does.** Reads one ``#COLUMNINFO=`` line, which describes one data column: its position, its unit, its name, and its GEF quantity number. It records "column N holds quantity Q" and "column N is in unit U". It copes with both the modern four-field form and an older three-field form.

**Why it is here.** GEF stores its data columns positionally — the file does not label the number columns themselves — so these header lines are the only key to which channel is which. Supporting the old layout too means older files still read.

.. CG-EXPLANATION-END id=method:GEFParser._parse_columninfo

Method ``GEFParser``. ``def _parse_columnvoid``
-----------------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_columnvoid lines=336-340

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 336-340
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_columnvoid

**What this does.** Reads one ``#COLUMNVOID=`` line and records, for one column, the special number that stands for "no reading here".

**Why it is here.** GEF marks a missing measurement not with a blank but with a sentinel number (commonly ``-9999``). Recording it per column lets a later step replace those sentinels with a true blank so they are never mistaken for real data.

.. CG-EXPLANATION-END id=method:GEFParser._parse_columnvoid

Method ``GEFParser``. ``def _parse_xyid``
-----------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_xyid lines=341-357

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 341-357
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_xyid

**What this does.** Reads the ``#XYID=`` line: the coordinate-system code first, then the x and y position. It keeps the raw code as written, translates it to an EPSG number, and — if a code was given but could not be translated — logs a warning that no coordinate system was assigned.

**Why it is here.** Keeping both the raw code and the translation in separate fields is the store-the-raw-token rule again: the raw code is what the file said, the EPSG is what it means, and keeping them apart makes any mistranslation auditable. The warning is the early signal that a file's position may not be placeable on the map.

.. CG-EXPLANATION-END id=method:GEFParser._parse_xyid

Method ``GEFParser``. ``def _parse_zid``
----------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_zid lines=358-371

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 358-371
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_zid

**What this does.** Reads the ``#ZID=`` line: the vertical-datum code, then the ground-level elevation. As with the horizontal line it keeps the raw code, translates it, and warns when a code is present but unrecognised.

**Why it is here.** The vertical datum is what makes an elevation mean something (mTAW in Belgium, NAP in the Netherlands). An unknown datum is only a warning, not a refusal — the elevation is still usable, it just carries a bare ``m`` label instead of a datum name that cannot be confirmed.

.. CG-EXPLANATION-END id=method:GEFParser._parse_zid

Method ``GEFParser``. ``def _parse_measurementvar``
---------------------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_measurementvar lines=372-393

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 372-393
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_measurementvar

**What this does.** Reads one ``#MEASUREMENTVAR=`` line — a numbered single-value header slot — and stores the few slots the platform uses: the net area ratio (the cone's a-value), the pre-drill depth, the groundwater depth, the stop criterion, and the cone type (electric or mechanical).

**Why it is here.** These header values change how the data is read and checked: the a-value is needed to correct a piezocone's tip resistance, the pre-drill depth marks rows to exclude from interpretation, and the cone type helps decide the CPT kind. The slot numbers come from the GEF-CPT-Report standard and are named in the constants file so this code reads by name, not by magic number.

.. CG-EXPLANATION-END id=method:GEFParser._parse_measurementvar

Method ``GEFParser``. ``def _parse_data``
-----------------------------------------

.. CG-BLOCK id=method:GEFParser._parse_data lines=394-491

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 394-491
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._parse_data

**What this does.** Turns the block of numbers after ``#EOH=`` into a raw table. It builds the value-splitting pattern, decides whether a declared record separator is safe to apply, then reads each line: it skips blanks and comment lines, trims the record tail if a safe record separator was given, splits the rest into numbers, and keeps the rows that parse. Lines that will not parse as numbers are counted and the first one is remembered. If nothing parses it raises a ``ParseError`` — one message for "no data block at all", another that quotes the first bad line when there was data but none of it was readable. Finally it pads every row to the same width and returns the table plus the count of dropped lines.

**Why it is here.** A dropped data row is a hole in the depth series that nobody sees, so the count is returned rather than swallowed and surfaced as a warning later. The width is also guarded: if the header declared more columns than any real GEF could have (over the 512 cap), the table is built from the columns the data actually has, so a hostile file cannot trick the program into a huge memory allocation — the parse is then refused separately by a validation check.

.. CG-EXPLANATION-END id=method:GEFParser._parse_data

Method ``GEFParser``. ``def _apply_void_values``
------------------------------------------------

.. CG-BLOCK id=method:GEFParser._apply_void_values lines=492-500

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 492-500
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._apply_void_values

**What this does.** For each column that declared a void value, replaces every occurrence of that special number with a true blank.

**Why it is here.** This is where the ``-9999``-style "no reading" sentinels recorded from the header become real missing values, so no downstream calculation ever averages a sentinel in as if it were a genuine measurement.

.. CG-EXPLANATION-END id=method:GEFParser._apply_void_values

Method ``GEFParser``. ``def _rename_columns``
---------------------------------------------

.. CG-BLOCK id=method:GEFParser._rename_columns lines=501-547

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 501-547
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._rename_columns

**What this does.** Renames the positional ``col_1``, ``col_2`` columns to their real names (``qc_mpa``, ``fs_mpa``, and so on) using the header's column-to-quantity map. If two columns claim to be the same quantity it raises a ``ParseError`` naming the quantity and the offending columns.

**Why it is here.** Two channels claiming to be the same measurement means the file itself does not say which is which — refusing, with a clear message, is the only honest answer. Raising a ``ParseError`` keeps that failure inside the one exception type every caller already handles, instead of letting a raw Polars duplicate-column error escape as a generic server crash.

.. CG-EXPLANATION-END id=method:GEFParser._rename_columns

Method ``GEFParser``. ``def _normalise_units``
----------------------------------------------

.. CG-BLOCK id=method:GEFParser._normalise_units lines=548-562

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 548-562
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._normalise_units

**What this does.** Converts every pressure column into megapascals (MPa). For each column it looks up the declared unit, finds the conversion factor, and multiplies — skipping columns already in MPa and any unit it does not recognise.

**Why it is here.** GEF files state pressures in several units (kPa, bar, and others). Converting them all to one unit at the parse boundary means every later step, chart, and export can assume MPa and never has to ask. The kN total-resistance channel is deliberately left alone, because for the standard Belgian mechanical cone its number already equals the MPa value.

.. CG-EXPLANATION-END id=method:GEFParser._normalise_units

Method ``GEFParser``. ``def _ensure_depth_column``
--------------------------------------------------

.. CG-BLOCK id=method:GEFParser._ensure_depth_column lines=563-588

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 563-588
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._ensure_depth_column

**What this does.** Guarantees the table has a ``depth_m`` column. If the file gave only penetration length (quantity 1) and no corrected depth (quantity 11), it renames the length column to ``depth_m``, logs a warning, and returns a flag saying the substitution happened.

**Why it is here.** Penetration length is measured along a rod that leans off vertical, so it is always a little deeper than the true vertical depth. Standing it in for depth is better than having no depth at all, but the engineer must know: every layer drawn on it will sit slightly too deep. The flag is returned, not just logged, so that fact reaches the screen as a validation finding rather than hiding in a log file.

.. CG-EXPLANATION-END id=method:GEFParser._ensure_depth_column

Method ``GEFParser``. ``def _replace_non_finite``
-------------------------------------------------

.. CG-BLOCK id=method:GEFParser._replace_non_finite lines=589-636

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 589-636
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._replace_non_finite

**What this does.** Finds any not-a-number and infinity values that slipped in from the file (a bare ``nan`` or ``inf`` token reads straight into such a value), replaces each with a true blank, and returns a per-column count of how many it fixed.

**Why it is here.** Left in the table these values poison everything downstream — a not-a-number depth sorts unpredictably, an infinite coordinate breaks map queries, and neither survives a strict conversion to JSON. Fixing them at the parse boundary keeps the rest of the program clean. The counts are kept so the next check can raise the right severity: a bad depth is an error (the row lost its anchor), a bad measurement is only a warning.

.. CG-EXPLANATION-END id=method:GEFParser._replace_non_finite

Method ``GEFParser``. ``def _calculate_rf``
-------------------------------------------

.. CG-BLOCK id=method:GEFParser._calculate_rf lines=637-650

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 637-650
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._calculate_rf

**What this does.** Computes the friction ratio Rf as sleeve friction divided by tip resistance, times 100, but only where tip resistance is above zero (to avoid dividing by zero).

**Why it is here.** Rf is a standard derived quantity used in soil classification. The parser computes it only when the file did not already provide it; when this runs, the result is stamped ``COMPUTED`` so a reader always knows the software did the arithmetic, not the cone.

.. CG-EXPLANATION-END id=method:GEFParser._calculate_rf

Method ``GEFParser``. ``def _detect_cpt_type``
----------------------------------------------

.. CG-BLOCK id=method:GEFParser._detect_cpt_type lines=651-664

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 651-664
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._detect_cpt_type

**What this does.** Decides which of the four CPT kinds the file is. A mechanical cone type in the header wins outright (``CPTM``). Otherwise, if the columns include pore water pressure u2 it is a piezocone (``CPTU``); if they include sleeve friction it is an electric cone (``CPTE``); failing both, it falls back to mechanical.

**Why it is here.** The kind decides which columns are required and which checks apply, so it must be settled before validation. Reading it from the channels the file actually carries is more reliable than trusting a possibly-absent header label alone.

.. CG-EXPLANATION-END id=method:GEFParser._detect_cpt_type

Method ``GEFParser``. ``def _validate``
---------------------------------------

.. CG-BLOCK id=method:GEFParser._validate lines=665-696

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 665-696
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._validate

**What this does.** Runs every validation check in turn, gathers all their findings into one flat list, logs each at trace level, and returns the list.

**Why it is here.** This is the single place the whole check-list is assembled, so the order and membership of the checks are visible at a glance. Each check returns a (possibly empty) list of findings rather than raising, which is what lets a messy-but-usable file still import while its problems are recorded for the engineer to see.

.. CG-EXPLANATION-END id=method:GEFParser._validate

Method ``GEFParser``. ``def _check_non_finite``
-----------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_non_finite lines=697-741

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 697-741
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_non_finite

**What this does.** Turns the not-a-number counts from earlier into findings: an ERROR when the depth column had bad values (those rows have no usable depth), plus one WARNING listing any measurement columns that had bad values.

**Why it is here.** The values were already blanked; this is what makes the engineer aware of it. The split in severity is the same principle throughout the parser — a broken depth anchor is fatal to a row, a missing reading is not.

.. CG-EXPLANATION-END id=method:GEFParser._check_non_finite

Method ``GEFParser``. ``def _check_column_count``
-------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_column_count lines=742-769

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 742-769
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_column_count

**What this does.** Refuses a file whose ``#COLUMN=`` header claims more columns than any real GEF would have (over the 512 cap), by emitting a single ERROR finding that blocks the import.

**Why it is here.** The paired guard in the data reader has already stopped the oversized memory allocation; this is the honest "here is why it was refused" that the caller shows. The cap is justified from the format, not taste: even the richest multi-sensor GEF stays far under 512 columns.

.. CG-EXPLANATION-END id=method:GEFParser._check_column_count

Method ``GEFParser``. ``def _check_coordinates``
------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_coordinates lines=770-809

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 770-809
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_coordinates

**What this does.** Checks the position fields and raises the fitting note: a WARNING when there are no x/y coordinates (cannot be mapped), a WARNING when they are exactly (0, 0) (almost always "not recorded", not a real location), a WARNING when coordinates exist but no coordinate-system code was given at all, and an INFO when there is no elevation.

**Why it is here.** Each message is written to point the engineer at exactly the right missing thing. "No code at all" is kept separate from "a code was written but not recognised" — the latter is a different, more specific finding raised by the next check — so the reader is never sent hunting for the wrong problem.

.. CG-EXPLANATION-END id=method:GEFParser._check_coordinates

Method ``GEFParser``. ``def _check_crs_codes``
----------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_crs_codes lines=810-846

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 810-846
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_crs_codes

**What this does.** Reports coordinate-system codes that were written in the file but could not be translated to a known EPSG: a WARNING for the horizontal code (the import will be refused, and this says why) and an INFO for the vertical datum (which only costs the datum label).

**Why it is here.** This is the finding behind the allowlist-only translation described in ``gef_crs_codes.py``: an unrecognised horizontal code means the sounding cannot be placed, so the reason is spelled out rather than the file being silently dropped or, worse, placed at a guessed spot.

.. CG-EXPLANATION-END id=method:GEFParser._check_crs_codes

Method ``GEFParser``. ``def _check_uncorrected_depth``
------------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_uncorrected_depth lines=847-875

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 847-875
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_uncorrected_depth

**What this does.** Emits one WARNING when the depth series is really the uncorrected penetration length standing in for a corrected depth the file never supplied.

**Why it is here.** The measurement is still usable, but every depth is biased deep by the rod's lean off vertical, so the engineer has to know before a soil boundary drawn on it goes into a model. This is the flag from ``_ensure_depth_column`` reaching the screen.

.. CG-EXPLANATION-END id=method:GEFParser._check_uncorrected_depth

Method ``GEFParser``. ``def _check_skipped_rows``
-------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_skipped_rows lines=876-903

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 876-903
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_skipped_rows

**What this does.** Emits one WARNING when data lines were dropped because they would not read as numbers, giving the dropped count against the total.

**Why it is here.** A dropped row is a gap in the depth series; without this warning the import would report success and the gap would only turn up later as an unexplained blank in a chart. Logging what was *not* read is the project's logging discipline.

.. CG-EXPLANATION-END id=method:GEFParser._check_skipped_rows

Method ``GEFParser``. ``def _check_required_columns``
-----------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_required_columns lines=904-918

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 904-918
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_required_columns

**What this does.** Confirms the columns each CPT kind must have. Every kind needs depth and tip resistance; an electric or piezocone also needs sleeve friction; a piezocone also needs pore water pressure. Any missing one becomes an ERROR naming the column and the kind.

**Why it is here.** These are the columns without which the sounding cannot be interpreted as its declared kind, so their absence must block the import rather than produce a half-usable record.

.. CG-EXPLANATION-END id=method:GEFParser._check_required_columns

Method ``GEFParser``. ``def _check_depth_monotonic``
----------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_depth_monotonic lines=919-938

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 919-938
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_depth_monotonic

**What this does.** Checks that depth always increases going down the rows. Any row whose depth is not strictly greater than the row above is flagged, and if any exist it raises one ERROR reporting how many (listing up to the first ten row numbers).

**Why it is here.** A CPT is pushed continuously downward, so depth must climb monotonically; a repeat or a step backwards means the rows are out of order or corrupt, which would break every depth-based calculation. It is an error because nothing downstream can trust an unordered depth series.

.. CG-EXPLANATION-END id=method:GEFParser._check_depth_monotonic

Method ``GEFParser``. ``def _check_negative_values``
----------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_negative_values lines=939-953

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 939-953
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_negative_values

**What this does.** Counts negative values in tip resistance and sleeve friction, and raises a WARNING for each column that has any.

**Why it is here.** Neither of these forces can be physically negative, so a negative reading points at a sensor calibration problem. It is a warning, not a refusal — the engineer decides whether the affected stretch is trustworthy.

.. CG-EXPLANATION-END id=method:GEFParser._check_negative_values

Method ``GEFParser``. ``def _check_null_values``
------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_null_values lines=954-964

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 954-964
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_null_values

**What this does.** For every column that has any blanks, records an INFO note of how many.

**Why it is here.** After the void sentinels and non-finite values have been turned into blanks, this simply tells the engineer how complete each channel is. It is neutral information, not a problem.

.. CG-EXPLANATION-END id=method:GEFParser._check_null_values

Method ``GEFParser``. ``def _check_pre_drill``
----------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_pre_drill lines=965-991

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 965-991
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_pre_drill

**What this does.** Flags the rows inside a pre-drilled zone. If the header declared a pre-drill depth it counts the rows at or above it; if it did not, but the data still starts deeper than half a metre, it notes the likely pre-drill. Either way it raises an INFO.

**Why it is here.** A pre-drilled (pre-augered) top section is disturbed ground, not intact soil, so those rows should be left out of interpretation. Inferring it from a data start below 0.5 m catches the common case where the pre-drill header value was simply not filled in.

.. CG-EXPLANATION-END id=method:GEFParser._check_pre_drill

Method ``GEFParser``. ``def _check_net_area_ratio``
---------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_net_area_ratio lines=992-1002

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 992-1002
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_net_area_ratio

**What this does.** Raises a WARNING when a piezocone file is missing its net area ratio (the cone's a-value).

**Why it is here.** The a-value is the constant needed to correct a piezocone's tip resistance for the water pressure acting behind the cone; without it that correction cannot be done. It matters only for piezocones, so the check is scoped to that kind.

.. CG-EXPLANATION-END id=method:GEFParser._check_net_area_ratio

Method ``GEFParser``. ``def _check_rf_range``
---------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_rf_range lines=1003-1016

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 1003-1016
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_rf_range

**What this does.** Counts rows whose friction ratio Rf falls outside the 0.05 to 15 percent band and raises a WARNING if any do.

**Why it is here.** Almost all real soils sit inside that band, so a value outside it is a hint of a sensor error worth a second look. It is a warning because unusual ground can occasionally be genuine.

.. CG-EXPLANATION-END id=method:GEFParser._check_rf_range

Method ``GEFParser``. ``def _check_qc_spikes``
----------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_qc_spikes lines=1017-1040

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 1017-1040
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_qc_spikes

**What this does.** Looks for single-row tip-resistance spikes — a reading more than five times both of its immediate neighbours — and raises a WARNING listing up to the first ten.

**Why it is here.** A lone value that towers over the readings just above and below it is usually an instrument glitch or a gravel clast, not a real soil feature, and can distort a classification if taken at face value.

.. CG-EXPLANATION-END id=method:GEFParser._check_qc_spikes

Method ``GEFParser``. ``def _check_hybrid_method``
--------------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_hybrid_method lines=1041-1072

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 1041-1072
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_hybrid_method

**What this does.** Detects a sudden, sustained change in the spacing between depth readings partway down the sounding, and raises a WARNING naming roughly where it happens. It only fires when the data is long enough and the change is large (a tenfold spread between the tightest and loosest spacing, with a step at least five times the tight spacing).

**Why it is here.** Electric cones log at a fine, regular spacing while mechanical cones step in coarser increments, so a jump in spacing usually means the test switched methods mid-hole — and the two halves should be interpreted separately. The thresholds are set to fire on a genuine method change, not on ordinary variation.

.. CG-EXPLANATION-END id=method:GEFParser._check_hybrid_method

Method ``GEFParser``. ``def _check_partial_u2``
-----------------------------------------------

.. CG-BLOCK id=method:GEFParser._check_partial_u2 lines=1073-1091

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py
   :language: python
   :lines: 1073-1091
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParser._check_partial_u2

**What this does.** For a piezocone, checks whether pore water pressure u2 only appears from some depth down rather than from the top, and raises a WARNING naming that depth.

**Why it is here.** If u2 starts partway down, the filter was probably dry at the surface and only began reading once it reached the water table — so the upper stretch behaves like an electric cone and the lower like a piezocone. The small allowance above the pre-drill depth keeps a normal start from being flagged.

.. CG-EXPLANATION-END id=method:GEFParser._check_partial_u2

