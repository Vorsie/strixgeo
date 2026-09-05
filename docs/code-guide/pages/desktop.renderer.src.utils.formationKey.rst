desktop.renderer.src.utils.formationKey
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formationKey.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formationKey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKey.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the renderer's copy of the rule the server uses to give a formation its identity key — the text used to decide whether two descriptions mean the same formation. The comment explains that the backend has its own normaliser and this file must match it step for step, so the window and the server always agree on "is this formation the one behind that candidate". The normalisation is typographic only: it tidies punctuation and case, but it does not strip age-prefixes, reduce phrases, or fold accents.

**Why it is here.** The comment records why a mirror exists rather than asking the server: these keys are compared inside synchronous drawing paths — checking pre-conditions, working out "what would this Apply delete" — where there is no time for a round-trip to the engine. It also records the bug that forced the exact match: a UI freeze (commit da98053) was caused by the client using a plain lower-casing while the server used its fuller normaliser, so every name with a dash, colon, or double space was keyed differently on the two sides. The rule is to keep this file in lockstep with the server's ``formation_key.py``; this is the one place the duplication is allowed to live.

.. CG-EXPLANATION-END id=module-header

``function normaliseFormationKey``
----------------------------------

.. CG-BLOCK id=function:normaliseFormationKey lines=34-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKey.ts
   :language: typescript
   :lines: 34-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:normaliseFormationKey

**What this does.** Turns any raw formation text into its identity key by three steps, matching the Python version exactly: first it applies a Unicode clean-up (NFKC) that folds odd spaces and dash variants and look-alike character forms into their plain equivalents; then it lower-cases the text; then it replaces every run of non-letter, non-number characters — punctuation, spaces, underscores — with a single space and trims the ends. An empty or blank input becomes an empty string.

**Why it is here.** Each step is written to reproduce the server's behaviour precisely, including the Unicode-aware "non-word" pattern that matches Python's own rule, because any divergence would key a formation differently on the two sides and reopen the freeze bug the file comment describes.

.. CG-EXPLANATION-END id=function:normaliseFormationKey

``function formationStableKey``
-------------------------------

.. CG-BLOCK id=function:formationStableKey lines=52-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKey.ts
   :language: typescript
   :lines: 52-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationStableKey

**What this does.** Gives the stable key of an existing formation: it uses the formal cross-borehole code (``regional_ref``) when that carries a value, otherwise it falls back to the display name, and normalises whichever it picked.

**Why it is here.** This mirrors the server's rule that a formal regional reference, when present, is the stable identity across boreholes, and the display name is only the fallback — so the client and server agree on which field identifies a formation.

.. CG-EXPLANATION-END id=function:formationStableKey

