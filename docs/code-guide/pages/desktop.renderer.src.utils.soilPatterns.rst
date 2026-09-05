desktop.renderer.src.utils.soilPatterns
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/soilPatterns.tsx complete=true

*Source file:* ``desktop/src/renderer/src/utils/soilPatterns.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilPatterns.tsx
   :language: tsx
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** SVG pattern definitions for DOV soil tokens, used by the borehole log to fill its observation-layer rectangles. SVG is a vector-drawing format, and a *pattern* is a small tile that repeats to fill a shape. The comment lists the tile per family: sands get a tan base with a dot grid (small dots fine, larger dots coarse), clays a blue-grey base with diagonal hatching, silts horizontal dashes, glauconite green V-chevrons, and so on. It imports React's element type and the solid-colour resolver from the colour table.

**Why it is here.** The comment records that the patterns mirror DOV's own PDF report convention (the international standards ISO 14689 / DIN 18196) so the engineer sees the familiar hatching, and that an unrecognised token falls back to a solid neutral fill because the borelog must always render something visible.

.. CG-EXPLANATION-END id=module-header

``function SoilPatterns``
-------------------------

.. CG-BLOCK id=function:SoilPatterns lines=33-156

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilPatterns.tsx
   :language: tsx
   :lines: 33-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:SoilPatterns

**What this does.** A *component* — a reusable piece of interface written as a function that returns what to draw. It returns an SVG ``<defs>`` fragment holding one ``<pattern>`` per soil token: each is a base-colour rectangle plus its marks (dots, hatch lines, plus signs, chevrons, brick lines, crescents) for fine sand, coarse sand, clay, silt, loam, lime/chalk, glauconite, sandstone, stones, generic sand, peat, stone fragments and shell fragments.

**Why it is here.** The docstring records the usage: it is rendered once at the top of the borelog SVG so every layer rectangle can then reference a pattern by id, and it returns a bare fragment rather than a wrapper so the caller can drop the patterns into its own ``<defs>`` beside its clip paths without nesting defs. A comment on the stones pattern records the same XZ-to-ST correction the colour table carries, from the authoritative DOV code table.

.. CG-EXPLANATION-END id=function:SoilPatterns

``function getSoilFillUrl``
---------------------------

.. CG-BLOCK id=function:getSoilFillUrl lines=157-167

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilPatterns.tsx
   :language: tsx
   :lines: 157-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:getSoilFillUrl

**What this does.** Turns a DOV token into the fill value an SVG rectangle needs — a ``url(#soil-XXX)`` reference when a matching pattern exists, otherwise the solid colour from ``soilStyle``.

**Why it is here.** The docstring records that callers can rely on it never returning nothing: every layer always gets a fill, and a token with no registered pattern falls through to its solid base hue so the rectangle is at least coloured.

.. CG-EXPLANATION-END id=function:getSoilFillUrl

``const KNOWN_PATTERN_CODES``
-----------------------------

.. CG-BLOCK id=const:KNOWN_PATTERN_CODES lines=168-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilPatterns.tsx
   :language: tsx
   :lines: 168-171
   :lineno-match:

.. CG-EXPLANATION-START id=const:KNOWN_PATTERN_CODES

**What this does.** The set of tokens that actually have a registered pattern above.

**Why it is here.** ``getSoilFillUrl`` checks this set so that a token with no pattern cleanly falls back to its solid colour instead of pointing at a pattern id that does not exist.

.. CG-EXPLANATION-END id=const:KNOWN_PATTERN_CODES

