desktop.renderer.src.sheet.sheetPayload
=======================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/sheetPayload.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/sheetPayload.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment and two imports. The comment explains this file declares the exact shape of the data handed to the sheet: it is assembled on the Sections stage, posted into the preview iframe, and relayed by the main process into the hidden print window; it is plain JSON with no functions or class instances so it survives being passed between pages and processes unchanged; and the geometry stays in the screen's frame — regions are fraction-and-elevation polygons per gap and columns carry their true distance along the section, with the on-paper position resolved only at draw time so moving the spacing slider never recomputes a fill. The imports bring in the borehole-detail and CPT-plot response types and the region type.

**Why it is here.** This is the *wire contract* — the agreed shape of the message that travels from the section editor to the drawing. *JSON* is a plain text-and-numbers data format that can be sent between web pages (by ``postMessage``) and to the main program (by IPC) without loss. Keeping the payload plain and keeping the geometry in fractions is what lets the same message drive both the live preview and the printed PDF, and lets the sliders re-lay the drawing without any new calculation of the fill.

.. CG-EXPLANATION-END id=module-header

``type SheetFill``
------------------

.. CG-BLOCK id=type:SheetFill lines=16-16

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 16-16
   :lineno-match:

.. CG-EXPLANATION-START id=type:SheetFill

**What this does.** Declares that the fill axis is one of exactly two words: ``litho`` or ``geotech``.

**Why it is here.** A *type* here restricts a value to a fixed set of choices. The sheet can print either the lithological model fill or the geotechnical model fill (never the 3-D model fill), so this pins the choice to those two.

.. CG-EXPLANATION-END id=type:SheetFill

``type SheetScaleMode``
-----------------------

.. CG-BLOCK id=type:SheetScaleMode lines=17-18

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 17-18
   :lineno-match:

.. CG-EXPLANATION-START id=type:SheetScaleMode

**What this does.** Declares that the scale mode is one of exactly two words: ``fit`` or ``explicit``.

**Why it is here.** The two scale modes the owner kept: fit (the sheet sizes itself to the profile) or explicit (the engineer types the scales). Pinning it to these two words means a typo can never slip through.

.. CG-EXPLANATION-END id=type:SheetScaleMode

``interface SheetField``
------------------------

.. CG-BLOCK id=interface:SheetField lines=19-23

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 19-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetField

**What this does.** Declares one title-block field as a label and a value, both text.

**Why it is here.** An *interface* is a named description of the fields a value must carry. Each of the four title-block entries is a label the engineer can rename and the text he types under it.

.. CG-EXPLANATION-END id=interface:SheetField

``interface SheetSettings``
---------------------------

.. CG-BLOCK id=interface:SheetSettings lines=24-35

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 24-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetSettings

**What this does.** Declares everything the engineer can adjust for the sheet: the fill axis, the scale mode, the two explicit-scale denominators (only read in explicit mode), the vertical exaggeration, the column spacing (0 packed to 1 true distance), and the four title fields.

**Why it is here.** This is the block of choices the preview dialog exposes and that is saved with the section, so a sheet reopens exactly as the engineer last set it. It is the shape stored under ``view_state.pdf_sheet`` and carried in the ``.strix`` project file.

.. CG-EXPLANATION-END id=interface:SheetSettings

``interface SheetColumn``
-------------------------

.. CG-BLOCK id=interface:SheetColumn lines=36-52

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 36-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetColumn

**What this does.** Declares everything the drawing needs about one investigation on the profile: its id, whether it is a CPT or a borehole, its name and short code, its project key and colour slot, its distance along the section, its collar elevation and total depth, and either the CPT plot data or the borehole detail (whichever applies).

**Why it is here.** One column on the sheet is one investigation; this carries exactly what the profile needs to draw its hairline, its trace or log, and its code. Elevation and depth travel as real ground metres so the drawing can place everything at absolute level.

.. CG-EXPLANATION-END id=interface:SheetColumn

``interface SheetUnit``
-----------------------

.. CG-BLOCK id=interface:SheetUnit lines=53-74

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 53-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetUnit

**What this does.** Declares one legend unit: its formation id, name, stored colour and display order, and — only on the geotech axis — its NAD packing class and any colour the engineer picked to override the ramp. The comments explain that on the litho and geological axes the stored colour is what the region is drawn in, but on the geotech axis the stored colour is only the litho hue the geotech row inherited, so the packing class decides the real fill colour and label.

**Why it is here.** The sheet colours and labels a unit differently depending on the axis, and this shape carries the extra packing-class facts the geotech axis needs. It records the owner's finding that painting geotech units with their inherited litho colour made every packing class of one lithology look identical; the NAD class fields are what let the print show the packing colours instead. NAD packing class (1..31) is a characterisation output, per the published Belgian annex NBN EN 1997-1 ANB Tabel 2.1, not a design parameter.

.. CG-EXPLANATION-END id=interface:SheetUnit

``interface SheetMapPoint``
---------------------------

.. CG-BLOCK id=interface:SheetMapPoint lines=75-84

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 75-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetMapPoint

**What this does.** Declares one dot on the location map: the investigation's id, whether it is a CPT or borehole, its short code, its colour slot, its world position (east, north), and whether it lies on the profile.

**Why it is here.** The map shows every investigation in the framed area, not just those on the section line; this carries what each dot needs, and the on-profile flag is what makes off-profile dots print half-faded.

.. CG-EXPLANATION-END id=interface:SheetMapPoint

``interface SheetProjectLegendRow``
-----------------------------------

.. CG-BLOCK id=interface:SheetProjectLegendRow lines=85-91

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 85-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetProjectLegendRow

**What this does.** Declares one row of the project legend: the project key, its colour slot, and its investigation codes in order (on-profile first, then map order).

**Why it is here.** The legend under the map lists one row per project with its colour and its codes; this is the pre-built shape of one such row, so the drawing just prints it.

.. CG-EXPLANATION-END id=interface:SheetProjectLegendRow

``interface SheetPayload``
--------------------------

.. CG-BLOCK id=interface:SheetPayload lines=92-120

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 92-120
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetPayload

**What this does.** Declares the whole message: the language, the section (id, name, coordinate system, length, the two endpoints and the section's view state), the columns, the fraction-polygon regions, the units, the highest and lowest level to draw (already padded), the map block (basemap id, points and legend), and the settings.

**Why it is here.** This is the single object that carries everything the sheet needs and nothing it does not, assembled once on the Sections stage. Because it holds the padded levels, the fraction regions and the true column distances, the drawing can size and lay itself out with no further data fetching, which is what makes preview and print identical.

.. CG-EXPLANATION-END id=interface:SheetPayload

``interface SheetReadyMessage``
-------------------------------

.. CG-BLOCK id=interface:SheetReadyMessage lines=121-128

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 121-128
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetReadyMessage

**What this does.** Declares the message the sheet sends back once it has laid itself out: a type tag, the final paper width and height, and whether the basemap ended up offline.

**Why it is here.** The print pipeline must wait for the page to finish before it captures the PDF, and it needs the true paper size to set the page dimensions; this is the reply that carries both, plus whether the offline caption was shown.

.. CG-EXPLANATION-END id=interface:SheetReadyMessage

``interface SheetPayloadMessage``
---------------------------------

.. CG-BLOCK id=interface:SheetPayloadMessage lines=129-132

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetPayload.ts
   :language: typescript
   :lines: 129-132
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetPayloadMessage

**What this does.** Declares the envelope that carries a payload to the sheet: a type tag reading ``sheet:payload`` and the payload itself.

**Why it is here.** The sheet page can receive stray messages, so the payload travels inside a tagged envelope the page can recognise and trust before it draws.

.. CG-EXPLANATION-END id=interface:SheetPayloadMessage

