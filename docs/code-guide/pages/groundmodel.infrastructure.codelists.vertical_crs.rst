groundmodel.infrastructure.codelists.vertical_crs
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/vertical_crs.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/vertical_crs.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/vertical_crs.py
   :language: python
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Declares the default vertical datum lookups and labels: the pairing of each horizontal system to its national height system, a final fallback, the code-to-label table, and a fallback label.

**Why it is here.** A *vertical datum* is the reference surface heights are measured from (Belgium's TAW, the Netherlands' NAP). The desktop has no datum picker, so the right datum is inferred from the record's horizontal system. The docstring's rule matches the horizontal file: add a country only when its first data source lands, because a wrong default silently mislabels the datum on every saved row, and the labels must mirror the frontend so a value shown on screen matches the one written into an export.

.. CG-EXPLANATION-END id=module-header

Function ``def vertical_datum_label``
-------------------------------------

.. CG-BLOCK id=function:vertical_datum_label lines=59-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/vertical_crs.py
   :language: python
   :lines: 59-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:vertical_datum_label

**What this does.** Returns the label for a vertical EPSG ("m TAW", "m NAP", or a plain "m" fallback).

**Why it is here.** So a height shown by the desktop matches the label embedded in a server-generated export. Honest over wrong: an unidentifiable datum shows plain metres rather than a guessed name.

.. CG-EXPLANATION-END id=function:vertical_datum_label

Function ``def default_vertical_epsg``
--------------------------------------

.. CG-BLOCK id=function:default_vertical_epsg lines=81-99

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/vertical_crs.py
   :language: python
   :lines: 81-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:default_vertical_epsg

**What this does.** Returns the canonical vertical system for a given horizontal system, falling back to Belgium's TAW when the horizontal system is missing or unmapped.

**Why it is here.** Used when a manual elevation is saved and no datum was picked, so the height column at least gets a non-null value; while the platform is Belgium-first, TAW is the safe fallback.

.. CG-EXPLANATION-END id=function:default_vertical_epsg

