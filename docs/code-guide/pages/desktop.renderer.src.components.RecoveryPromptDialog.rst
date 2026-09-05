desktop.renderer.src.components.RecoveryPromptDialog
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/RecoveryPromptDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/RecoveryPromptDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/RecoveryPromptDialog.tsx
   :language: tsx
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The long top comment and imports for the recovery prompt. The comment sets out the dialog's exact wording rules and its three choices — Restore (apply the recovered work, keep the backup), Not now (keep the backup, safe answer, holds default focus), and Delete backup (revert the database to the last save and delete the file, irreversible). The imports bring in the shared ``ConfirmDialog``, the recovery-age helper, the snapshot shape, and both a plain translation helper for the string builders and the ``useT`` hook for the component.

**Why it is here.** This is a *confirmation dialog* built on the shared ``ConfirmDialog`` — a dialog that asks the user to confirm before something happens. The comment records the copy discipline from ``docs/design/autosave-recovery.md`` §1: a crash in this app destroys no interpretation, because every gesture is an awaited call landing in a database whose life is independent of the window, so the dialog restores unsaved session work, never "your project". It also encodes the reversible-versus-irreversible rule (CLAUDE.md; ``docs/ux.md``): Delete backup is irreversible, so it gets destructive styling, a button that names the action, and is NOT the default-focused control, while the safe Not-now choice holds default focus so an accidental Enter costs nothing. Two translators are imported because the string-building helpers run outside the component and use the plain one, while the component uses the hook so it re-draws when the language is switched live.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=42-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/RecoveryPromptDialog.tsx
   :language: tsx
   :lines: 42-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the project name, the validated recovery snapshot, when the file was written, three action callbacks (restore, open-without-restoring, discard), and a busy flag.

**Why it is here.** The three callbacks map one-to-one onto the three choices; the comments restate their consequences (Restore keeps the file, open-without also catches Escape and the backdrop, Discard is irreversible). The busy flag disables every action while a restore is in flight so the user cannot fire a second answer mid-restore.

.. CG-EXPLANATION-END id=interface:Props

``function describeImports``
----------------------------

.. CG-BLOCK id=function:describeImports lines=69-102

.. literalinclude:: ../../../desktop/src/renderer/src/components/RecoveryPromptDialog.tsx
   :language: tsx
   :lines: 69-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:describeImports

**What this does.** Turns the snapshot's session imports into one plain-English phrase — for example "imported 2 CPTs and 1 borehole this session" — listing only the kinds that are actually present, and returning nothing when nothing was imported.

**Why it is here.** It shares the exact shape of the same helper in the unsaved-changes dialog so the two read alike, and it omits empty kinds (per its docstring) so the engineer never reads a row of zeroes. The import kind words are looked up through the translator so they follow the app language.

.. CG-EXPLANATION-END id=function:describeImports

``function restoreBullets``
---------------------------

.. CG-BLOCK id=function:restoreBullets lines=103-152

.. literalinclude:: ../../../desktop/src/renderer/src/components/RecoveryPromptDialog.tsx
   :language: tsx
   :lines: 103-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:restoreBullets

**What this does.** Builds the short bullet list of what Restore brings back: any litho triage columns, the imported-this-session phrase, any project-detail edits, the stratigraphy grouping map, and a marker for unsaved model changes — each added only when the snapshot actually carries it.

**Why it is here.** Listing only present items keeps the list honest and short. Its docstring notes the manifest sets are deliberately left out — the design calls them "unreconstructed, not lost", bookkeeping the engineer never sees. The comment on the unsaved-mutations marker flags it as the nastiest of the recovered items: without it the project would reopen looking clean and a later Delete backup would silently revert the database to the file, destroying pre-crash work the crash never touched.

.. CG-EXPLANATION-END id=function:restoreBullets

``function RecoveryPromptDialog``
---------------------------------

.. CG-BLOCK id=function:RecoveryPromptDialog lines=153-228

.. literalinclude:: ../../../desktop/src/renderer/src/components/RecoveryPromptDialog.tsx
   :language: tsx
   :lines: 153-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:RecoveryPromptDialog

**What this does.** The dialog component. It builds the bullet list and the age line, then draws a ``ConfirmDialog`` whose body is an intro line (with the age and bullets), a bold reassurance that the saved file is untouched, and a three-line legend — one line per button in button order. The safe Not-now choice is wired to Cancel (so Escape and the backdrop land there), Delete backup is the destructive secondary action, and Restore is the primary confirm.

**Why it is here.** The body is a per-button legend rather than prose because the owner's dogfeed verdict on the prose version was that it was too long and it was unclear what each button did (owner dogfeed 2026-08-03). Wiring Not-now to Cancel makes the reflex dismissal — Escape or a backdrop click — the safe one that keeps the backup, honouring the reversible-versus-irreversible rule. The bold "saved file untouched" line carries the one sentence the owner dictated verbatim, that nothing is written to the file until you click Save in the app — the two-stage save made visible at the moment it matters most. The component itself makes no decisions; every choice is the caller's, exactly like the unsaved-changes dialog it mirrors.

.. CG-EXPLANATION-END id=function:RecoveryPromptDialog

