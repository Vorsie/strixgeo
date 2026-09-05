desktop.renderer.src.components.sections.VirtueleBoringStrip
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx
   :language: tsx
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the overlay-controls strip that sits under the section header and owns the user's Virtuele Boring picker: two model dropdowns, a depth input, and a show-on-section toggle. It imports icons, React's hooks, the catalogue data type, the catalogue-loading hook, translation, the numeric-input parser helpers, and the depth bounds.

**Why it is here.** The docstring records the design: the model catalogue is fetched lazily on first mount and cached for the session; the picker is collapsed by default so the strip does not intrude before the user asks for overlays; clearing the depth input renders DOV's full crustal column to bedrock; and the show-on-section toggle collapses the overlay without losing the picker state.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=38-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx
   :language: tsx
   :lines: 38-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the two chosen model codes (or null), the depth in metres (or null for full), the per-pane visibility flag, a callback fired when the picker changes, and a callback for the visibility toggle.

**Why it is here.** The comment on the visibility flag: the picker stays functional even when the overlay is hidden, so toggling it back on shows the already-fetched predictions immediately.

.. CG-EXPLANATION-END id=interface:Props

``function VirtueleBoringStrip``
--------------------------------

.. CG-BLOCK id=function:VirtueleBoringStrip lines=54-182

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx
   :language: tsx
   :lines: 54-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtueleBoringStrip

**What this does.** The component. It starts open when a model is already chosen, lazily loads the catalogue, and keeps a local depth string that follows the prop but updates live as the user types. Its commit helper clears the depth to full on an empty input, parses the typed value through the shared numeric parser, resets on an unparseable value, and clamps a valid one into the allowed range. It renders a collapsible bar with the two model dropdowns, the depth field, and, when a model is active, the show-on-section checkbox.

**Why it is here.** The comments record the reasons: the depth field is a plain text input rather than a number input because the browser's number-input sanitising dropped a comma-decimal like '12,5' and silently reset the overlay to the full column; negatives are refused because the depth is measured downward from each surface and has no meaning above it; and the local-then-commit pattern matches the section-buffer slider's commit-on-release convention.

.. CG-EXPLANATION-END id=function:VirtueleBoringStrip

``function ModelSlotDropdown``
------------------------------

.. CG-BLOCK id=function:ModelSlotDropdown lines=183-214

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringStrip.tsx
   :language: tsx
   :lines: 183-214
   :lineno-match:

.. CG-EXPLANATION-START id=function:ModelSlotDropdown

**What this does.** A small component that draws one model-slot dropdown, listing 'Off' plus every catalogue entry, disabled until the catalogue has loaded, and reporting the chosen code (or null for Off) to its caller.

**Why it is here.** Two identical dropdowns (slot A and slot B) share one implementation rather than being written twice, and disabling until the catalogue lands stops a selection before the options exist.

.. CG-EXPLANATION-END id=function:ModelSlotDropdown

