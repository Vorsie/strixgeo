groundmodel.infrastructure.codelists.horizontal_crs
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/horizontal_crs.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/horizontal_crs.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/horizontal_crs.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Declares the allowed horizontal map systems for a cross-section and their display labels: the set of five projected, metre-based systems and a code-to-label table.

**Why it is here.** A *coordinate reference system (CRS)* turns a place on Earth into map numbers, and an *EPSG code* is a numeric name for one such system. A section's along-distance is only meaningful when the CRS is projected and measured in metres; the docstring records the trap (debt #31) that a section created in a degrees-based CRS produces along-distances at the wrong scale and silently garbage exports. This file is the single allowlist that rejects that failure, and the comment notes it must stay in step with the matching frontend list. Only systems the app has actually shipped data paths for are listed — a wrong entry is worse than a missing one.

.. CG-EXPLANATION-END id=module-header

Function ``def is_supported_section_crs``
-----------------------------------------

.. CG-BLOCK id=function:is_supported_section_crs lines=50-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/horizontal_crs.py
   :language: python
   :lines: 50-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:is_supported_section_crs

**What this does.** Reports whether a given EPSG code is one of the allowed metric section systems; a missing code is unsupported.

**Why it is here.** A section with no CRS, or a degrees-based one, cannot have a meaningful along-distance, so this is the gate a section-creation check calls before trusting the numbers.

.. CG-EXPLANATION-END id=function:is_supported_section_crs

Function ``def horizontal_crs_label``
-------------------------------------

.. CG-BLOCK id=function:horizontal_crs_label lines=68-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/horizontal_crs.py
   :language: python
   :lines: 68-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:horizontal_crs_label

**What this does.** Returns a human-readable label for a horizontal EPSG: a known name, or a plain ``EPSG:<n>`` for an unmapped code, or "unknown CRS" when there is none.

**Why it is here.** For messages and tooltips. The docstring's rule is honest over wrong: it never claims a friendly name for a system it cannot identify.

.. CG-EXPLANATION-END id=function:horizontal_crs_label

