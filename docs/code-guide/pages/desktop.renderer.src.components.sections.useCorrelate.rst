desktop.renderer.src.components.sections.useCorrelate
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useCorrelate.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useCorrelate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useCorrelate.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook that owns the two-step correlate gesture on the litho cross-section: arm a source band, click a target, and the caller posts the correlation edge. The header includes the small state machine of the gesture.

**Why it is here.** It mirrors the shape of the focus hook: transient interface state, never saved into the project bundle. It deliberately does not call the API itself; the caller owns the network request, so the hook stays testable without any fetch mocks.

.. CG-EXPLANATION-END id=module-header

``interface CorrelationSource``
-------------------------------

.. CG-BLOCK id=interface:CorrelationSource lines=26-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useCorrelate.ts
   :language: typescript
   :lines: 26-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CorrelationSource

**What this does.** The armed source: the formation id, the investigation the unit band sits on, and a human-readable label for the floating tooltip.

**Why it is here.** It names the band the engineer armed to connect from.

.. CG-EXPLANATION-END id=interface:CorrelationSource

``interface UseCorrelateResult``
--------------------------------

.. CG-BLOCK id=interface:UseCorrelateResult lines=35-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useCorrelate.ts
   :language: typescript
   :lines: 35-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseCorrelateResult

**What this does.** What the hook returns: whether correlate mode is active, the currently armed source or nothing, and the enter, exit, arm and clear callbacks.

**Why it is here.** It exposes two Esc layers: clearing the armed source without leaving the mode, and exiting the mode entirely.

.. CG-EXPLANATION-END id=interface:UseCorrelateResult

``function useCorrelate``
-------------------------

.. CG-BLOCK id=function:useCorrelate lines=65-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useCorrelate.ts
   :language: typescript
   :lines: 65-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:useCorrelate

**What this does.** Holds the mode flag and the armed source, and defines enter (turn the mode on), exit (turn it off and clear), arm (set or replace the source), and clear (drop just the armed source).

**Why it is here.** Arming replaces any prior source, so switching to another investigation re-arms cleanly, and exiting clears both the mode and the source together.

.. CG-EXPLANATION-END id=function:useCorrelate

