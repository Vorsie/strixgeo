desktop.renderer.src.i18n.i18n_constants
========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/i18n_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/i18n_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment header. It says the file holds the small fixed facts about the desktop interface's language setting — the app can show its text in either English or Dutch — and that these values live in their own ``*_constants.ts`` file next to the code that uses them. (A constant is a fixed, named value the program does not change while it runs.)

**Why it is here.** This placement follows CLAUDE.md §Code Conventions ("Constants in a dedicated file"): module-level fixed values belong in a dedicated constants file, the same shape as the ``sectionsToolbar_constants.ts`` and ``toolbarOverflow_constants.ts`` files the comment names, so they are importable and discoverable from one known place.

.. CG-EXPLANATION-END id=module-header

``const LANGUAGES``
-------------------

.. CG-BLOCK id=const:LANGUAGES lines=10-11

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 10-11
   :lineno-match:

.. CG-EXPLANATION-START id=const:LANGUAGES

**What this does.** A fixed list of the two languages the app ships with — ``en`` (English) and ``nl`` (Dutch). Marking it ``as const`` freezes it, so the rest of the program treats it as exactly those two, in that order, and never alters it.

**Why it is here.** The docstring records the rule: English is the source of truth — every piece of text exists in English first, and any other language is a partial overlay on top of it. Writing the languages as one real list means everything else in the language machinery (the allowed-language check, the type just below) is derived from this single place and cannot drift from it.

.. CG-EXPLANATION-END id=const:LANGUAGES

``type Language``
-----------------

.. CG-BLOCK id=type:Language lines=12-18

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 12-18
   :lineno-match:

.. CG-EXPLANATION-START id=type:Language

**What this does.** Turns the list above into a type — a note to the rest of the code that a "language" value is only ever ``'en'`` or ``'nl'`` and nothing else. (In TypeScript a type is just such a note about what kind of value is allowed; it is checked before the app runs and then disappears.) The comment block below is the lead-in to the default-language setting that follows.

**Why it is here.** Deriving the type straight from the one real list means the two can never disagree: add a third language to the list and the type updates itself, while a typo like ``'ne'`` is caught before the app is ever run.

.. CG-EXPLANATION-END id=type:Language

``const DEFAULT_LANGUAGE``
--------------------------

.. CG-BLOCK id=const:DEFAULT_LANGUAGE lines=19-27

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 19-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_LANGUAGE

**What this does.** Sets the out-of-the-box interface language to English. The comment block below is the note for the storage-key constant that follows.

**Why it is here.** The docstring records the reason: English deliberately, because the Dutch wording is still under owner review and must not reach anyone's screen before it is approved. Flipping this single line is the one edit that makes Dutch the default once it is signed off.

.. CG-EXPLANATION-END id=const:DEFAULT_LANGUAGE

``const LANGUAGE_STORAGE_KEY``
------------------------------

.. CG-BLOCK id=const:LANGUAGE_STORAGE_KEY lines=28-32

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 28-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:LANGUAGE_STORAGE_KEY

**What this does.** The name under which each computer remembers its own language choice — ``groundmodel.language``. The comment block below leads into the labels constant. (localStorage is a small per-computer store the web page can read and write; it holds per-user interface preferences, never project data.)

**Why it is here.** The docstring cites docs/ux.md §Translation & persistence: the language is a global per-person preference — it follows the person, not the file — so it is stored on the computer under a ``groundmodel.<kind>`` name like ``groundmodel.theme``, and it must NOT travel inside the ``.gmproj`` project file, which (per CLAUDE.md §Project files) carries engineering decisions while localStorage carries per-user interface chrome.

.. CG-EXPLANATION-END id=const:LANGUAGE_STORAGE_KEY

``const LANGUAGE_LABELS``
-------------------------

.. CG-BLOCK id=const:LANGUAGE_LABELS lines=33-36

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/i18n_constants.ts
   :language: typescript
   :lines: 33-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:LANGUAGE_LABELS

**What this does.** Pairs each language code with the name to show in the language picker: ``en`` becomes "English" and ``nl`` becomes "Nederlands".

**Why it is here.** The docstring notes each language is always offered in its OWN language (its "endonym") — a Dutch speaker scanning the picker looks for "Nederlands", not for "Dutch" — following Apple HIG and W3C internationalisation practice.

.. CG-EXPLANATION-END id=const:LANGUAGE_LABELS

