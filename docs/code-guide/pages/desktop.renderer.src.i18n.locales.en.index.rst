desktop.renderer.src.i18n.locales.en.index
==========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/index.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports. It states that this English catalogue is the SOURCE OF TRUTH for every user-facing string that has been lifted into the language layer, and that it is built by combining one small module per area of the app — chrome, data, settings, models, sections, outputs, sheet, panels, launch, tutorial. It imports each of those modules.

**Why it is here.** The comment lists the rules these files follow: keys are flat, dot-namespaced names like ``settings.title`` (which keeps the key list a plain union and a missing translation a one-line diff); each value is the exact string the app shows today, so adding a key is a transcription job, not a rewrite; the ``{placeholder}`` names inside a message are part of the contract every language must reuse, and ``localeParity.test.ts`` fails the build if one drifts; and domain vocabulary is deliberately NOT here, because soil names and NAD packing-class names already have Dutch-canonical sources and a second translation layer would create two spellings of one term. Splitting into one module per area keeps each file under the 500-line ceiling and lets a reviewer read a whole area's vocabulary on one screen.

.. CG-EXPLANATION-END id=module-header

``const EN``
------------

.. CG-BLOCK id=const:EN lines=45-60

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/index.ts
   :language: typescript
   :lines: 45-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:EN

**What this does.** The finished English catalogue — every per-area module merged into one large lookup of key to English string. The comment block below leads into the separately-addressable module list.

**Why it is here.** The docstring notes the merge order is simply presentation order (shell, then the stages in workflow sequence, then the shared panels) and does not affect lookup: a key is found the same way wherever its module happens to sit.

.. CG-EXPLANATION-END id=const:EN

``const EN_MODULES``
--------------------

.. CG-BLOCK id=const:EN_MODULES lines=61-75

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/index.ts
   :language: typescript
   :lines: 61-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:EN_MODULES

**What this does.** The same per-area modules kept separately addressable by name (chrome, data, settings, and so on). The comment block below leads into the key type.

**Why it is here.** The docstring says this lets a test assert that no key is defined twice across modules — a duplicate would be silently swallowed by the merge above, with the last module quietly winning and its rival's wording vanishing without warning.

.. CG-EXPLANATION-END id=const:EN_MODULES

``type MessageKey``
-------------------

.. CG-BLOCK id=type:MessageKey lines=76-79

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/index.ts
   :language: typescript
   :lines: 76-79
   :lineno-match:

.. CG-EXPLANATION-START id=type:MessageKey

**What this does.** A type listing every key the app can translate, derived automatically from the English catalogue. The comment block below leads into the full-catalogue type.

**Why it is here.** The docstring says deriving it from ``EN`` means a mistyped key is a compile error at the place it is used, not a silent fall back to English at run time.

.. CG-EXPLANATION-END id=type:MessageKey

``type Messages``
-----------------

.. CG-BLOCK id=type:Messages lines=80-80

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/index.ts
   :language: typescript
   :lines: 80-80
   :lineno-match:

.. CG-EXPLANATION-START id=type:Messages

**What this does.** A type for a COMPLETE catalogue — one that carries every key.

**Why it is here.** The docstring explains non-English languages are a ``Partial`` of this shape: a key they are missing falls back to English, while a key they carry that English does NOT have fails the build — so a rename on the English side cannot leave an orphaned translation behind.

.. CG-EXPLANATION-END id=type:Messages

