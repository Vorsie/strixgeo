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

**What this does.** Introduces the table of characteristic soil parameters per NAD packing class used by the export step, and defines a label naming the source table. It imports the ``dataclass`` decorator (which turns the class below into a plain holder of named values).

**Why it is here.** The docstring names the source exactly: the characteristic values of NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex to Eurocode 7), the same table the packing-class thresholds come from — unit weight, effective friction angle, effective cohesion. The governing discipline is transcribe, never infer: a correlation the program computed itself would be a design output, which the product deliberately does not ship, while a value read from a published norm table is a characterisation input the engineer still verifies. The source label rides on every exported soil so the reader can see which table the numbers came from.

.. CG-EXPLANATION-END id=module-header

Class ``NadSoilParameters``
---------------------------

.. CG-BLOCK id=class:NadSoilParameters lines=48-93

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 48-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:NadSoilParameters

**What this does.** A frozen value object holding the characteristic parameters for one packing class: the unsaturated and saturated unit weights, the effective friction angle, the effective cohesion, and the undrained shear strength (empty for the granular classes, where the table carries a dash). "Frozen" means it cannot be changed once made.

**Why it is here.** It holds data and does not act, so it does not inherit the logging base (the project's logging-by-inheritance rule). Each field is a value transcribed from the norm table in the unit named by its suffix, and the saturated unit weight is never below the unsaturated one, mirroring the physics.

.. CG-EXPLANATION-END id=class:NadSoilParameters

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=94-190

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 94-190
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Holds the table itself: one parameter set per NAD packing class from 1 to 31, gathered in a dictionary — a lookup keyed by a value, here the class number, that gives back that class's parameters. Each row is commented with the soil and packing it stands for, for example ``ZAND, matig gp`` (medium-packed sand).

**Why it is here.** The rows were transcribed by script from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex to Eurocode 7) and cross-checked row by row against a reference manifest whose checksum the working sheet had to match — honouring the transcribe-never-infer discipline stated in the docstring: every number is read from the published table, never computed. A dash in the table, meaning no undrained strength for a granular class, is stored as nothing rather than a zero, so the export writes a blank there instead of a misleading value.

.. CG-EXPLANATION-END id=module-statements

Function ``def parameters_for_class``
-------------------------------------

.. CG-BLOCK id=function:parameters_for_class lines=191-218

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_soil_parameters_constants.py
   :language: python
   :lines: 191-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:parameters_for_class

**What this does.** The single accessor that turns a packing-class number into its parameters. Given nothing — an unclassified unit — it returns nothing; otherwise it looks the class up in the table and returns its parameter set, or nothing when that class carries no transcribed row.

**Why it is here.** It is the ONE place a class is read into parameters, shared by the D-Series exporters and by the Parameters pane's "NAD characteristic values" block (owner ruling 2026-09-05), so the pane and the export can never read the same row two different ways. It reads the table through the module global at call time rather than a captured copy, so a test that swaps in a different table is honoured. Returning nothing — for an unclassified unit or a class with no row — means "show or write no parameters", never a guessed default: the same discipline that a value not read from the norm table is never invented.

.. CG-EXPLANATION-END id=function:parameters_for_class

