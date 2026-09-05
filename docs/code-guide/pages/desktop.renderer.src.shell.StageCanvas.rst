desktop.renderer.src.shell.StageCanvas
======================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageCanvas.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file draws the centre zone — the big working area between the left spine and the right inspector. The comments explain that it shows the active stage's own canvas component, that it holds an as-yet-empty slot reserved for a future section scrub bar, and that switching stages plays a brief fade. The imports bring in ``useRef`` (explained on the function below), the stage-id type, and the registry it looks the active stage up in.

**Why it is here.** The comments record two decisions. The fade is wrapped so it plays only for viewers who have not asked for reduced motion, keeping to the same motion budget as the rest of the shell. And only the shell's own chrome uses the app's named theme tokens here — each stage's canvas component keeps its own existing styling — so this file stays a thin wrapper and does not reach into how a stage paints itself.

.. CG-EXPLANATION-END id=module-header

``interface StageCanvasProps``
------------------------------

.. CG-BLOCK id=interface:StageCanvasProps lines=20-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageCanvas.tsx
   :language: tsx
   :lines: 20-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StageCanvasProps

**What this does.** Describes the one input this zone needs: ``activeStageId``, the stage whose canvas should fill the centre.

**Why it is here.** The docstring explains the rest: the zone takes all the horizontal space left over, the active stage's canvas fills it, and a reserved scrub-bar slot sits at the bottom awaiting a later feature. It also flags the important detail carried out in the function — that a changing key forces React to throw away the previous stage's canvas and build the new one fresh, so no leftover state leaks from one stage into the next.

.. CG-EXPLANATION-END id=interface:StageCanvasProps

``function StageCanvas``
------------------------

.. CG-BLOCK id=function:StageCanvas lines=47-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageCanvas.tsx
   :language: tsx
   :lines: 47-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:StageCanvas

**What this does.** Draws the centre zone. It keeps a *ref* — a remembered box whose value survives redraws but, unlike state, changing it does not itself trigger a redraw — holding the previous stage id, and compares it to the current one to tell whether the stage just changed; if so, the incoming canvas is drawn with a short fade-in. It looks the active stage up in the registry, and draws that stage's canvas inside a wrapper that carries the stage id as its *key*. Below sits the empty, reserved scrub-bar slot.

**Why it is here.** The comments explain two subtle choices. The ref deliberately lives in this outer component rather than inside the keyed area, because React resets a component's state on a key change but does not reset a ref held above it — so the box correctly remembers "a change just happened" into the next redraw. And the wrapper is required to be a flex column, not a plain box, because the stage canvases inside it (the map, the chart) rely on this parent being a flex container to be given a height — a plain box would collapse them to zero pixels and they would render blank.

.. CG-EXPLANATION-END id=function:StageCanvas

