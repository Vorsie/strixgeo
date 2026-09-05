groundmodel.shared.constants.litho_constants
============================================

.. CG-PAGE source=src/groundmodel/shared/constants/litho_constants.py complete=true

*Source file:* ``src/groundmodel/shared/constants/litho_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-132

.. literalinclude:: ../../../src/groundmodel/shared/constants/litho_constants.py
   :language: python
   :lines: 1-132
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A reference *codelist* (a fixed lookup table) of Belgian lithology and NAD geotechnical-class data. It declares the five base soil types (``GRIND``/gravel, ``ZAND``/sand, ``SILT``, ``KLEI``/clay, ``VEEN``/peat) with Dutch and English labels and display colours, admixture qualifiers, sand-packing and fines-consistency states, and the full table of 31 NAD classes (number → canonical name plus base soil), plus the valid class range 1–31.

**Why it is here.** The docstring names the source: the NAD table of NBN EN 1997-1 ANB, the Belgian national annex to Eurocode 7, table 2.1. This is curated reference data, not ingested upstream data, so the "store raw upstream tokens" rule does not apply — the names are normalised because they are shown to engineers, while the class number (1–31) is the stable key. The colours are kept byte-identical with the frontend colour table so a stored formation colour matches the ghost-suggestion overlay the engineer saw before accepting it. It sits in ``shared/constants/`` because the API, domain and schema layers all consume it and the API must not import from the domain layer (debt #54).

.. CG-EXPLANATION-END id=module-header

