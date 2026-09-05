desktop.renderer.src.sheet.SectionSheet
=======================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/SectionSheet.tsx complete=false

*Source file:* ``desktop/src/renderer/src/sheet/SectionSheet.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SectionSheet.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment and the import lines for the whole-sheet component. The comment says this file lays out the entire sheet at its paper size and that the ``map`` is passed in as a slot so tests can render the sheet without the real map library. The imports bring in the translation helper (which turns a text key into English or Dutch), the profile drawing, the project-colour helpers, the paper dimensions, the geometry calculator, the payload type, the title block, and the unit-legend builder.

**Why it is here.** A *component* is a reusable piece of on-screen layout. This file is the top-level piece that arranges every other part of the sheet. Passing the map in as a slot (rather than building it here) lets the automated tests check the layout without loading the Leaflet map library, which needs a real browser; the design note calls the map ``a slot so tests render without Leaflet``.

.. CG-EXPLANATION-END id=module-header

``function sheetGeometryOf``
----------------------------

.. CG-BLOCK id=function:sheetGeometryOf lines=16-24

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SectionSheet.tsx
   :language: tsx
   :lines: 16-24
   :lineno-match:

.. CG-EXPLANATION-START id=function:sheetGeometryOf

**What this does.** A short helper that reads the paper settings out of the payload (scale mode, the two explicit scale denominators, the vertical exaggeration, the column spacing) and the section's elevation range and columns, and hands them to ``computeSheetGeometry`` to get back all the paper measurements.

**Why it is here.** It is the single place that maps the incoming payload onto the geometry calculator, so both this component and the sheet's entry page compute the same paper size and column positions from the same inputs. Keeping it here avoids two slightly different copies of that wiring.

.. CG-EXPLANATION-END id=function:sheetGeometryOf

``function distanceKey``
------------------------

.. CG-BLOCK id=function:distanceKey lines=25-30

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SectionSheet.tsx
   :language: tsx
   :lines: 25-30
   :lineno-match:

.. CG-EXPLANATION-START id=function:distanceKey

**What this does.** Turns the column-spacing value (a number from 0 to 1) into the text key for the distance caption. A spacing of essentially 1 means true distance, essentially 0 means packed, and anything in between means ``in between``.

**Why it is here.** The bottom-left of the sheet prints how the columns are spaced, in the app's own words (Dutch ``werkelijke afstand`` / ``gepakt`` / ``tussenin``, English true / packed / in between). This helper picks the right wording from the same slider value the preview dialog exposes, so the printed caption always matches what the engineer set.

.. CG-EXPLANATION-END id=function:distanceKey

``function SectionSheet``
-------------------------

.. CG-BLOCK id=function:SectionSheet lines=31-80

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SectionSheet.tsx
   :language: tsx
   :lines: 31-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionSheet

**What this does.** The component that assembles the whole page. It computes the geometry, builds the unit-legend rows, and returns a single fixed-size box whose width and height are set in millimetres (the paper size). Inside it places, by absolute position: a thin trim frame just inside the margin; the profile drawing on the left; the wrapping unit legend (colour swatch plus unit name) under the profile; and on the right a fixed-width column holding the map box at the top, the project legend flush beneath it (one row per project: a coloured dot, the project name in bold, then its codes), the four-field title block near the bottom, and the printed scale line (``H 1:N   V 1:N   exaggeration N×``) at the very bottom. The bottom-left corner prints the ``StrixGeo`` brand name and the distance caption.

**Why it is here.** This layout follows the owner's ruling to imitate the DOV ``lengteprofiel`` (length-profile) drawing sheet: the map on the right at the same width as the title box beneath it, the legend flush under the map, four blank title fields, A - A′, and the printed scales. Everything is positioned in millimetres so the on-screen preview and the printed PDF are byte-for-byte the same layout. Text goes through the translation helper so the sheet prints in the app's current language; the one exception, marked in a comment, is the ``StrixGeo`` brand name, which is never translated.

.. CG-EXPLANATION-END id=function:SectionSheet

