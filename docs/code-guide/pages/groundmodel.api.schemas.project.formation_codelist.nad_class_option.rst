groundmodel.api.schemas.project.formation_codelist.nad_class_option
===================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_codelist/nad_class_option.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_codelist/nad_class_option.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_codelist/nad_class_option.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``NadClassOption``
------------------------

.. CG-BLOCK id=class:NadClassOption lines=8-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_codelist/nad_class_option.py
   :language: python
   :lines: 8-19
   :lineno-match:

.. CG-EXPLANATION-START id=class:NadClassOption

**What this does.** One Belgian NAD geotechnical class: its stable number (1–31), a display label, and the base lithology (GRIND/ZAND/SILT/KLEI/VEEN) it subdivides.

**Why it is here.** The docstring records that the number is the stable key — the same row number as the NAD table and the future Phase-5 parameter join key. Method/source: NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex packing classes). A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:NadClassOption

