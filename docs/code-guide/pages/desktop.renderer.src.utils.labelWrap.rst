desktop.renderer.src.utils.labelWrap
====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/labelWrap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/labelWrap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labelWrap.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. It describes a helper that breaks a label into several lines so the text fits inside a narrow column drawn on the map or section canvas — the faint "ghost" columns in the section view, the CPT chart's depth column, and the borehole-log rail. An overlay here means a drawing layer painted on top of the canvas; SVG is the vector-drawing format those layers use.

**Why it is here.** The comment records that all three overlay surfaces face the same narrow-column problem, so the wrapping was written once and shared. It also records a deliberate performance choice: the helper counts characters rather than measuring real drawn text width, because measuring SVG text on every redraw is expensive; the result is "approximately right", which is fine for a faint informational overlay.

.. CG-EXPLANATION-END id=module-header

``function wrapLabelToLines``
-----------------------------

.. CG-BLOCK id=function:wrapLabelToLines lines=34-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labelWrap.ts
   :language: typescript
   :lines: 34-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:wrapLabelToLines

**What this does.** A pure function — its output depends only on its inputs — that wraps a label into at most ``maxLines`` lines of about ``maxCharsPerLine`` characters each. Step one splits the text on spaces and pre-cuts any single word too long to fit a line. Step two greedily packs words onto lines until the next word would not fit. Step three: if that natural wrap already fits within the line cap it is returned as-is; otherwise it keeps the first lines untouched and fills the final line with as much of the remainder as fits, ending in an ellipsis.

**Why it is here.** The docstring records the three-step algorithm and the reason overflow is handled last: by knowing the full remainder before trimming, the last line can show "e Aquif…" instead of a bare "e…", which tells the reader more of the hidden word.

.. CG-EXPLANATION-END id=function:wrapLabelToLines

``function maxLinesForHeight``
------------------------------

.. CG-BLOCK id=function:maxLinesForHeight lines=109-127

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labelWrap.ts
   :language: typescript
   :lines: 109-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:maxLinesForHeight

**What this does.** Works out how many lines of a given font size fit inside a rectangle of a given height, after deducting a small top-and-bottom inset. Returns zero when the rectangle is too short for even one line.

**Why it is here.** The docstring records that returning zero lets the caller fall back to a tooltip-only display rather than drawing a clipped, half-visible label.

.. CG-EXPLANATION-END id=function:maxLinesForHeight

``function maxCharsForWidth``
-----------------------------

.. CG-BLOCK id=function:maxCharsForWidth lines=128-136

.. literalinclude:: ../../../desktop/src/renderer/src/utils/labelWrap.ts
   :language: typescript
   :lines: 128-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:maxCharsForWidth

**What this does.** Turns a column width and font size into a sensible characters-per-line budget, assuming roughly 0.55 of the font size in pixels per character; it never returns less than one.

**Why it is here.** The docstring records that the ratio is calibrated for a Helvetica-style sans-serif font, and that the minimum of one guards against extreme widths producing an empty wrap layout.

.. CG-EXPLANATION-END id=function:maxCharsForWidth

