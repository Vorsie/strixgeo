desktop.renderer.src.components.CrossingSectionPickerDialog
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/CrossingSectionPickerDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/CrossingSectionPickerDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/CrossingSectionPickerDialog.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the crossing-section picker. The comment explains it opens from the surface-crossings banner when the contacts that cross sit inside more than one cross-section's corridor, and it lets the engineer pick which section to jump to; when only one section contains them the caller skips the dialog and jumps straight there. It imports ``useEffect``, ``useRef`` and ``useState``, the section type, the shared ``Button`` and ``Modal``, and the translator.

**Why it is here.** This is a plain picker, not a destructive confirmation — nothing is deleted, the engineer is just choosing where to navigate. Its behaviour mirrors the litho-geo snap dialog (per the comment): Escape and Cancel both dismiss without picking, and the primary action holds default focus.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=20-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/CrossingSectionPickerDialog.tsx
   :language: tsx
   :lines: 20-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the candidate sections (pre-filtered to those whose corridor holds an offending anchor), a pick callback given the chosen section's id, and a cancel callback for Escape, Cancel or a backdrop click.

**Why it is here.** The candidates arrive already filtered and ordered by the caller, so the dialog just lists them; picking one navigates to it, pans to the spot and pulses it amber to draw the eye.

.. CG-EXPLANATION-END id=interface:Props

``function CrossingSectionPickerDialog``
----------------------------------------

.. CG-BLOCK id=function:CrossingSectionPickerDialog lines=33-127

.. literalinclude:: ../../../desktop/src/renderer/src/components/CrossingSectionPickerDialog.tsx
   :language: tsx
   :lines: 33-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:CrossingSectionPickerDialog

**What this does.** The picker component. It remembers which candidate is selected (defaulting to the first), re-seeds that when it opens, and focuses the Go button on open. It draws nothing when closed or when there are no candidates, and otherwise a ``Modal`` with a title, a count, a radio list of the candidate sections, and Cancel/Open buttons.

**Why it is here.** Focusing the primary Go button and defaulting the selection to the first candidate means an engineer can open, glance and press Enter for the common case. This is the reversible side of the reversible-versus-irreversible rule introduced on the ``CptRefreshConfirmDialog`` page — a navigation choice, so the go-ahead is the default rather than Cancel.

.. CG-EXPLANATION-END id=function:CrossingSectionPickerDialog

