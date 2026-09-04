groundmodel.infrastructure.parsers.cpt.gef.gef_crs_codes
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the translation, then imports of the two supported-CRS lookup tables and the two raw code-to-EPSG maps from the constants file. CRS is short for coordinate reference system — the answer to "what do these x and y numbers mean on the earth?".

**Why it is here.** The number a GEF file writes in its ``#XYID=`` and ``#ZID=`` lines is a code from the GEF codelist, not an EPSG code, even though both are five digits and look alike. GEF 32000 means Belgian Lambert 72, whose EPSG number is 31370. If the raw 32000 were stored where an EPSG number belongs, every part of the program that keys on EPSG — the spatial database, the elevation-model picker, the cross-section allowlist, the DOV overlay filter — would quietly treat that sounding as a different coordinate system from the identical sounding imported through DOV. These two helpers are the one place the translation happens, and they are deliberately allowlist-only: an unrecognised code returns "nothing" rather than a plausible guess, so the import is refused instead of a wrong position being stored.

.. CG-EXPLANATION-END id=module-header

Function ``def horizontal_epsg_from_gef_code``
----------------------------------------------

.. CG-BLOCK id=function:horizontal_epsg_from_gef_code lines=29-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py
   :language: python
   :lines: 29-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:horizontal_epsg_from_gef_code

**What this does.** Turns a horizontal ``#XYID`` code into an EPSG number. If the code is a known GEF code it returns the matching EPSG; if the code is already a supported EPSG number (some non-DOV writers put a real EPSG in this field, and no GEF code happens to collide with one) it passes it through unchanged; anything else — including a missing code — returns "nothing".

**Why it is here.** An unidentifiable coordinate system must stay unidentified, never guessed. Returning "nothing" is what makes the import step refuse the file rather than place it on the map at a wrong spot.

.. CG-EXPLANATION-END id=function:horizontal_epsg_from_gef_code

Function ``def vertical_epsg_from_gef_code``
--------------------------------------------

.. CG-BLOCK id=function:vertical_epsg_from_gef_code lines=57-81

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py
   :language: python
   :lines: 57-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:vertical_epsg_from_gef_code

**What this does.** The same translation for the vertical ``#ZID`` code — the datum that says what "zero elevation" means. A known GEF vertical code translates to its EPSG; an already-labelled vertical EPSG passes through; anything else returns "nothing".

**Why it is here.** A wrong datum silently mislabels every elevation in the file, so an unknown one is left blank on purpose — the elevations are then shown with a bare ``m`` label instead of a datum name the program cannot actually confirm.

.. CG-EXPLANATION-END id=function:vertical_epsg_from_gef_code

