desktop.renderer.src.components.borelog.constants
=================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment. It explains that this file holds the geometry and vocabulary constants for the borehole log — the pixel sizes and the observation-type name lists — lifted out of the main log component so every track sub-component can share the same values, and it draws a line between this file (where the numbers are named) and the utilities file (where the numbers are used).

**Why it is here.** Naming every magic number in one place is a project convention: module-level constants — sizes, lookup lists, name sets — belong in a dedicated constants file so the drawing helpers stay free of unexplained numbers and there is a single source of truth to change. Keeping them here rather than in the utilities file keeps the pure helpers uncluttered.

.. CG-EXPLANATION-END id=module-header

``const BASE_PX_PER_M``
-----------------------

.. CG-BLOCK id=const:BASE_PX_PER_M lines=18-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 18-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_PX_PER_M

**What this does.** The default depth scale: sixty pixels for every metre of depth.

**Why it is here.** This is the base of the shared mTAW-to-pixel rail introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page. The comment records that the log owns a zoom factor and broadcasts the effective scale to every track through a shared holder, so this is the value the zoom multiplies.

.. CG-EXPLANATION-END id=const:BASE_PX_PER_M

``const ZOOM_MIN``
------------------

.. CG-BLOCK id=const:ZOOM_MIN lines=20-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 20-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZOOM_MIN

**What this does.** The smallest zoom multiplier allowed: 0.4, so the depth scale can shrink to about two-fifths of the default.

**Why it is here.** A floor on zoom-out keeps the log from shrinking so far that it becomes unreadable; it pairs with the maximum below to bound the zoom range.

.. CG-EXPLANATION-END id=const:ZOOM_MIN

``const ZOOM_MAX``
------------------

.. CG-BLOCK id=const:ZOOM_MAX lines=21-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 21-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZOOM_MAX

**What this does.** The largest zoom multiplier allowed: 4.0, so the depth scale can grow to four times the default.

**Why it is here.** A ceiling on zoom-in keeps the log from magnifying past a useful size; it pairs with the minimum above to bound the zoom range.

.. CG-EXPLANATION-END id=const:ZOOM_MAX

``const ZOOM_STEP``
-------------------

.. CG-BLOCK id=const:ZOOM_STEP lines=22-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 22-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZOOM_STEP

**What this does.** The zoom multiplier per step: each zoom action multiplies or divides the scale by 1.25. The section comment that follows opens the block of per-track width constants.

**Why it is here.** A fixed ratio per step gives smooth, even zooming — each notch is the same proportional change — rather than jumps that feel uneven at different scales.

.. CG-EXPLANATION-END id=const:ZOOM_STEP

``const OBS_TRACK_WIDTH_LITHOLOGY``
-----------------------------------

.. CG-BLOCK id=const:OBS_TRACK_WIDTH_LITHOLOGY lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:OBS_TRACK_WIDTH_LITHOLOGY

**What this does.** The width of a lithology track: 150 pixels.

**Why it is here.** The comment records the reason: lithology tracks carry a lot of per-layer text — soil codes and admixtures — so they are given the wider column, unlike the narrower stratigraphy tracks below.

.. CG-EXPLANATION-END id=const:OBS_TRACK_WIDTH_LITHOLOGY

``const OBS_TRACK_WIDTH_STRATIGRAPHY``
--------------------------------------

.. CG-BLOCK id=const:OBS_TRACK_WIDTH_STRATIGRAPHY lines=38-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 38-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:OBS_TRACK_WIDTH_STRATIGRAPHY

**What this does.** The width of a stratigraphy track: 90 pixels.

**Why it is here.** The comment records the reason: stratigraphy tracks hold only short formation codes, so the full lithology width would be mostly empty; the narrower column keeps the log compact when several stratigraphy interpretations sit alongside the lithology stream.

.. CG-EXPLANATION-END id=const:OBS_TRACK_WIDTH_STRATIGRAPHY

``const HEADER_HEIGHT``
-----------------------

.. CG-BLOCK id=const:HEADER_HEIGHT lines=40-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 40-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:HEADER_HEIGHT

**What this does.** The height of each track's title block: 72 pixels.

**Why it is here.** The inline comment notes this height was sized for the track headers; it is the fixed band every track reserves at the top for its title.

.. CG-EXPLANATION-END id=const:HEADER_HEIGHT

``const M_TAW_AXIS_WIDTH``
--------------------------

.. CG-BLOCK id=const:M_TAW_AXIS_WIDTH lines=41-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 41-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:M_TAW_AXIS_WIDTH

**What this does.** The width of the absolute-level axis on the left of the log: 64 pixels.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header), so the axis component and the layout maths use the same value.

.. CG-EXPLANATION-END id=const:M_TAW_AXIS_WIDTH

``const DRILL_TRACK_WIDTH``
---------------------------

.. CG-BLOCK id=const:DRILL_TRACK_WIDTH lines=42-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 42-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRILL_TRACK_WIDTH

**What this does.** The width of the drill-method track: 90 pixels.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header), so the drill-method track and the layout maths agree on its width.

.. CG-EXPLANATION-END id=const:DRILL_TRACK_WIDTH

``const FIELD_LOG_SUB_WIDTH``
-----------------------------

.. CG-BLOCK id=const:FIELD_LOG_SUB_WIDTH lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:FIELD_LOG_SUB_WIDTH

**What this does.** The width of one sub-stripe inside the field-log track: 36 pixels.

**Why it is here.** The field-log track is three sub-stripes side by side, so this is the width of each one; it is named here so both the track and the total width below derive from the same number.

.. CG-EXPLANATION-END id=const:FIELD_LOG_SUB_WIDTH

``const FIELD_LOG_TRACK_WIDTH``
-------------------------------

.. CG-BLOCK id=const:FIELD_LOG_TRACK_WIDTH lines=44-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 44-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:FIELD_LOG_TRACK_WIDTH

**What this does.** The full width of the field-log track, computed as three sub-stripe widths.

**Why it is here.** The field-log track holds exactly three stripes — colour, moisture and consistency — so its total width is defined as three times the sub-stripe width, keeping the two in step automatically if the sub-width ever changes.

.. CG-EXPLANATION-END id=const:FIELD_LOG_TRACK_WIDTH

``const SAMPLES_TRACK_WIDTH``
-----------------------------

.. CG-BLOCK id=const:SAMPLES_TRACK_WIDTH lines=45-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 45-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLES_TRACK_WIDTH

**What this does.** The width of the samples track: 220 pixels.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header); the samples track is the widest because it carries the sample number and a row of lab-test glyphs side by side.

.. CG-EXPLANATION-END id=const:SAMPLES_TRACK_WIDTH

``const TRACK_GAP``
-------------------

.. CG-BLOCK id=const:TRACK_GAP lines=46-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 46-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRACK_GAP

**What this does.** The gap between adjacent tracks: 1 pixel.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header), so every track is spaced the same hair-thin gap apart.

.. CG-EXPLANATION-END id=const:TRACK_GAP

``const SVG_X_PAD``
-------------------

.. CG-BLOCK id=const:SVG_X_PAD lines=47-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 47-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:SVG_X_PAD

**What this does.** The horizontal padding around the drawing: 16 pixels.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header), so the content does not touch the left and right edges of the canvas.

.. CG-EXPLANATION-END id=const:SVG_X_PAD

``const SVG_Y_PAD``
-------------------

.. CG-BLOCK id=const:SVG_Y_PAD lines=48-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 48-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:SVG_Y_PAD

**What this does.** The vertical padding around the drawing: 8 pixels. The section comment that follows opens the block of observation-type name lists.

**Why it is here.** Named here as part of the single source of truth for the log's geometry (see the module header), so the content does not touch the top and bottom edges of the canvas.

.. CG-EXPLANATION-END id=const:SVG_Y_PAD

``const LITHOLOGY_TYPES``
-------------------------

.. CG-BLOCK id=const:LITHOLOGY_TYPES lines=57-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 57-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_TYPES

**What this does.** The set of observation-type names that count as lithology: coded lithology and geotechnical coding.

**Why it is here.** The comment records the reason for the distinction: lithology streams are drawn with soil patterns, whereas stratigraphy streams are plain labelled rectangles with no soil meaning — so the drawing code checks membership in this set to choose how to render a stream.

.. CG-EXPLANATION-END id=const:LITHOLOGY_TYPES

``const STRATIGRAPHY_TYPES``
----------------------------

.. CG-BLOCK id=const:STRATIGRAPHY_TYPES lines=62-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 62-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRATIGRAPHY_TYPES

**What this does.** The set of observation-type names that count as stratigraphy: the formal, informal, quaternary and hydrogeological stratigraphy flavours.

**Why it is here.** These streams hold only formation codes, so they are drawn as labelled rectangles; the comment notes that free-text lithological descriptions, which are in neither set, also fall through to a labelled rectangle.

.. CG-EXPLANATION-END id=const:STRATIGRAPHY_TYPES

``const OBSERVATION_TYPE_ORDER``
--------------------------------

.. CG-BLOCK id=const:OBSERVATION_TYPE_ORDER lines=76-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/constants.ts
   :language: typescript
   :lines: 76-85
   :lineno-match:

.. CG-EXPLANATION-START id=const:OBSERVATION_TYPE_ORDER

**What this does.** The fixed left-to-right order the observation streams are drawn in: coded lithology first, then geotechnical coding, then the text description, then the stratigraphy flavours.

**Why it is here.** The comment records the intended reading order: the driller's own record first, the engineer's reinterpretation next, then text descriptions, then the stratigraphy interpretations — so the log always reads in the same, sensible sequence.

.. CG-EXPLANATION-END id=const:OBSERVATION_TYPE_ORDER

