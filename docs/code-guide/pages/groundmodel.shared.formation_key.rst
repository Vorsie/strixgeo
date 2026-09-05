groundmodel.shared.formation_key
================================

.. CG-PAGE source=src/groundmodel/shared/formation_key.py complete=true

*Source file:* ``src/groundmodel/shared/formation_key.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/shared/formation_key.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a small pure module that turns a stratigraphy description into a *merge key* — a canonical text identifier used to decide whether two descriptions name the same unit. It imports the text tools and compiles a pattern that matches a run of any non-letter, non-digit characters.

**Why it is here.** The docstring records it lives in ``shared/`` (not ``application/``) so both the application seeder and the infrastructure DOV-stratigraphy codelist can import it without an infrastructure-to-application layer violation or an import cycle — the "extract on the second copy, never reach across layers" rule. A *key* is a text identifier built from a value so two values can be compared or deduplicated.

.. CG-EXPLANATION-END id=module-header

Function ``def normalize_formation_key``
----------------------------------------

.. CG-BLOCK id=function:normalize_formation_key lines=26-73

.. literalinclude:: ../../../src/groundmodel/shared/formation_key.py
   :language: python
   :lines: 26-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:normalize_formation_key

**What this does.** Canonicalises a description into that key by three typographic steps only: NFKC normalisation (folds look-alike characters — non-breaking space to a normal space, en-dash and em-dash to a hyphen), casefolding (a Unicode-aware lower-casing), and collapsing every run of punctuation or whitespace to a single space, then trimming.

**Why it is here.** The docstring records the owner's 2026-05-17 reversal: two earlier semantic steps were removed because they made the machine silently decide two different units were the same — exactly the decision the owner reserved for the user's manual lumping tool. So ``"Lid van Oedelem"`` and ``"Formatie van Aalter - Lid van Oedelem"`` stay distinct keys; the remaining folding only prevents accidental splits when the same string was typed two slightly different ways.

.. CG-EXPLANATION-END id=function:normalize_formation_key

