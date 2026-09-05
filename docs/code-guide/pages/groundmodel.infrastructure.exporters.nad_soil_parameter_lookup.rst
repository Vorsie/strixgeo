groundmodel.infrastructure.exporters.nad_soil_parameter_lookup
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/nad_soil_parameter_lookup.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/nad_soil_parameter_lookup.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/nad_soil_parameter_lookup.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its two imports — the section unit type, and the module that holds the NAD soil-parameter table.

**Why it is here.** Both Deltares exporters ask the same question of every unit they write: does the NAD table carry characteristic parameters for this unit's packing class? So the answer is one shared pure function, not a copy in each (CLAUDE.md ``don't repeat logic``). It reads the table THROUGH its module so a test can swap the table and this lookup follows.

.. CG-EXPLANATION-END id=module-header

Function ``def soil_parameters_for_unit``
-----------------------------------------

.. CG-BLOCK id=function:soil_parameters_for_unit lines=21-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/nad_soil_parameter_lookup.py
   :language: python
   :lines: 21-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:soil_parameters_for_unit

**What this does.** Given one section unit, returns the NAD characteristic soil parameters (unit weight, effective friction angle, effective cohesion) for its packing class — or ``None``. It reads only the unit's ``nad_class``.

**Why it is here.** ``None`` means the unit has no class at all (a geological formation or a litho unit) or its class is not in the table. A ``None`` tells the exporter to write the soil with no parameters — GEOLib's own blank initial values — and never an invented default (docs/exports.md, ``NAD soil parameters``; the characteristic values come from NBN EN 1997-1 ANB Tabel 2.1). The call goes through the module so a monkeypatched table is honoured.

.. CG-EXPLANATION-END id=function:soil_parameters_for_unit

