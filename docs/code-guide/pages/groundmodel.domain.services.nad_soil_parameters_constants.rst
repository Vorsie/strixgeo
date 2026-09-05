groundmodel.domain.services.nad_soil_parameters_constants
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/nad_soil_parameters_constants.py complete=false

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

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

Class ``NadSoilParameters``
---------------------------

.. CG-BLOCK id=class:NadSoilParameters lines=48-93

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 48-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:NadSoilParameters

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

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

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:parameters_for_class

