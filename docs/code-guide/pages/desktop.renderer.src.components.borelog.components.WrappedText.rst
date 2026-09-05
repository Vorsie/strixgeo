desktop.renderer.src.components.borelog.components.WrappedText
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/WrappedText.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/WrappedText.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/WrappedText.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one import and its documentation comment. It imports the ``truncate`` helper. The comment says this word-wraps a piece of SVG text inside a bounded rectangle: it splits on spaces, packs words greedily into lines that fit the width, stops once the next line would pass the height, and adds an ellipsis to the last line when words remain. It is used mainly for the stratigraphy column, where long formation descriptions need to wrap across several lines on tall layers and shrink to a single trimmed line on thin ones.

**Why it is here.** The comment records the core constraint: SVG has no way to measure text on the spot, so line widths are estimated from an average character width. Wrapping matters because a long formation name would otherwise overflow into the next column; the ellipsis tells the reader more text exists when it does not all fit.

.. CG-EXPLANATION-END id=module-header

``function WrappedText``
------------------------

.. CG-BLOCK id=function:WrappedText lines=21-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/WrappedText.tsx
   :language: tsx
   :lines: 21-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:WrappedText

**What this does.** The component. It estimates how many characters fit per line and how many lines fit in the height, then walks the words, packing each into the current line while it fits and starting a new line when it does not, hard-trimming any single word longer than a line. It stops at the line limit, adds an ellipsis to the last line if words were left over, computes a first-line position that centres the whole block vertically, and draws the lines as centred text rows.

**Why it is here.** Greedy packing with an ellipsis is a *pure function* of the text and the box — it depends only on its inputs — so it is safe to run on every redraw. Centre alignment and the ellipsis absorb the small error in the width estimate, which the comment notes is approximate but stable enough. Balancing the lines around the centre keeps a wrapped formation label visually centred in its layer.

.. CG-EXPLANATION-END id=function:WrappedText

