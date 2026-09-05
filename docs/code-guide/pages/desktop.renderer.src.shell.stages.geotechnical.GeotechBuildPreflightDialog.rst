desktop.renderer.src.shell.stages.geotechnical.GeotechBuildPreflightDialog
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildPreflightDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildPreflightDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildPreflightDialog.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that draws the question the geotech "Build model" press asks when a test in the model has accepted lithology but no packing bands yet. The top comment records the owner's ruling and spells out three things the dialog deliberately is NOT: not a warning that fires on a finished model, not a destructive dialog (so Cancel is not the default button), and not a plain list of names (every name is a clickable button). It then pulls in the ``Button``, the ``Modal`` pop-up, the translation helper, and the type describing one unbanded test.

**Why it is here.** The owner's constraint is "I can't have gaps or fallbacks in the model unless users make mistakes": a test imported after the subdivision would leave a gap the build has nothing to fill, so the press stops and asks. The three "is NOT" notes exist so a later reader does not mistakenly apply the usual delete-style rules — on a complete model this dialog never opens, and every button here is a build the engineer can simply redo.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=34-77

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildPreflightDialog.tsx
   :language: tsx
   :lines: 34-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Names the inputs the parent hands this dialog (its "props"): ``open`` (whether to draw it), ``tests`` (the pre-flight's findings — tests with accepted litho and no packing bands), ``onVisitTest`` (go to one test by opening a section that carries it and pulsing it), ``onSubdivideAndBuild`` (the default — subdivide the listed tests then build), ``onBuildWithout`` (build ignoring them, reproducing the model as it was before the tests were added), ``onCancel`` (close without building), and an optional ``busy`` flag that disables everything while an action runs.

**Why it is here.** An ``interface`` is a written note about an object's shape, letting the parent and dialog agree on exactly what passes between them. There are three ways out because the owner asked for three: fix the gap, ignore the gap, or back out — and the "go to this test" action exists because the ruling was explicitly for one-click access to the offending test rather than a name the engineer has to go hunt for.

.. CG-EXPLANATION-END id=interface:Props

``function GeotechBuildPreflightDialog``
----------------------------------------

.. CG-BLOCK id=function:GeotechBuildPreflightDialog lines=78-190

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildPreflightDialog.tsx
   :language: tsx
   :lines: 78-190
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechBuildPreflightDialog

**What this does.** The dialog component — the function that draws the pop-up. It shows a title that reads differently for one test versus many, a short body sentence, then a list where each test's name is a link-styled button that navigates to it; where leaving a test out would cost a whole section, an amber note names that consequence. The footer carries three buttons: Cancel, "Build without them", and the default "Subdivide & build". On opening it puts keyboard focus on the default action.

**Why it is here.** Focus lands on the default action rather than on Cancel because — as the header explains — nothing here is irreversible, so the usual "focus Cancel" rule for destructive dialogs does not apply, and the action the engineer wants nine times in ten should be one keypress away. It uses ``useRef`` (a handle to the real button) and ``useEffect`` (code run after the screen is drawn) to place that focus. Each name is a real ``<button>`` so it is reachable by click, Enter or Space, honouring the ask for one-click access; the amber drop note is shown only where a section would actually be lost, so the warning never cries wolf.

.. CG-EXPLANATION-END id=function:GeotechBuildPreflightDialog

