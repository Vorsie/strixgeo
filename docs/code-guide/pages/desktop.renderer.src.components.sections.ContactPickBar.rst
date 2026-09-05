desktop.renderer.src.components.sections.ContactPickBar
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ContactPickBar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ContactPickBar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactPickBar.tsx
   :language: tsx
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the hover-driven pick affordance over a single CPT's data band: hover and a thin line tracks the cursor depth while a floating card reads out the values the engineer needs — cone resistance qc, friction ratio Rf, depth, and elevation in metres TAW — and a click commits that depth as a formation top. The imports bring in React hooks, the CPT data type, the click-timing helper, the value-interpolation helper, the readout card, and a depth-axis helper.

**Why it is here.** The card shows exactly the numbers an engineer weighs when deciding whether a depth is a formation boundary. It keeps no lasting state — the ghost exists only while hovering — so the section stays uncluttered when the engineer is not actively placing contacts.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=33-81

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactPickBar.tsx
   :language: tsx
   :lines: 33-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the CPT plot data, its type, name, and id, the column's screen X and half-width, the surface elevation and plot bounds, the cap-clamped top and bottom of the data band, the elevation-to-screen converter, an optional commit-depth callback, and an optional double-click-to-open callback.

**Why it is here.** The commit callback is optional so the same bar can run in a read-only hover mode (a focus view with no active model): the hover readout still works, but a click does nothing. The double-click passthrough is needed because the pick overlay is a sibling of the column glyph, not a child, so a double-click on the data band would otherwise cancel the queued single click without ever opening detail.

.. CG-EXPLANATION-END id=interface:Props

``function ContactPickBar``
---------------------------

.. CG-BLOCK id=function:ContactPickBar lines=82-258

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactPickBar.tsx
   :language: tsx
   :lines: 82-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:ContactPickBar

**What this does.** The component. It remembers the cursor's Y and keeps a handle to the invisible capture rectangle. It pre-builds the depth/qc/Rf arrays once so hovering can interpolate cheaply, then computes the surface-anchored depth axis. On move it tracks the clamped cursor depth; on click it captures the depth and schedules the commit (looking up qc and Rf at that depth); a double-click cancels the queued single and forwards the open-detail intent. It draws the transparent capture rect, and while hovering a dashed ghost line plus the four-line readout card.

**Why it is here.** The click-timing helper (the single-versus-double gate) is declared before the early exit on purpose — React's Rules of Hooks require a stable hook order, and the guard's docstring points straight at the Temporal-Dead-Zone rule in CLAUDE.md. The depth is captured at click time because the commit runs a fraction of a second later, after the cursor may have moved. Holding Shift bails so the section box-select can take the gesture instead. A CPT pick is always marked not-snapped because a CPT carries no stratigraphy stream to snap to.

.. CG-EXPLANATION-END id=function:ContactPickBar

