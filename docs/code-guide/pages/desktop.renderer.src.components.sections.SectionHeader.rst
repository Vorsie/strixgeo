desktop.renderer.src.components.sections.SectionHeader
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SectionHeader.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SectionHeader.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the cross-section header strip — the row carrying the section name, length, buffer slider, vertical-exaggeration slider, scale readout, reset, zoom buttons, and close. It imports React's hooks, a few icons, the section data type, translation, the section display-name helper, the spacing bounds, and the exaggeration bounds.

**Why it is here.** The docstring records two design points: the exaggeration slider is log-mapped so a linear thumb reaches both 5x and 50x, which geotech sections regularly want, without crowding the small values; and the buffer slider updates its displayed value immediately as the user drags but only fires the server-side patch on release, so the projected columns keep using the server-truth value until commit.

.. CG-EXPLANATION-END id=module-header

``const CHANNEL_BUTTONS``
-------------------------

.. CG-BLOCK id=const:CHANNEL_BUTTONS lines=35-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 35-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHANNEL_BUTTONS

**What this does.** The list of CPT data-channel toggle buttons — qc, Rf, fs, u2 and total-cone-resistance — each a channel key, a two-character label, and a tooltip key.

**Why it is here.** The comment: the order matches DOV's length-profile PDF reading order, primary tracks first, then specialist toggles.

.. CG-EXPLANATION-END id=const:CHANNEL_BUTTONS

``const BOREHOLE_CHANNEL_BUTTONS``
----------------------------------

.. CG-BLOCK id=const:BOREHOLE_CHANNEL_BUTTONS lines=53-65

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 53-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOREHOLE_CHANNEL_BUTTONS

**What this does.** The list of borehole interpretation-stream toggle buttons — geotechnical coding, formal stratigraphy, informal stratigraphy.

**Why it is here.** The comment: ordered by DOV's length-profile display order, with geotech the default-on stream; drill-method and field-log are intentional gaps needing a different column render and arriving in a later pass.

.. CG-EXPLANATION-END id=const:BOREHOLE_CHANNEL_BUTTONS

``const BUFFER_MIN``
--------------------

.. CG-BLOCK id=const:BUFFER_MIN lines=66-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 66-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:BUFFER_MIN

**What this does.** The smallest projection-buffer value the slider allows, 5 m.

**Why it is here.** The comment: 5 m is the tightest engineers typically use, for closely-spaced corridor surveys.

.. CG-EXPLANATION-END id=const:BUFFER_MIN

``const BUFFER_MAX``
--------------------

.. CG-BLOCK id=const:BUFFER_MAX lines=67-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 67-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:BUFFER_MAX

**What this does.** The largest projection-buffer value the slider allows, 500 m.

**Why it is here.** The comment: 500 m covers regional or preliminary sections through sparse boreholes.

.. CG-EXPLANATION-END id=const:BUFFER_MAX

``function SectionHeader``
--------------------------

.. CG-BLOCK id=function:SectionHeader lines=69-414

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionHeader.tsx
   :language: tsx
   :lines: 69-414
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionHeader

**What this does.** The component. It converts the exaggeration value to and from the log-mapped slider position, keeps a local buffer value that follows the section prop but updates live as the user drags, and renders the whole strip: the section name and length-and-buffer caption (with an optional lens-companion badge), the buffer slider (committing on release), the CPT channel toggle buttons, the borehole stream toggle buttons, the snap-to-stratigraphy toggle, the column-spacing slider, the exaggeration slider, the scale readout, the zoom buttons, a reset button, and a close button.

**Why it is here.** The comments record the reasons: every slider persists to the section's saved view state so the framing survives reopens and file round-trips, but the local-then-commit pattern keeps dragging smooth while only writing on release; the row wraps rather than clipping the close button in narrow windows; the domain accent hues are fixed colour that keep explicit dark-mode overrides; the vertical scale carries a test id because a drag test needs the exact metres-to-pixels value the renderer used rather than measuring it off the drawing; and the old 'Seed' and 'DXF' buttons were removed as duplicates of the toolbar verbs, with Reset kept because it acts on view state, not the model.

.. CG-EXPLANATION-END id=function:SectionHeader

