groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser
=================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-136

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 1-136
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring giving a real, annotated example of a DOV borehole XML and its quirks, then the imports the parser needs — the safety-hardened XML reader, the borehole domain types, the many element-name constants, and the shared helpers.

**Why it is here.** The docstring pins the schema down from a verified live example so the parser is written against reality. It flags the quirks that matter: the schema namespace sits only on the top element (so children are found by bare tag name); each field-log wrapper holds a same-named child for its value; and the point is labelled with one coordinate code but its numbers are really Belgian Lambert 72. It also records what the parser deliberately does not read — the WFS-only drilling-method summary, and the interpretations and samples that arrive through other files.

.. CG-EXPLANATION-END id=module-header

Class ``DovBoringParser`` — header
----------------------------------

.. CG-BLOCK id=class:DovBoringParser lines=137-162

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 137-162
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovBoringParser

**What this does.** Opens the borehole parser class, whose one job is to turn a borehole XML into a structured result and a list of findings.

**Why it is here.** It never crashes on a data-quality problem — a missing depth, a malformed interval — because those become findings so the rest of the import continues. The only fatal cases are unreadable XML or a missing borehole element, which the orchestrator turns into a skip of that one borehole. Its logging levels are spelled out so each kind of detail lands at the right volume.

.. CG-EXPLANATION-END id=class:DovBoringParser

Method ``DovBoringParser``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:DovBoringParser.__init__ lines=163-166

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 163-166
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser.__init__

**What this does.** Registers the logger under this module's name.

**Why it is here.** There is no other state to hold — each parse is self-contained.

.. CG-EXPLANATION-END id=method:DovBoringParser.__init__

Method ``DovBoringParser``. ``def parse``
-----------------------------------------

.. CG-BLOCK id=method:DovBoringParser.parse lines=167-242

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 167-242
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser.parse

**What this does.** The entry point. It reads the XML (raising a clear error if it is unreadable), logs the top-level structure, finds the borehole element, then reads the header, the drill segments, and the field log, pulls the water-table depth out of the details, logs a success line with the counts, and returns the assembled result.

**Why it is here.** If the borehole element is missing it logs the tags that were present before refusing, so a DOV schema change is visible at once. The findings list is threaded through each step so every problem any step meets ends up in one place on the result.

.. CG-EXPLANATION-END id=method:DovBoringParser.parse

Method ``DovBoringParser``. ``def _parse_header``
-------------------------------------------------

.. CG-BLOCK id=method:DovBoringParser._parse_header lines=243-297

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 243-297
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser._parse_header

**What this does.** Builds the borehole entity from the header: its name, position, municipality, total depth, start date, purpose, type, and executor. A missing total depth becomes a warning finding.

**Why it is here.** Free-text source words like the purpose are stored exactly as DOV wrote them and translated only later at the screen, never at ingest — the store-the-raw-token rule. When coordinates are missing the location helper substitutes zeros and raises a finding, so the entity can still be built while the save step later refuses to store a position-less borehole.

.. CG-EXPLANATION-END id=method:DovBoringParser._parse_header

Method ``DovBoringParser``. ``def _parse_location``
---------------------------------------------------

.. CG-BLOCK id=method:DovBoringParser._parse_location lines=298-377

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 298-377
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser._parse_location

**What this does.** Reads the position from the GML point using the shared helper. On any of the several ways the x/y can fail it funnels through one helper that logs and records a no-coordinates error. It also handles the elevation: a missing or non-numeric z becomes a no-elevation warning, and an exact zero-zero position becomes an error.

**Why it is here.** Elevation matters more for boreholes than it might seem: borehole depths are measured from the ground surface, so two boreholes' layers can only be lined up against each other in absolute terms if both carry a surface level. A missing one is therefore flagged for the import report, giving the orchestrator a chance to fill it from the WFS row before deciding whether to store the borehole.

.. CG-EXPLANATION-END id=method:DovBoringParser._parse_location

Method ``DovBoringParser``. ``def _no_coords``
----------------------------------------------

.. CG-BLOCK id=method:DovBoringParser._no_coords lines=378-407

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 378-407
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser._no_coords

**What this does.** A small helper that logs a warning, records a no-coordinates error finding, and returns three blanks.

**Why it is here.** Every one of the several coordinate-failure paths ends the same way, so collapsing them into this one helper removes the repeated copy and lets each failure path read as a single clear line.

.. CG-EXPLANATION-END id=method:DovBoringParser._no_coords

Method ``DovBoringParser``. ``def _parse_drill_segments``
---------------------------------------------------------

.. CG-BLOCK id=method:DovBoringParser._parse_drill_segments lines=408-489

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 408-489
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser._parse_drill_segments

**What this does.** Builds the list of drill segments from the details block — each one a top, a base, and the technique used. A segment missing a field, or with its base at or above its top, is skipped with a warning finding rather than sinking the whole borehole.

**Why it is here.** Keeping one suspect interval from failing the whole borehole is the same forgiving stance used throughout. The base-above-top check lives here in the parser, not in the data type, because the data-integrity rules put cross-field checks in the parse result so the rest of the pipeline can still run.

.. CG-EXPLANATION-END id=method:DovBoringParser._parse_drill_segments

Method ``DovBoringParser``. ``def _parse_field_log``
----------------------------------------------------

.. CG-BLOCK id=method:DovBoringParser._parse_field_log lines=490-566

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 490-566
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoringParser._parse_field_log

**What this does.** Builds the field-log intervals from the details block — the driller's colour, moisture, and consistency notes — into one list, each tagged with its kind. Malformed intervals are skipped with a warning.

**Why it is here.** It reads the value using the same tag name as the wrapper because of DOV's quirk that the value child repeats the wrapper's name. A borehole with no field log at all is perfectly valid and is not flagged.

.. CG-EXPLANATION-END id=method:DovBoringParser._parse_field_log

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=567-567

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py
   :language: python
   :lines: 567-567
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Declares the file's public names for the benefit of type-checking tools.

**Why it is here.** One of the names is referenced only indirectly through a constant, so listing it here keeps the tools from thinking it is unused.

.. CG-EXPLANATION-END id=module-statements

