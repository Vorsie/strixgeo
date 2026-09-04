groundmodel.infrastructure.parsers.cpt.dov.dov_constants
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/dov_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/dov_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-84

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_constants.py
   :language: python
   :lines: 1-84
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Gathers the fixed values the CPT DOV code reads against. Most of them are the shared DOV values, re-exported from the common file so old imports keep working; the CPT-specific ones are defined here — the WFS layer name for soundings, the two URL prefixes used to skip a redirect, and the size threshold above which XML parsing is moved to a separate process.

**Why it is here.** WFS (Web Feature Service) is the standard web protocol DOV uses to answer "which soundings are inside this rectangle?". The layer name must be the exact plural ``dov-pub:Sonderingen`` — the comment records that the singular form is rejected by the server. The proxy-URL prefix turns each download from two web round-trips into one, a real speed win on an import of hundreds of CPTs. Keeping these in a dedicated constants file, with the reason each was chosen, is the project convention.

.. CG-EXPLANATION-END id=module-header

