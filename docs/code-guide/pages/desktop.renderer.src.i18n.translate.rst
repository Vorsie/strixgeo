desktop.renderer.src.i18n.translate
===================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/translate.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/translate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports. It introduces ``t()`` — the one lookup a piece of interface calls to turn a text KEY (a short name like ``settings.title``) into the actual sentence for the active language. (This is a catalogue key looked up at the presentation boundary: the engine stores and returns raw upstream tokens, while the interface looks each display string up in a per-language table at draw time.) It imports the English and Dutch catalogues, the language reader and hook, the ``Language`` type, and the logger.

**Why it is here.** The comment cites docs/ux.md §Translation & persistence: translate at the presentation boundary, never at ingest. It draws a careful line — domain vocabulary (soil names, NAD packing classes, DOV codelists) keeps its own per-lookup translation in the ``utils`` files, where the raw upstream token is the key, while interface chrome (verbs, headings, hints, empty states) goes through this module. It also fixes the resolution order for a key: active language, then English, then the key itself — so a missing key shows up loudly on screen as ``settings.title`` rather than as a blank that silently swallows a button's label.

.. CG-EXPLANATION-END id=module-header

``type MessageParams``
----------------------

.. CG-BLOCK id=type:MessageParams lines=27-30

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 27-30
   :lineno-match:

.. CG-EXPLANATION-START id=type:MessageParams

**What this does.** A type describing the values that may be dropped into a ``{placeholder}`` inside a message: each one is a piece of text or a number. The comment block below leads into the catalogues table.

**Why it is here.** The docstring says numbers are formatted by the caller, not here, because a decimal separator (12.5 versus 12,5) is a language decision the numeric-input layer already owns, and doing it in two places would give two different answers for the same value.

.. CG-EXPLANATION-END id=type:MessageParams

``const CATALOGUES``
--------------------

.. CG-BLOCK id=const:CATALOGUES lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:CATALOGUES

**What this does.** A table pairing each language with its catalogue of strings: ``en`` maps to the English catalogue ``EN``, ``nl`` to the Dutch ``NL``. The comment block below leads into the missing-key tracker.

**Why it is here.** The docstring records that English is complete and every other language is a partial overlay that falls back to it, so this is the table the lookup reads first before it falls back to English.

.. CG-EXPLANATION-END id=const:CATALOGUES

``const reportedMissing``
-------------------------

.. CG-BLOCK id=const:reportedMissing lines=38-58

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 38-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:reportedMissing

**What this does.** A set that remembers which keys have already been reported as missing. The comment block below is the manual for the placeholder-substitution helper.

**Why it is here.** The docstring explains that a key looked up inside a drawing loop would otherwise warn once per frame; remembering the keys already reported makes it warn just once.

.. CG-EXPLANATION-END id=const:reportedMissing

``function interpolate``
------------------------

.. CG-BLOCK id=function:interpolate lines=59-86

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 59-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:interpolate

**What this does.** Fills ``{name}`` placeholders in a message with the supplied values. Given no values it returns the text as-is; otherwise it replaces each ``{name}`` it recognises and leaves any it does not recognise exactly as written. The comment block below leads into the main translate function.

**Why it is here.** The docstring says leaving an unknown placeholder verbatim is deliberate — on screen ``{count}`` is an obvious defect that gets caught in review, whereas a blank gap reads as intended copy and slips through. A code comment also records a constraint: it checks for a known placeholder the long way because the renderer must keep building under an older language target that predates the shorter form.

.. CG-EXPLANATION-END id=function:interpolate

``function translate``
----------------------

.. CG-BLOCK id=function:translate lines=87-123

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 87-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:translate

**What this does.** The core lookup. Given a language, a key, and optional values, it returns the message from that language's catalogue; if that language lacks the key it uses the English message; and if neither has it, it warns once and returns the key itself. The comment block below is the manual for the outside-React version.

**Why it is here.** The docstring says the key is typed against the English catalogue, so a mistyped key is a build error at the exact place it is used rather than a silent English fallback at run time. The final fallback and the one-time warning handle the only case that can reach them — a key built dynamically past the type system — without ever throwing.

.. CG-EXPLANATION-END id=function:translate

``function t``
--------------

.. CG-BLOCK id=function:t lines=124-128

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 124-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:t

**What this does.** Translates a key in the CURRENT language, for callers that are not components. It simply reads the active language and hands off to ``translate``.

**Why it is here.** The docstring names its users — toast builders, file-dialog filter lists, undo-stack action labels — code that runs outside a component and so cannot use a hook. Reading the language at call time keeps it always current without needing any subscription.

.. CG-EXPLANATION-END id=function:t

``type Translator``
-------------------

.. CG-BLOCK id=type:Translator lines=129-142

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 129-142
   :lineno-match:

.. CG-EXPLANATION-START id=type:Translator

**What this does.** A type naming the shape of the translator a component is handed: give it a key (and optional values) and get back a finished string. The comment block below is the manual for the hook.

**Why it is here.** The comment records that this is exactly what a component receives from ``useT``; naming the shape once lets the hook's return value and every component that receives it agree on one contract.

.. CG-EXPLANATION-END id=type:Translator

``function useT``
-----------------

.. CG-BLOCK id=function:useT lines=143-146

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/translate.ts
   :language: typescript
   :lines: 143-146
   :lineno-match:

.. CG-EXPLANATION-START id=function:useT

**What this does.** The hook a component calls to get a translator bound to the active language; when the Settings toggle flips the language, the component redraws in the new language automatically.

**Why it is here.** The docstring explains the subscription is the whole point — a component that called the module-level ``t()`` instead would keep its old strings until something else happened to redraw it.

.. CG-EXPLANATION-END id=function:useT

