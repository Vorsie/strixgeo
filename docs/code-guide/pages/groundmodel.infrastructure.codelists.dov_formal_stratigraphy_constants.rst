groundmodel.infrastructure.codelists.dov_formal_stratigraphy_constants
======================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_constants.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed values for decoding DOV compound stratigraphy codes: the map from a single relation letter (t, o, e) to its Dutch word, the set of those relation letters, and the set of codes that exist in DOV's schema but must not be resolved to a real formation.

**Why it is here.** The project convention keeps fixed values in a dedicated constants file. The docstring records exactly how a compound code such as ``"QH-T-QP"`` is detected: by the time it reaches here it has been normalised to three space-separated tokens whose middle token is one relation letter, so an ordinary single-token code can never be mistaken for a compound. The "unresolvable" set carries DOV's "unknown" code, which the owner decided (2026-05-18) must stay its raw token rather than become a catch-all formation that swallows every unknown-coded layer. The source schema and fetch date are cited.

.. CG-EXPLANATION-END id=module-header

