desktop.renderer.src.components.interpretation.LithoGhostCompositionEditor
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment says this is a simpler modal that lets the engineer change a ghost suggestion's main soil code and admixtures before accepting it — no tabs, no existing-units list, no server call — and that Save just returns the composition to the caller, which stores it and commits it on accept. It explains why this is a separate component rather than a reuse of the bigger picker dialog. It imports React hooks, two icons, the shared Modal and Button, the shared litho label helpers and admixture option tables, and the translation helper.

**Why it is here.** The comment records the design decision: the picker dialog is built around creating or picking a formation on the server, whereas this editor is purely local state, so reusing the picker would need an edit-mode branch that hides a tab and swaps the save handler — more complexity than a small dedicated editor. It shares the same vocabulary tables as the picker so the two surfaces cannot drift on naming; the comment notes a 2026-05-21 dogfeed bug where a stored code fell outside the option list and rendered as the wrong label, fixed by drawing the options from one shared source.

.. CG-EXPLANATION-END id=module-header

``const MAIN_SOIL_CODES``
-------------------------

.. CG-BLOCK id=const:MAIN_SOIL_CODES lines=42-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 42-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAIN_SOIL_CODES

**What this does.** The five main soil codes offered, mirroring the picker dialog: gravel, sand, silt, clay and peat.

**Why it is here.** The same fixed set of main classes as the picker, kept in step so the two editors offer identical choices; see the ``desktop.renderer.src.components.interpretation.LithoCompositionPickerDialog`` page.

.. CG-EXPLANATION-END id=const:MAIN_SOIL_CODES

``type MainSoilCode``
---------------------

.. CG-BLOCK id=type:MainSoilCode lines=43-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 43-44
   :lineno-match:

.. CG-EXPLANATION-START id=type:MainSoilCode

**What this does.** A type standing for exactly one of the five main soil codes.

**Why it is here.** Derived from the list above so the allowed main-soil value is always one of the five, checked before the app runs.

.. CG-EXPLANATION-END id=type:MainSoilCode

``interface GhostAdmixtureItem``
--------------------------------

.. CG-BLOCK id=interface:GhostAdmixtureItem lines=45-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 45-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GhostAdmixtureItem

**What this does.** Describes one admixture the editor works with: a soil code, an amount, and a locally flag.

**Why it is here.** This is the plain composition shape passed in and returned, matching what a ghost suggestion carries, so no conversion is needed at the boundary.

.. CG-EXPLANATION-END id=interface:GhostAdmixtureItem

``interface AdmixtureRow``
--------------------------

.. CG-BLOCK id=interface:AdmixtureRow lines=51-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 51-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AdmixtureRow

**What this does.** Extends the admixture item with a stable numeric id for the editable row.

**Why it is here.** The id is a stable key so React can track each row across redraws and edits, separating the on-screen editing shape from the plain data shape that is saved.

.. CG-EXPLANATION-END id=interface:AdmixtureRow

``interface LithoGhostCompositionEditorProps``
----------------------------------------------

.. CG-BLOCK id=interface:LithoGhostCompositionEditorProps lines=56-83

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 56-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoGhostCompositionEditorProps

**What this does.** Lists the editor's inputs: whether it is open, the initial main soil code and admixture list, an optional flag that locks the main soil, the Save handler, and the Cancel handler.

**Why it is here.** The initial admixtures are cloned at open so an outside change cannot bleed into the edit in progress. The lock flag exists for editing a whole correlated body, where the body's lithology is fixed by its correlation group and only the admixtures may change — the comment records this. Save hands the result back and does not close the dialog itself, matching the picker's pattern so the caller can batch its state updates.

.. CG-EXPLANATION-END id=interface:LithoGhostCompositionEditorProps

``function LithoGhostCompositionEditor``
----------------------------------------

.. CG-BLOCK id=function:LithoGhostCompositionEditor lines=84-353

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoGhostCompositionEditor.tsx
   :language: tsx
   :lines: 84-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoGhostCompositionEditor

**What this does.** The editor component. It normalises the incoming main soil code (falling back to sand for an unknown value), keeps the main code and the admixture rows as *state*, and seeds that state only on the moment the dialog opens — detected with a *ref* that remembers whether it was open last time. It offers add, remove and edit of admixture rows, a live name preview, and a Save that returns the composition. It draws the Modal with the title, the main-soil dropdown (disabled when locked), the admixture rows, the preview, and the Cancel and Save buttons. For each row it appends a one-off fallback option when the stored code is not in the curated list.

**Why it is here.** The seeding is gated to the closed-to-open transition, and the effect's dependency list is deliberately just the open flag with a recorded reason on the linter suppression: the parent passes a freshly-built admixtures array on every redraw, so listing that array would re-run the seeding on every parent redraw and wipe the edit in progress — the 2026-05-20 dogfeed bug. Gating on the open transition seeds correctly for each new ghost layer while treating the user's state as the source of truth while open. The per-row fallback option is a safety net from a 2026-05-21 dogfeed: without it a stored code outside the list made the dropdown silently snap to the first option and misreport the value. The main-soil labels are shown in the interface language, never the raw Dutch token in parentheses, after a 2026-05-23 dogfeed where that leaked Dutch into an English interface — the picker follows the same rule, keeping the two consistent. The preview uses the same shared name formatter so the user sees identical naming everywhere.

.. CG-EXPLANATION-END id=function:LithoGhostCompositionEditor

