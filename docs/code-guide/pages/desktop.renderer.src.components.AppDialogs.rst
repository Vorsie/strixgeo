desktop.renderer.src.components.AppDialogs
==========================================

.. CG-PAGE source=desktop/src/renderer/src/components/AppDialogs.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/AppDialogs.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppDialogs.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the app-level overlays — the toast stack (the small corner notifications) plus the four global dialogs. The imports bring in a few icons, the project types, the toast and summary shapes, the New-Project, Metadata and Unsaved-Changes dialogs, the shared ``Modal`` and ``Button``, and the translator.

**Why it is here.** The comment records that this was lifted verbatim out of the top component (debt #12) and, crucially, that these overlays sit outside the shell's shared context so they float above all the shell chrome. It is a pure presentational relocation: the top component still owns every open-flag, the toasts and every handler, and passes them in — no logic moved here.

.. CG-EXPLANATION-END id=module-header

``interface AppDialogsProps``
-----------------------------

.. CG-BLOCK id=interface:AppDialogsProps lines=23-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppDialogs.tsx
   :language: tsx
   :lines: 23-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AppDialogsProps

**What this does.** The many inputs this overlay bundle takes: the toast list and a dismiss function, the open-flags and handlers for the New-Project, Metadata, Unsaved-Changes and Close-Confirm dialogs, the live and saved project, the unsaved-work summary, a saving flag, and the last unsaved-action error.

**Why it is here.** Because the top component owns all this state, it must all be passed in, so the prop list is long by design. Two comments carry lessons: only sticky (error) toasts get a close button, but an error that never expires must have a way out or the stack would grow without bound; and the unsaved-action error is rendered inside the dialog because an open dialog after a failed click that says nothing reads as a dead button (audit 2026-08-02).

.. CG-EXPLANATION-END id=interface:AppDialogsProps

``function AppDialogs``
-----------------------

.. CG-BLOCK id=function:AppDialogs lines=72-214

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppDialogs.tsx
   :language: tsx
   :lines: 72-214
   :lineno-match:

.. CG-EXPLANATION-START id=function:AppDialogs

**What this does.** Draws the overlay fragment: the fixed toast stack (each toast coloured by kind, errors carrying a close button), then the New-Project dialog, the Metadata editor, the Unsaved-Changes dialog, and a small Close-Confirm modal that asks before closing a project.

**Why it is here.** These are drawn at the app level, above all shell chrome, so a toast or dialog is never buried under the workspace. The comment on the Metadata editor restates the two-stage save: its Save commits to live state and the database-and-file write happens later on File → Save. The toast stack is layered above the map's own controls so notifications are never hidden, and a long sticky error is width-capped so it wraps inside its card rather than running off-screen.

.. CG-EXPLANATION-END id=function:AppDialogs

