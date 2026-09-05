desktop.renderer.src.shell.stages.geology.GeologyToolbar
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyToolbar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyToolbar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-67

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyToolbar.tsx
   :language: tsx
   :lines: 1-67
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the geology stage toolbar file, lists the verb order in a comment (Fill from boreholes, then Build 3-D model, Dedupe, Reset view, and Delete stratigraphy), and imports React hooks, the icons, the shell hook, the shared toolbar button primitives and the responsive row, the UI Modal, Button and ConfirmDialog, the dedupe-confirm dialog and its hook, the duplicate-contact counter, the formation-deletion-scope helper, the formation selection dialog, an API type, the reset callbacks exported by the canvas, and the translator; it ends with the component's docstring.

**Why it is here.** The toolbar is the verb row at the top of a stage. The comment records two design choices: Reset is wired through the canvas's module-level ref callbacks rather than the shell bus, because split-viewport and camera state is session-ephemeral and needs no persistence; and the shared button primitives were extracted at the rule-of-three window (debt #46). It takes no props — all state and handlers come from ``useShell()`` per the toolbar-component contract. The heavy verbs (Build, subdivide) follow the on-click-build principle: the model is rebuilt only when the engineer presses the verb, never silently.

.. CG-EXPLANATION-END id=module-header

``function GeologyToolbar``
---------------------------

.. CG-BLOCK id=function:GeologyToolbar lines=68-724

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyToolbar.tsx
   :language: tsx
   :lines: 68-724
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyToolbar

**What this does.** The toolbar component. It holds the state for each verb — busy flags for discovery, apply, rebuild, dedupe and delete; the discovered candidate list and its collisions; the boreholes being filled; a parked add-vs-overwrite apply; and a debounce timer and request counter. Fill from boreholes runs a read-only discovery scan and then opens the FormationSelectionDialog; editing the groups inside that dialog re-runs discovery (debounced, last-write-wins) to refresh the collision panel; confirming applies the selection, but first asks add-vs-overwrite only when something would actually be removed. Build rebuilds the surfaces; Dedupe opens a confirm then deletes duplicate contacts; Reset collapses the split viewport and flies the camera home; Delete stratigraphy opens a confirm modal. The render lays the verbs into a responsive row that overflows to a menu, and mounts the four dialogs and modals.

**Why it is here.** The add-vs-overwrite prompt exists because of the 2026-08-03 data loss: an apply meant to ADD one unit removed four saved ones, since a bare selection was itself an instruction to delete everything else. So Apply now asks — but ONLY when something would be removed, because putting a dialog in front of a harmless pure addition would just train the engineer to click through the prompt that matters. The same map used for the last preview is forwarded straight to the apply call with no re-discovery in between, which preserves the discover-equals-apply invariant the backend enforces. Delete and Dedupe are irreversible, so each goes through a confirmation with Cancel default-focused and an action-named button; the server's guard that refuses to delete a stratigraphy while a dependent litho or geotech model still exists is surfaced as a toast rather than swallowed. Build is disabled when there are no contacts (debt #94), because the triangulation has nothing to build from and clicking would be a confusing no-op.

.. CG-EXPLANATION-END id=function:GeologyToolbar

