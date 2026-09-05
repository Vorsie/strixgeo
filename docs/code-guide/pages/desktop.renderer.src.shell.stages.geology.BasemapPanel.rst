desktop.renderer.src.shell.stages.geology.BasemapPanel
======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/BasemapPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/BasemapPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/BasemapPanel.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file — a small basemap picker panel for the geology 3-D viewer — and pulls in its tools: Cesium (the 3-D globe library), React's hook functions for remembering values, the list of available basemaps plus the helpers that read and write the chosen basemap id, and the translator that turns text keys into the active-language wording.

**Why it is here.** React is the library that builds the screen from small functions; a component is one such function that returns a piece of screen. This panel was split out of the 3-D viewer during the god-component decomposition round (debt #201) so the viewer file stays small. It deliberately mirrors the 2-D map's basemap selector so switching between the 2-D and 3-D views does not change the look of the control.

.. CG-EXPLANATION-END id=module-header

``interface BasemapPanelProps``
-------------------------------

.. CG-BLOCK id=interface:BasemapPanelProps lines=14-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/BasemapPanel.tsx
   :language: tsx
   :lines: 14-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapPanelProps

**What this does.** Declares the inputs (the props) the panel expects from its parent: the id of the basemap currently in use, and a function to call when the user picks a different one.

**Why it is here.** Props are the inputs a parent hands a component. The panel holds no basemap data of its own — the parent (the 3-D viewer) owns which basemap is active, passes it in, and receives the new choice back through the callback.

.. CG-EXPLANATION-END id=interface:BasemapPanelProps

``function BasemapPanel``
-------------------------

.. CG-BLOCK id=function:BasemapPanel lines=38-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/BasemapPanel.tsx
   :language: tsx
   :lines: 38-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:BasemapPanel

**What this does.** The panel itself. It draws a small button in the top-right corner showing the active basemap's label; clicking it opens or closes a dropdown that lists every available basemap; clicking one calls the parent's ``onSelect`` and closes the menu. The only thing it remembers is whether the menu is open (a piece of state, via ``useState``).

**Why it is here.** State is a value a component remembers between redraws. Whether the dropdown is open is purely local screen chrome, so it lives here; which basemap is active belongs to the parent and is never stored in the panel. The look copies ``MapView``'s selector so the two- and three-dimensional views feel identical.

.. CG-EXPLANATION-END id=function:BasemapPanel

