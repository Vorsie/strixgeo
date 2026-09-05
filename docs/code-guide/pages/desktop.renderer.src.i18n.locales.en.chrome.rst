desktop.renderer.src.i18n.locales.en.chrome
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/chrome.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/chrome.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/chrome.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the catalogue it holds. A catalogue here is a long list that pairs a short internal name — its key — with the exact words shown on screen (its string). This file, ``CHROME``, holds the words for the app's outer frame: the buttons shared everywhere (Save, Cancel, Delete…), the start-up and backend-health messages, the project launcher shown before a project is open, the new-project and project-metadata dialogs, and the workflow-stage rail down the left edge. It is the English side.

**Why it is here.** The interface text is kept out of the on-screen pieces and gathered into per-language catalogues (one for English, one for Dutch) so that a component — one reusable piece of interface — can ask for a text by its key and be handed the string for whichever language the user picked. The header points to ``locales/en/index.ts`` for the naming rules and the domain-canon carve-out: soil names, NAD packing-class names and DOV codes are deliberately NOT translated here, because the engine already stores them as their raw Dutch-canonical tokens and translating them a second time would create two spellings of one term. That is translation at the presentation boundary — the words are chosen only at the moment of display.

.. CG-EXPLANATION-END id=module-header

``const CHROME``
----------------

.. CG-BLOCK id=const:CHROME lines=7-291

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/chrome.ts
   :language: typescript
   :lines: 7-291
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHROME

**What this does.** The full list of key-to-text pairs for the app frame, sorted under comment banners: shared verbs and nouns (``common.*``); the window title, boot states and backend-health messages (``app.*``); the project launcher (``welcome.*``); the new-project and metadata dialogs (``project.*``); the stage rail and shell landmarks (``spine.*`` / ``shell.*``); the count-words that build sentences like "3 CPTs, 1 borehole and 2 sections imported this session"; the crash-recovery prompt copy; and the toolbar-overflow, inspector and theme controls. A value that carries a ``{name}`` or ``{version}`` marks a slot filled in at display time.

**Why it is here.** Keys are flat and dot-namespaced so a missing translation shows up as a one-line difference against this file. The comments record the reasons behind a few entries: ``common.deletePermanently`` is a distinct, emphatic verb for the irreversible database delete so it never reads the same as the reversible ``common.remove`` (docs/ux.md, reversible vs irreversible); ``shell.stageError.*`` is the per-stage crash card (audit M5) that contains a failure to one stage; and two owner-reconcile notes flag copy that is intentionally stale for now — ``welcome.heading`` still says the old product name "Ground Model" while ``app.name`` is "StrixGeo", and some ``project.*`` keys still carry the old ".gmproj" wording where the catalogue itself has moved to ".strix".

.. CG-EXPLANATION-END id=const:CHROME

