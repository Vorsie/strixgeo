desktop.renderer.src.components.interpretation.FormationPickerDialog
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/interpretation/FormationPickerDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/interpretation/FormationPickerDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationPickerDialog.tsx
   :language: tsx
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment says this dialog opens after the user picks a depth on a borehole or CPT in the cross-section: it lists every project formation with its colour, name and regional reference, and clicking a row commits the contact through a handler and closes the dialog; a subtitle shows which anchor and depth is being committed. It lists the v1 scope and the deferred ideas (search, recent list). It imports a React hook, a plus icon, the formation types, a youngest-first ordering helper, the shared Button and Modal, the sibling FormationDialog, and the translation helper.

**Why it is here.** This is the pick step of the click-to-place contact workflow. The subtitle showing the anchor and depth exists so the user can confirm exactly what they are about to commit before choosing a formation. It reuses the shared Modal and Button (see the ``desktop.renderer.src.components.ui.Modal`` page) and embeds the create dialog so a missing formation can be added without leaving the flow.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=37-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationPickerDialog.tsx
   :language: tsx
   :lines: 37-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the dialog's inputs: whether it is ``open``, the list of ``formations``, the ``anchor`` being placed on (its kind, name, depth and elevation, or null), an ``onSelect`` handler for picking an existing formation, an ``onCreateFormation`` handler that creates one inline and returns its id, and ``onCancel``.

**Why it is here.** The anchor is passed so the subtitle can state the depth's reference frame. The create handler returns the new formation's id so the dialog can select it immediately, chaining the create-and-commit into one action without a second click — the comment records this intent.

.. CG-EXPLANATION-END id=interface:Props

``function FormationPickerDialog``
----------------------------------

.. CG-BLOCK id=function:FormationPickerDialog lines=59-192

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationPickerDialog.tsx
   :language: tsx
   :lines: 59-192
   :lineno-match:

.. CG-EXPLANATION-START id=function:FormationPickerDialog

**What this does.** The dialog component. It keeps the id of the row currently being committed and whether the inline create dialog is open, both as *state*. Picking a formation marks that row busy, awaits the commit, then clears the busy mark. Creating inline runs the create handler, closes the create dialog, and immediately selects the new formation if one came back. It draws the Modal with the anchor subtitle and a scrollable list of formation rows — each showing its colour swatch, name and optional regional reference — plus a "new formation here" button and Cancel; alongside it, the embedded create dialog is shown when that button is used.

**Why it is here.** The busy id disables every row while a commit is in flight, so a contact cannot be double-placed. Formations are listed youngest-first so the list reads like the geology inspector and a borehole log, surface at the top — the comment records this. The name is the engineer-facing label with the raw regional reference shown beneath it, matching the show-the-raw-token side of the translate-at-the-boundary rule. The elevation in the subtitle is shown with a leading plus for positive values, the same signed convention as the depth axis.

.. CG-EXPLANATION-END id=function:FormationPickerDialog

