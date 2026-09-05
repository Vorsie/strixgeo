desktop.renderer.src.components.ui.CheatsheetDialog
===================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. The comment says this dialog is the single searchable reference for every gesture and keyboard shortcut across every stage, reached from Help, and it records where the content comes from — the shortcut tables in ``docs/ux.md`` plus the section-editor hint pill — with the rule that a gesture change in either place must update the matching row here in the same commit. It imports four icons, four React hooks, the shared ``Modal``, and the translation helper.

**Why it is here.** The dialog answers a discoverability problem: the section editor's small hint pill lists only a few gestures, and the rest were findable only by reading the design docs. Naming ``docs/ux.md`` as the single source of truth, and requiring both to change together, keeps the on-screen cheatsheet from drifting away from how the app actually behaves. It is built on the shared ``Modal`` from the ``desktop.renderer.src.components.ui.Modal`` page, which supplies Escape and backdrop dismissal for free.

.. CG-EXPLANATION-END id=module-header

``interface CheatRow``
----------------------

.. CG-BLOCK id=interface:CheatRow lines=25-31

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 25-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CheatRow

**What this does.** Describes one cheatsheet entry: a ``trigger`` (the key combination or mouse gesture) and an ``action`` (what it does).

**Why it is here.** Both fields are plain text so the search box can match against either — typing "alt", "zoom" or "marquee" then finds the right row fast.

.. CG-EXPLANATION-END id=interface:CheatRow

``interface CheatGroup``
------------------------

.. CG-BLOCK id=interface:CheatGroup lines=32-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 32-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CheatGroup

**What this does.** Describes a titled group of related entries: a ``heading`` and its list of rows.

**Why it is here.** Grouping mirrors the tables in ``docs/ux.md`` and the individual stages, so the reference is organised the same way the rest of the documentation is.

.. CG-EXPLANATION-END id=interface:CheatGroup

``const GROUPS``
----------------

.. CG-BLOCK id=const:GROUPS lines=41-186

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 41-186
   :lineno-match:

.. CG-EXPLANATION-START id=const:GROUPS

**What this does.** The full content of the cheatsheet: the grouped lists of gestures and shortcuts — global, lists and sidebar, map, borehole log, the several section-editor groups, and the inspector — each row pairing a trigger with what it does.

**Why it is here.** This is the authored copy of every gesture, transcribed from ``docs/ux.md`` and the section hint pill. The comments record deliberate choices: shortcuts that are documented but not yet wired are left out so the sheet never lists a dead key that misleads; redo accepts a second combination because it is muscle memory for the Windows and CAD audience; and several single-key toggles were added on specific owner rulings (2026-08-14 and 2026-08-15) because they are flipped often during interpretation.

.. CG-EXPLANATION-END id=const:GROUPS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=187-202

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 187-202
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the dialog's two inputs and its documentation: whether it is ``open`` and the ``onClose`` handler.

**Why it is here.** The documentation notes that when ``open`` is false the component draws nothing, and that Escape and a backdrop click reach ``onClose`` through the shared ``Modal`` — the caller only owns opening and closing.

.. CG-EXPLANATION-END id=interface:Props

``function CheatsheetDialog``
-----------------------------

.. CG-BLOCK id=function:CheatsheetDialog lines=203-326

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/CheatsheetDialog.tsx
   :language: tsx
   :lines: 203-326
   :lineno-match:

.. CG-EXPLANATION-START id=function:CheatsheetDialog

**What this does.** The dialog component. It reads the translation helper, keeps the search text as *state* and a *ref* to the search box. An *effect* clears the search text and focuses the box each time the dialog opens. A *memo* recomputes the filtered groups whenever the search text changes — keeping only rows whose trigger or action contains the query and dropping groups left empty. It draws a ``Modal`` with a titled header and a close button, the search box, and either the grouped rows or a friendly no-results message.

**Why it is here.** Clearing the search on open stops a stale query from a previous session from hiding rows, and focusing the box lets the user type immediately — the caller-owns-default-focus rule from ``docs/ux.md``. A *memo* (which caches a computed value until its inputs change) is used for the filter so the list is recomputed only when the query changes, not on every unrelated redraw. Building on the shared ``Modal`` keeps the escape-to-close and focus handling consistent with every other dialog.

.. CG-EXPLANATION-END id=function:CheatsheetDialog

