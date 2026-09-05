desktop.renderer.src.utils.labTestLabels
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/labTestLabels.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/labTestLabels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. This file holds translation tables that turn the raw Dutch parameter names DOV sends — plus USCS / ASTM soil-classification codes — into readable English labels. These tables are used only to decide what the lab-test panel shows.

**Why it is here.** The comment records the project rule that "translation lives at the presentation boundary" (CLAUDE.md Data Integrity Rule 2; docs/ux.md): the engine and database keep the raw DOV tokens, so exports and future integrations stay tied to the original source vocabulary, and only the desktop translates — for display alone, with the raw token shown as a tooltip so a domain expert can check the mapping. The comment also names the sources: live DOV responses (verified 2026-05-09) for the parameter names, and ASTM D2487 for the classification-code descriptions.

.. CG-EXPLANATION-END id=module-header

``const PARAMETER_GROUP_LABELS``
--------------------------------

.. CG-BLOCK id=const:PARAMETER_GROUP_LABELS lines=14-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 14-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:PARAMETER_GROUP_LABELS

**What this does.** A lookup table — a plain mapping from each raw DOV group name to its English label (for example ``Onderkenning-grondsoort`` becomes "Soil identification"). Some entries appear twice, once with a trailing space and once without.

**Why it is here.** The comment records that the trailing-space variants are exactly how DOV ships those strings, so both forms are listed to match the incoming text verbatim rather than guessing.

.. CG-EXPLANATION-END id=const:PARAMETER_GROUP_LABELS

``const PARAMETER_LABELS``
--------------------------

.. CG-BLOCK id=const:PARAMETER_LABELS lines=29-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 29-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:PARAMETER_LABELS

**What this does.** A second lookup table, mapping each raw DOV parameter name to its English label, keyed on the form with the doubled parenthesised tail already removed.

**Why it is here.** The comment records that the keys are stored without DOV's doubled ``(korrelvolumemassa)``-style tail because the lookup function strips that tail before searching; the one exception noted is the methylene-blue clay test, where the ``(MB)`` in the name is genuine and is kept in the key.

.. CG-EXPLANATION-END id=const:PARAMETER_LABELS

``const ASTM_CODE_LABELS``
--------------------------

.. CG-BLOCK id=const:ASTM_CODE_LABELS lines=52-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 52-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:ASTM_CODE_LABELS

**What this does.** A lookup table from a USCS / ASTM soil code (``gw``, ``sp``, ``cl`` and so on, including the common two-symbol borderline codes) to its plain-English description. Every key is lower-case.

**Why it is here.** The comment records that lower-case keys make the lookup resilient to case variation in DOV's data, and that the descriptions come from ASTM D2487, the standard practice for USCS soil classification.

.. CG-EXPLANATION-END id=const:ASTM_CODE_LABELS

``function labelForParameterGroup``
-----------------------------------

.. CG-BLOCK id=function:labelForParameterGroup lines=92-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 92-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelForParameterGroup

**What this does.** Given a raw group string, returns its English label from the table; if there is no match it returns the trimmed raw string instead, or a dash when the string is empty.

**Why it is here.** The docstring records that the fall-back to the trimmed source string means an unknown group still displays something readable rather than a blank — the translate-at-the-boundary rule showing the raw token when no translation exists.

.. CG-EXPLANATION-END id=function:labelForParameterGroup

``function labelForParameter``
------------------------------

.. CG-BLOCK id=function:labelForParameter lines=105-116

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 105-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelForParameter

**What this does.** Removes any trailing parenthesised tail, trims the result, then looks it up; returns the English label when found, otherwise the trimmed (or original) string.

**Why it is here.** The docstring records that the tail is stripped before the lookup so callers can pass the parameter exactly as it arrives from the API without cleaning it up first.

.. CG-EXPLANATION-END id=function:labelForParameter

``function astmDescription``
----------------------------

.. CG-BLOCK id=function:astmDescription lines=117-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 117-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:astmDescription

**What this does.** Given a soil code, returns its English description, matching without regard to upper- or lower-case; returns nothing when the code is missing or unrecognised.

**Why it is here.** The docstring records that the match is case-insensitive so ``CL``, ``Cl`` and ``cl`` all resolve, and that an unrecognised code returns nothing so the caller can simply omit the description line.

.. CG-EXPLANATION-END id=function:astmDescription

``function isAstmClassification``
---------------------------------

.. CG-BLOCK id=function:isAstmClassification lines=127-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labTestLabels.ts
   :language: typescript
   :lines: 127-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:isAstmClassification

**What this does.** Answers true when the given parameter is the ASTM classification — recognised by its name beginning with "Grondsoort volgens ASTM".

**Why it is here.** The docstring records that the ASTM classification is the one scalar lab result whose value is a category code rather than a number, so the panel needs to show a text description beneath it.

.. CG-EXPLANATION-END id=function:isAstmClassification

