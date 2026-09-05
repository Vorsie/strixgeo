desktop.renderer.src.components.sections.ColumnGlyph
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ColumnGlyph.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ColumnGlyph.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnGlyph.tsx
   :language: tsx
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for one investigation column's marker on the cross-section — a thin vertical stick with a cap, a name label, and a tie-back line when it had to be nudged sideways. The comment explains the shape rules, the clipping, the tie-back, and the three label detail levels; the imports pull in the label-mode type and the translation helper.

**Why it is here.** A circle cap for a CPT and a square cap for a borehole use the same shape vocabulary as the map markers, so a user reading the section interprets the icons the same way as on the map. The label detail levels follow industry logging conventions (the DOV three-row stack, the gINT/LeapFrog rotated id) so the section reads as engineers expect at any density.

.. CG-EXPLANATION-END id=module-header

``const CPT_COLOR``
-------------------

.. CG-BLOCK id=const:CPT_COLOR lines=35-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnGlyph.tsx
   :language: tsx
   :lines: 35-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:CPT_COLOR

**What this does.** A colour value for a CPT column, taken from a theme CSS variable rather than a fixed hex code.

**Why it is here.** It is a CSS variable so the colour can lift off the dark plot background in dark mode, where a hard-coded dark ink would be invisible; SVG attributes cannot use the usual dark-mode utility classes.

.. CG-EXPLANATION-END id=const:CPT_COLOR

``const BH_COLOR``
------------------

.. CG-BLOCK id=const:BH_COLOR lines=36-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnGlyph.tsx
   :language: tsx
   :lines: 36-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:BH_COLOR

**What this does.** The same theme colour value, used for a borehole column.

**Why it is here.** Same reason as ``CPT_COLOR`` above — a theme-aware colour that reads in both light and dark mode. CPT and borehole share the ink; the cap shape, not the colour, encodes the kind.

.. CG-EXPLANATION-END id=const:BH_COLOR

``const MISSING_ELEV_COLOR``
----------------------------

.. CG-BLOCK id=const:MISSING_ELEV_COLOR lines=37-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnGlyph.tsx
   :language: tsx
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:MISSING_ELEV_COLOR

**What this does.** A muted theme colour used when a column's surface elevation is unknown.

**Why it is here.** A column with no known elevation cannot be placed correctly on the vertical axis, so it is floated at zero in this muted tone to say 'this exists but we cannot position it' rather than silently dropping the row.

.. CG-EXPLANATION-END id=const:MISSING_ELEV_COLOR

``function ColumnGlyph``
------------------------

.. CG-BLOCK id=function:ColumnGlyph lines=40-295

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnGlyph.tsx
   :language: tsx
   :lines: 40-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:ColumnGlyph

**What this does.** The component that draws one column. It works out the surface Y (floating an unknown elevation at zero in the muted colour), the bottom of the stick from the drilled depth, clamps both into the visible area, and builds a small offset label. It then draws a transparent hit-box for clicks and right-clicks, a native tooltip, the tie-back tick and diagonal when the column was displaced, the stick, the cap (circle or square), and the name/elevation label in one of three detail modes.

**Why it is here.** Single-click is intentionally inert (only double-click opens detail) so an accidental pan-start never navigates away. The stick, cap, and tie-back are suppressed when a data band already shows where the test sits — the band is then the 'this is the test' visual and the stick would be redundant — while the name and elevation labels stay as the column's identifier. The rotated and no-label modes handle dense layouts the way gINT and LeapFrog logs do.

.. CG-EXPLANATION-END id=function:ColumnGlyph

