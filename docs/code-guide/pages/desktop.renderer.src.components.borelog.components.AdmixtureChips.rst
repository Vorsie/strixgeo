desktop.renderer.src.components.borelog.components.AdmixtureChips
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/AdmixtureChips.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/AdmixtureChips.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureChips.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's two imports: a React element type, and ``soilStyle``, the helper that turns a soil code into its display colour.

**Why it is here.** This is the first page of the borehole-log family, so it helps to picture the whole first. A borehole log is drawn as a set of vertical *tracks* — narrow side-by-side columns, each showing one kind of information (the drilling method, the field descriptions, the samples, and so on) down the depth of the hole. Every track is drawn with *SVG*, a vector-drawing format made of shapes like rectangles, lines and text placed at exact coordinates. The vertical position of everything is governed by one shared rail: a mapping from an elevation in metres above the Belgian datum (written mTAW) to a pixel position, so a point at true depth lands at the same height in every track. The strip of tick marks and elevation numbers that shows that rail is the *depth axis*. This particular file draws the small admixture chips that sit inside a lithology layer; ``soilStyle`` is a *colour lookup* — a helper that maps a raw soil token to a fixed colour — which is the app's translate-at-the-presentation-boundary rule in action: the engine stores the raw soil code, and the desktop owns the colour it is shown in.

.. CG-EXPLANATION-END id=module-header

``interface Admixture``
-----------------------

.. CG-BLOCK id=interface:Admixture lines=5-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureChips.tsx
   :language: tsx
   :lines: 5-25
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Admixture

**What this does.** Describes one admixture: its ``soil_code``, an ``amount`` word, and a ``locally`` flag. Below it, the documentation comment explains that the chips render as a small colour square, the amount and the code, packed left to right inside a maximum width, and that when too many chips do not fit the last ones are dropped and a ``+N`` counter is shown.

**Why it is here.** The comment records why truncation is safe: the hover text on the parent layer already lists every admixture in full, so trimming here only shortens the visible label, never hides information. It also notes that chip widths are estimated from an average character width because SVG cannot measure text on the spot, and the estimate is deliberately generous so the ``+N`` counter rarely misleads.

.. CG-EXPLANATION-END id=interface:Admixture

``function AdmixtureChips``
---------------------------

.. CG-BLOCK id=function:AdmixtureChips lines=26-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureChips.tsx
   :language: tsx
   :lines: 26-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:AdmixtureChips

**What this does.** The component. It walks the admixtures in order, building each chip's label (amount, code, and an optional "(loc.)") and estimating its width; it stops adding chips once the next one would overflow the available width, remembering how many it dropped. It then draws each chip — a small coloured square using the soil colour, with the label text beside it — laid left to right, and finally a small italic ``+N`` note if any were dropped.

**Why it is here.** The colour square is filled from ``soilStyle`` because that domain soil colour must stay exactly as the engineer expects, while the square's border and the label text use theme colour variables so they stay readable on the dark background — the comment marks this split explicitly. Stopping before overflow and showing ``+N`` keeps the chips inside their layer without ever drawing past its edge.

.. CG-EXPLANATION-END id=function:AdmixtureChips

