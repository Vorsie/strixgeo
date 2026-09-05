desktop.renderer.src.shell.stages.shared.BodyViewModePills
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/BodyViewModePills.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/BodyViewModePills.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/BodyViewModePills.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. This file holds the little view-mode toggle buttons (the industry word is 'pills' — small rounded buttons that read as one cluster) that the Lithology and Geotechnical 3-D screens both show. It imports three drawing icons, the type that describes one fence wall, and the app's translation helper. React is the library that builds the screen out of small functions; a piece of screen built by one such function is a 'component'.

**Why it is here.** The comment records that this cluster was extracted once, during a code audit, because the button markup was byte-for-byte identical between the two 3-D screens except for three tiny things: the test ids, the tooltip wording, and one vertical offset. So those three became the only inputs the caller varies, and everything else is written once here. The comment also fixes where the cluster sits — bottom-left of the canvas, so it stays clear of the Layers legend at top-left and the basemap panel at top-right.

.. CG-EXPLANATION-END id=module-header

``interface BodyViewModePillsProps``
------------------------------------

.. CG-BLOCK id=interface:BodyViewModePillsProps lines=19-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/BodyViewModePills.tsx
   :language: tsx
   :lines: 19-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyViewModePillsProps

**What this does.** Describes the inputs the parent screen hands this component. In React the inputs a parent gives a component are called its 'props', and an 'interface' is just a written note of the exact shape those inputs must have. The fields are: a test-id prefix, a tooltip title, the current Solid-or-Fence sub-mode and the function that changes it, the wireframe on/off value and the function that flips it, a flag that is true while the correlation edges are still loading, the fence walls (used to decide when to show the empty hint), and the empty hint's test id, wording and vertical position.

**Why it is here.** Each field here is one of the small per-screen differences that stopped the two screens' markup from being truly identical, so the value is passed in rather than baked in. The component only reads and flips the mode and wireframe values; the parent screen actually remembers them (that remembered value is called 'state'), which is why each one arrives as a pair: the current value and the function that sets it.

.. CG-EXPLANATION-END id=interface:BodyViewModePillsProps

``function BodyViewModePills``
------------------------------

.. CG-BLOCK id=function:BodyViewModePills lines=56-160

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/BodyViewModePills.tsx
   :language: tsx
   :lines: 56-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:BodyViewModePills

**What this does.** The component itself — the function React calls to draw this cluster. It draws a small 'View' label, then a Solid / Fence button pair (each button highlights when it is the active mode and greys out while edges load), then — only when Solid mode is active — a Wireframe toggle button. Separately, only when Fence mode is active, the loading has finished, and no fence walls came out, it draws a small 'empty fence' hint that points the engineer at where correlations are authored. A fence diagram is the set of section walls stood up in 3-D; each button's click simply calls the setter it was handed.

**Why it is here.** The little 'View' label and the pressed-button styling are there so a first-time user reads this as a view switch, not an action button. The Wireframe toggle is hidden outside Solid mode because wireframe only applies to the filled body-solid render, which Fence mode never draws. The empty-fence hint exists so that when a model has no correlations yet the engineer sees a plain explanation instead of a blank screen that looks broken.

.. CG-EXPLANATION-END id=function:BodyViewModePills

