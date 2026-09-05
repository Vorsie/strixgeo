desktop.renderer.src.components.sections.MultiLineLabel
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/MultiLineLabel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/MultiLineLabel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/MultiLineLabel.tsx
   :language: tsx
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the top of a small file. A file (also called a module) is one unit of code the app loads; this one holds a single React component, which is a function that returns a piece of screen. The docstring names the component's job: draw a short text label, wrapped onto several lines, centred vertically inside a rectangle drawn on the cross-section.

**Why it is here.** The docstring says it was pulled out of two ghost-column overlays that each held a byte-for-byte copy of the same label-drawing code, so the copy now lives in one place. An overlay is one drawing layer stacked on top of another; a ghost column is the pale, semi-transparent stack of suggested layers drawn beside an investigation. Sharing the one copy is the project rule to extract a helper on the second duplicate.

.. CG-EXPLANATION-END id=module-header

``function MultiLineLabel``
---------------------------

.. CG-BLOCK id=function:MultiLineLabel lines=13-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/MultiLineLabel.tsx
   :language: tsx
   :lines: 13-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:MultiLineLabel

**What this does.** The component itself. It is given the wrapped lines of text, the horizontal centre, the rectangle's top and height, a font size, and a tooltip string. It works out where the first line's baseline sits so the whole block of lines ends up vertically centred in the rectangle, then returns an SVG text element with one tspan (a sub-line of text) per line and a title (the hover tooltip). SVG is Scalable Vector Graphics, the drawing language the section is painted in.

**Why it is here.** The docstring explains the two decisions. One tspan per line means the browser never has to measure text widths as it draws — the caller already decided the exact wrap using a character-budget rule and hands the finished lines in. The text is set to ignore the mouse (pointer-events none) so a click passes straight through to the coloured rectangle underneath, which owns all the interaction.

.. CG-EXPLANATION-END id=function:MultiLineLabel

``default default``
-------------------

.. CG-BLOCK id=default:default lines=54-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/MultiLineLabel.tsx
   :language: tsx
   :lines: 54-54
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Marks this component as the file's main export — the single thing other files get when they load this module.

**Why it is here.** A one-component file exposes that component as its default so callers import it by a name of their choosing without curly braces.

.. CG-EXPLANATION-END id=default:default

