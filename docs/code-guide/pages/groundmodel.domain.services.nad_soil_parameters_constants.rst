groundmodel.domain.services.nad_soil_parameters_constants
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/nad_soil_parameters_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/nad_soil_parameters_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring says what this file is: the NAD
table of characteristic soil parameters, one row per packing class 1 to 31,
copied from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex to
Eurocode 7). It states the rule for the file ("transcribe, never infer"), lists
who reads the table (the Parameters pane and the D-Series exporters), and
explains the units used for each column. Below it the file imports the
``dataclass`` helper and defines ``SOURCE_LABEL``, the short label the app
prints next to any value taken from this table.

**Why it is here.** The values in this file reach the engineer as if they were
the standard's own, so the file starts by naming the standard, the date of
transcription and the rule that nothing here may be computed. A *dataclass* is
a small Python construct for a record with named fields; it keeps the five
values of a row together with their names so no caller can mix up which
number is which. The source label exists so a value shown in the app or written
to an export can always say where it came from (the data-integrity rule: tag
provenance on every value that is not a raw measurement).

.. CG-EXPLANATION-END id=module-header

Class ``NadSoilParameters``
---------------------------

.. CG-BLOCK id=class:NadSoilParameters lines=48-93

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 48-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:NadSoilParameters

**What this does.** Defines the record for one table row: the unit weight above
the water table and below it (kN/m³), the effective friction angle (degrees),
the effective cohesion (kPa) and the undrained shear strength (kPa), the last
one optional because the table gives no undrained strength for gravel and
sand. The record is *frozen*: once created it cannot be changed.

**Why it is here.** Every reader of the table gets the same five named fields
in the same units, so the Parameters pane and the exporters cannot disagree on
what a number means. Freezing the record prevents any part of the program from
adjusting a characteristic value after it was read from the table, which is
exactly the accident the "transcribe, never infer" rule guards against. The
field names carry their units (``_kn_m3``, ``_deg``, ``_kpa``) so a unit
mistake is visible at the point of use.

.. CG-EXPLANATION-END id=class:NadSoilParameters

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=94-190

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 94-190
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** This is the NAD table itself, written out as a Python
dictionary: one entry per packing class, numbered 1 to 31, each holding the
five characteristic values the table gives for that class: the unit weight
above the water table, the unit weight below it, the effective friction angle,
the effective cohesion, and the undrained shear strength. A class that has no
undrained strength in the table (every gravel and sand class) carries ``None``
for it, which the rest of the program reads as "the table has a dash here".
The comment after each number names the class in the table's own words, so a
reader can check a row against the printed page without decoding anything.

**Why it is here.** Every characteristic value StrixGeo shows or exports for a
packing class comes from this one place, read straight from NBN EN 1997-1 ANB
Tabel 2.1 (the Belgian national annex to Eurocode 7) and transcribed on
2026-09-02. The values are copied, never computed or inferred: the module
docstring makes that a rule ("transcribe, never infer"), because a wrong
number here would flow into the Parameters pane and the D-Series exports as if
it were the standard's own. Keeping the table as a plain dictionary, with the
class number as the key, means the classifier, the Parameters pane and the
exporters all look up the same row the same way, and a change to the table is
one reviewed edit in one file.

.. CG-EXPLANATION-END id=module-statements

Function ``def parameters_for_class``
-------------------------------------

.. CG-BLOCK id=function:parameters_for_class lines=191-218

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 191-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:parameters_for_class

**What this does.** Given a packing class number, returns that class's row of
the table, or nothing when the class is unknown or missing. It is the single
door into the table.

**Why it is here.** Two very different parts of the program need the same row:
the D-Series exporters (through their own lookup helper) and the Parameters
pane's NAD values block (through the API, owner ruling 2026-09-05). Giving both
one accessor means the table is read in one place, with one rule for a missing
class (return nothing, never a guess), so a future change to the table or to
that rule is one edit. Returning nothing for an unclassified unit is what lets
the pane show a blank instead of an invented value.

.. CG-EXPLANATION-END id=function:parameters_for_class

