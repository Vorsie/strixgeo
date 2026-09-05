desktop.renderer.src.components.sections.cptChannels
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/cptChannels.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/cptChannels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and describes the layout it governs. It holds the CPT data-channel toggles and the zoom-responsive band geometry for the cross-section. Each CPT (Cone Penetration Test, a sounding) renders into one shared horizontal band centred on its column axis: qc (cone resistance) reads right of the axis, Rf (friction ratio) is mirrored to the left, and fs and u2 overlay with their own scales when enabled.

**Why it is here.** The comment records the DOV lengteprofiel PDF page 3 as the visual reference, and that the band width scales with the horizontal zoom so the curves stay readable across the zoom range; the width-aware column nudge consumes the band width so adjacent CPTs respect each other's footprints.

.. CG-EXPLANATION-END id=module-header

``interface CptChannels``
-------------------------

.. CG-BLOCK id=interface:CptChannels lines=16-31

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 16-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptChannels

**What this does.** Describes the five on/off toggles for which CPT curves show — qc, Rf, fs (sleeve friction), u2 (pore-water pressure), and q_total (a CPTM cone's total resistance).

**Why it is here.** The comments record that fs and u2 are off by default as specialist tracks the DOV PDF does not show, and q_total overlays the qc track as a dashed line on a CPTM cone.

.. CG-EXPLANATION-END id=interface:CptChannels

``const DEFAULT_CPT_CHANNELS``
------------------------------

.. CG-BLOCK id=const:DEFAULT_CPT_CHANNELS lines=32-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 32-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_CPT_CHANNELS

**What this does.** The default toggle set — qc, Rf and q_total on; fs and u2 off.

**Why it is here.** It matches the DOV reading convention the whole panel imitates.

.. CG-EXPLANATION-END id=const:DEFAULT_CPT_CHANNELS

``const QC_FULL_SCALE_MPA``
---------------------------

.. CG-BLOCK id=const:QC_FULL_SCALE_MPA lines=55-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 55-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_FULL_SCALE_MPA

**What this does.** The default qc full scale, 40 MPa (megapascals).

**Why it is here.** The comment records this as the DOV convention, read rightward from the axis.

.. CG-EXPLANATION-END id=const:QC_FULL_SCALE_MPA

``const RF_FULL_SCALE_PCT``
---------------------------

.. CG-BLOCK id=const:RF_FULL_SCALE_PCT lines=56-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 56-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_FULL_SCALE_PCT

**What this does.** The Rf full scale, 10 percent.

**Why it is here.** The comment records this as the DOV convention, read leftward from the axis and mirrored.

.. CG-EXPLANATION-END id=const:RF_FULL_SCALE_PCT

``const QC_FULL_SCALE_STEPS_MPA``
---------------------------------

.. CG-BLOCK id=const:QC_FULL_SCALE_STEPS_MPA lines=61-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 61-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_FULL_SCALE_STEPS_MPA

**What this does.** The list of stepped upper bounds for the section-wide qc scale — 40, 60, 80, 100, 150, 200 MPa.

**Why it is here.** The comment records that the smallest step no CPT exceeds wins, and above 200 the scale keeps stepping up by 50.

.. CG-EXPLANATION-END id=const:QC_FULL_SCALE_STEPS_MPA

``const QC_CONSECUTIVE_THRESHOLD``
----------------------------------

.. CG-BLOCK id=const:QC_CONSECUTIVE_THRESHOLD lines=68-74

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 68-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_CONSECUTIVE_THRESHOLD

**What this does.** The run length, 20 consecutive samples, that counts as a real layer rather than a transient spike.

**Why it is here.** The comment records that at a typical 2 cm sampling interval, 20 samples is about 40 cm — enough to mean a real layer — and that this is the user-visible trade-off knob for how easily a hard band bumps the scale.

.. CG-EXPLANATION-END id=const:QC_CONSECUTIVE_THRESHOLD

``function longestConsecutiveAboveMpa``
---------------------------------------

.. CG-BLOCK id=function:longestConsecutiveAboveMpa lines=75-105

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 75-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:longestConsecutiveAboveMpa

**What this does.** Returns the longest run of consecutive qc samples strictly above a threshold in one CPT's series, with null or non-finite samples breaking the run.

**Why it is here.** The docstring records that gaps break the run so a series with holes cannot fake a long high-qc layer.

.. CG-EXPLANATION-END id=function:longestConsecutiveAboveMpa

``function pickQcFullScaleMpa``
-------------------------------

.. CG-BLOCK id=function:pickQcFullScaleMpa lines=106-156

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 106-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickQcFullScaleMpa

**What this does.** Chooses the section-wide qc full scale: it walks the step list and returns the smallest step for which no CPT has a run of the threshold length above that step's trigger, where the trigger is the midpoint between the step and the next one up.

**Why it is here.** The docstring records the per-CPT check honours one real thick high-qc layer even when the rest of the section is soft, and the comment records the midpoint trigger prevents over-stepping — a run at 41 to 45 MPa should not push the scale to 60 when the data clearly fits 40 (dogfeed 2026-05-31: 'barely values above 30, why is it 60?').

.. CG-EXPLANATION-END id=function:pickQcFullScaleMpa

``function cptBandHalfWidth``
-----------------------------

.. CG-BLOCK id=function:cptBandHalfWidth lines=157-172

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 157-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptBandHalfWidth

**What this does.** Returns the CPT band's half-width in pixels at the current horizontal zoom, with a floor and a cap on the scaling factor.

**Why it is here.** The docstring records the floor keeps columns legible when zoomed out and the cap prevents runaway widths when zoomed in; the comment records the earlier 3.0x cap was hit too early and locked the wheel-zoom guard sooner than the user wanted (dogfeed 2026-05-31).

.. CG-EXPLANATION-END id=function:cptBandHalfWidth

``function cptBandFullWidth``
-----------------------------

.. CG-BLOCK id=function:cptBandFullWidth lines=173-208

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 173-208
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptBandFullWidth

**What this does.** Returns the full band pixel width for a given CPT kind and channel selection, or 0 when no applicable channel is enabled (for example only u2 on but the cone is not a CPTU).

**Why it is here.** The docstring records the nudge layout consumes this width so adjacent CPTs respect each other's data footprints, and the band is the same size regardless of which channels sit inside it.

.. CG-EXPLANATION-END id=function:cptBandFullWidth

``const COLUMN_SPACING_MIN``
----------------------------

.. CG-BLOCK id=const:COLUMN_SPACING_MIN lines=209-209

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 209-209
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_SPACING_MIN

**What this does.** The minimum column-spacing multiplier, 0.0.

**Why it is here.** The comment records that at 0 the nudge layout treats every column as zero-width so adjacent tests render at their true projected position with overlapping bands.

.. CG-EXPLANATION-END id=const:COLUMN_SPACING_MIN

``const COLUMN_SPACING_MAX``
----------------------------

.. CG-BLOCK id=const:COLUMN_SPACING_MAX lines=210-210

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 210-210
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_SPACING_MAX

**What this does.** The maximum column-spacing multiplier, 1.0.

**Why it is here.** The comment records that at 1 the nudge sees the full width and adjacent columns sit edge-to-edge with the standard gap.

.. CG-EXPLANATION-END id=const:COLUMN_SPACING_MAX

``const COLUMN_SPACING_DEFAULT``
--------------------------------

.. CG-BLOCK id=const:COLUMN_SPACING_DEFAULT lines=211-212

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 211-212
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_SPACING_DEFAULT

**What this does.** The default column-spacing multiplier, 1.0.

**Why it is here.** It is the current default, edge-to-edge behaviour.

.. CG-EXPLANATION-END id=const:COLUMN_SPACING_DEFAULT

``function readColumnSpacing``
------------------------------

.. CG-BLOCK id=function:readColumnSpacing lines=213-241

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 213-241
   :lineno-match:

.. CG-EXPLANATION-START id=function:readColumnSpacing

**What this does.** Reads the column-spacing value out of a section's stored view-state, clamped to the allowed range, returning the default when it is absent or not a valid number.

**Why it is here.** The comment records it lives in the section's view-state so the choice rides in the project bundle and survives reopening on another machine; the read is guarded so a hand-edited bundle cannot break it.

.. CG-EXPLANATION-END id=function:readColumnSpacing

``interface BoreholeChannels``
------------------------------

.. CG-BLOCK id=interface:BoreholeChannels lines=242-260

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 242-260
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeChannels

**What this does.** Describes the borehole observation-stream toggles — geotechnical coding, formal stratigraphy, and informal stratigraphy.

**Why it is here.** The comments record that DOV records up to five streams per borehole but the section exposes the three engineers most often cross-reference, and that some earlier toggles were dropped because the detail panel already surfaces those streams.

.. CG-EXPLANATION-END id=interface:BoreholeChannels

``const DEFAULT_BOREHOLE_CHANNELS``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_BOREHOLE_CHANNELS lines=261-269

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 261-269
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_BOREHOLE_CHANNELS

**What this does.** The default borehole toggle set — geotechnical coding on, the two stratigraphy streams off.

**Why it is here.** The comment records engineers reach for geotechnical coding first when building a ground model, because it is the engineering-relevant ISO 14688 stream.

.. CG-EXPLANATION-END id=const:DEFAULT_BOREHOLE_CHANNELS

``const BOREHOLE_CHANNEL_OBSERVATION_TYPES``
--------------------------------------------

.. CG-BLOCK id=const:BOREHOLE_CHANNEL_OBSERVATION_TYPES lines=270-277

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 270-277
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOREHOLE_CHANNEL_OBSERVATION_TYPES

**What this does.** Maps each borehole channel key to the DOV observation-type string the backend ships, in display order.

**Why it is here.** The comment records the iteration order is the display order in the band: geotech, then formal, then informal.

.. CG-EXPLANATION-END id=const:BOREHOLE_CHANNEL_OBSERVATION_TYPES

``function readBoreholeChannels``
---------------------------------

.. CG-BLOCK id=function:readBoreholeChannels lines=278-298

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 278-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:readBoreholeChannels

**What this does.** Reads the borehole channel toggles out of the stored view-state, falling back per key to the default when a value is missing or not a boolean.

**Why it is here.** It is the parse-guarded read of a persisted preference, so a corrupt or hand-edited value cannot throw.

.. CG-EXPLANATION-END id=function:readBoreholeChannels

``function enabledBoreholeChannelCount``
----------------------------------------

.. CG-BLOCK id=function:enabledBoreholeChannelCount lines=299-322

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 299-322
   :lineno-match:

.. CG-EXPLANATION-START id=function:enabledBoreholeChannelCount

**What this does.** Counts how many borehole channels are enabled.

**Why it is here.** The comment records the width-aware nudge layout uses the count to work out how many strip-widths a borehole column occupies, so adjacent columns get pushed apart proportionally.

.. CG-EXPLANATION-END id=function:enabledBoreholeChannelCount

``const SNAP_TOLERANCE_PX``
---------------------------

.. CG-BLOCK id=const:SNAP_TOLERANCE_PX lines=323-324

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 323-324
   :lineno-match:

.. CG-EXPLANATION-START id=const:SNAP_TOLERANCE_PX

**What this does.** The snap tolerance, 8 pixels, for click-to-place sticky boundaries.

**Why it is here.** The comment records it lets engineers snap a dropped contact to a known geological break without zooming to pixel precision.

.. CG-EXPLANATION-END id=const:SNAP_TOLERANCE_PX

``function readSnapToStratigraphy``
-----------------------------------

.. CG-BLOCK id=function:readSnapToStratigraphy lines=325-336

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 325-336
   :lineno-match:

.. CG-EXPLANATION-START id=function:readSnapToStratigraphy

**What this does.** Reads the snap-to-stratigraphy toggle out of the stored view-state, defaulting to off.

**Why it is here.** The comment records it is a persisted preference and that free placement is the default, for engineers who want the raw click depth.

.. CG-EXPLANATION-END id=function:readSnapToStratigraphy

``function readCptChannels``
----------------------------

.. CG-BLOCK id=function:readCptChannels lines=337-355

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptChannels.ts
   :language: typescript
   :lines: 337-355
   :lineno-match:

.. CG-EXPLANATION-START id=function:readCptChannels

**What this does.** Reads the CPT channel toggles out of the stored view-state, falling back per key to the documented default when a value is missing or not a boolean.

**Why it is here.** The docstring records that out-of-range or missing values fall back so a hand-edited bundle cannot render an invisible or saturated panel.

.. CG-EXPLANATION-END id=function:readCptChannels

