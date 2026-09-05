desktop.renderer.src.components.UnsavedChangesDialog
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/UnsavedChangesDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/UnsavedChangesDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/UnsavedChangesDialog.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the unsaved-changes prompt shown when closing a project that still holds unsaved session work. The comment lays out its three buttons — Save (commit and proceed), Discard (drop and proceed), Cancel (do nothing, default focus) — and stresses that the body copy is load-bearing. The imports bring in the shared ``ConfirmDialog``, the unsaved-work summary shape, both translators (a plain one for the string builders and the hook for the component), and a slot-interpolation helper.

**Why it is here.** The comment records why the wording matters so much: Discard does NOT merely lose typed values — it replace-restores the whole project in the database from the last-saved file, so an afternoon of correlating, dragging boundaries and accepting suggestions reverts too. This is the most destructive gesture in the app, and it is irreversible, so ``docs/ux.md`` applies exactly as on the CPT-refresh dialog: Cancel holds default focus and both action buttons name their action. It follows the same reversible-versus-irreversible rule introduced on the ``CptRefreshConfirmDialog`` page.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=26-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/UnsavedChangesDialog.tsx
   :language: tsx
   :lines: 26-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the project name, a summary of what the session would lose, an optional error from the last failed click, three action callbacks (save, discard, cancel), and a busy flag.

**Why it is here.** The error prop is threaded through (per its comment) because both a failed save and a refused revert deliberately keep the dialog open — a failed save is worth retrying, and a refused revert must not fall through to deleting the session's new records — and an open dialog that says nothing about the click that just failed is indistinguishable from a dead button (audit 2026-08-02). The busy flag disables every action during a save so a slow call cannot be fired twice.

.. CG-EXPLANATION-END id=interface:Props

``function describeImports``
----------------------------

.. CG-BLOCK id=function:describeImports lines=57-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/UnsavedChangesDialog.tsx
   :language: tsx
   :lines: 57-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:describeImports

**What this does.** Turns the session's imports into one plain-English phrase such as "3 CPTs, 1 borehole and 2 sections imported this session", listing only the kinds that were actually imported and returning nothing when none were.

**Why it is here.** Omitting empty kinds (per its docstring) means the engineer never reads a row of zeroes. The counts are real because the app tracks the id sets of what each session imported, and the kind words are looked up through the translator so they follow the app language.

.. CG-EXPLANATION-END id=function:describeImports

``function lossBullets``
------------------------

.. CG-BLOCK id=function:lossBullets lines=87-97

.. literalinclude:: ../../../desktop/src/renderer/src/components/UnsavedChangesDialog.tsx
   :language: tsx
   :lines: 87-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:lossBullets

**What this does.** Builds the bullet list of everything Discard would take: the imports phrase, a line for interpretation edits, and a line for project-detail edits — each added only when present.

**Why it is here.** Imports carry real counts, but interpretation edits do not: the two-stage save model only keeps a single "something was mutated" flag, so its bullet says the work is uncounted rather than inventing a number the app does not have (per the docstring).

.. CG-EXPLANATION-END id=function:lossBullets

``function UnsavedChangesDialog``
---------------------------------

.. CG-BLOCK id=function:UnsavedChangesDialog lines=98-177

.. literalinclude:: ../../../desktop/src/renderer/src/components/UnsavedChangesDialog.tsx
   :language: tsx
   :lines: 98-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnsavedChangesDialog

**What this does.** The dialog component. It builds the loss bullets and picks its lead and follow-up wording depending on whether the project has ever been saved. It then draws a ``ConfirmDialog`` with a title naming the project, a body of a lead sentence, the bullet list, a closing line, and an inline error banner when a previous click failed. Discard is the secondary action and Save is the primary confirm; Cancel is the safe default.

**Why it is here.** The wording branches on whether a saved file exists because a never-saved project has no file to revert to — Discard there deletes the session's new records instead, and promising a "revert" would be the same kind of lie the old copy told (per the comment). The lead deliberately never opens on the metadata editor, because that framing once made the prompt read as "your typing is at stake" to an engineer who had actually spent the afternoon correlating; the editor now appears only in its own bullet and only when it holds a draft. Cancel holding default focus and both actions naming themselves is the irreversible-action rule again.

.. CG-EXPLANATION-END id=function:UnsavedChangesDialog

