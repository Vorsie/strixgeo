desktop.renderer.src.components.borelog.utils
=============================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/utils.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/utils.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation comment and its imports. The comment says three groups live here: the layout function that decides where each track sits and how tall the canvas is; the pure helpers — string formatters and small maths; and the shared holder for the effective pixels-per-metre scale. It then imports React's context tools, the borehole and observation types, a track-id type, the translator type, and all the geometry constants from the sibling file.

**Why it is here.** This is the borehole log's shared geometry and helpers, kept in one file so every track works from the same layout and the same maths. The comment records the split from the constants file: the numbers are named there, and the logic that uses them lives here, which is the project convention that keeps helpers free of unexplained magic numbers.

.. CG-EXPLANATION-END id=module-header

``const PxPerMContext``
-----------------------

.. CG-BLOCK id=const:PxPerMContext lines=51-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 51-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:PxPerMContext

**What this does.** Creates the shared holder for the effective pixels-per-metre scale, starting at the default depth scale.

**Why it is here.** This is a *store* — a small shared holder that components subscribe to — built with React's context mechanism. The log component owns the current zoom scale and broadcasts it through this holder so every track reads the same value without it being passed by hand down through every component in between.

.. CG-EXPLANATION-END id=const:PxPerMContext

``function usePxPerM``
----------------------

.. CG-BLOCK id=function:usePxPerM lines=54-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 54-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePxPerM

**What this does.** A one-line hook that returns the current pixels-per-metre scale from the shared holder.

**Why it is here.** This is the read side of the store above: any track calls this hook to get the live scale, and React redraws that track whenever the scale changes. It is the ``usePxPerM`` used by every track page in this family to place its content at true depth.

.. CG-EXPLANATION-END id=function:usePxPerM

``interface ObservationTrackLayout``
------------------------------------

.. CG-BLOCK id=interface:ObservationTrackLayout lines=62-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 62-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ObservationTrackLayout

**What this does.** Describes the computed placement of one observation track: the observation itself, its left position, and its width.

**Why it is here.** The layout function produces one of these per visible stream so each track knows exactly where to draw without recomputing its own position — the single-source-of-truth idea for the log's geometry.

.. CG-EXPLANATION-END id=interface:ObservationTrackLayout

``interface Layout``
--------------------

.. CG-BLOCK id=interface:Layout lines=68-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 68-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Layout

**What this does.** Describes the full computed layout: the total width and height, the total depth, the canvas height, the left and right edges of the track band, the list of observation-track placements, and the left position of the drill-method, field-log and samples tracks (or nothing when that track is absent).

**Why it is here.** Bundling every position and dimension into one result means the log component computes the layout once and hands each track its slice, so the tracks never drift out of alignment. The left and right edges are called out for the groundwater line, which spans the whole band.

.. CG-EXPLANATION-END id=interface:Layout

``function widthForObservationType``
------------------------------------

.. CG-BLOCK id=function:widthForObservationType lines=87-117

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 87-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:widthForObservationType

**What this does.** A small pure function returning the width for a given observation type: the narrow width for stratigraphy, the wide width otherwise.

**Why it is here.** It centralises the per-type width choice recorded on the constants page — lithology needs room for admixture chips, stratigraphy holds only a short code — so both the layout and any caller agree on how wide each stream is.

.. CG-EXPLANATION-END id=function:widthForObservationType

``function computeLayout``
--------------------------

.. CG-BLOCK id=function:computeLayout lines=118-209

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 118-209
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeLayout

**What this does.** Walks a borehole's streams and produces the full layout. It selects the observations that have layers and are not hidden, sorts them into the fixed display order, finds the deepest extent across the header, all layers, drill segments and samples to size the canvas, then sweeps a left-to-right cursor: it reserves the absolute-level axis first, then each observation track, then the drill-method, field-log and samples tracks when present, recording each one's position. It returns all the positions and dimensions.

**Why it is here.** This is the single source of truth for horizontal positions and canvas size, called once per redraw at the top of the log so the per-track components never re-derive the layout and never fall out of sync. The comments record two deliberate choices: the total depth takes the deepest of everything so the canvas covers all drawn content, honouring the rule that the model reaches the deepest investigation; and the absolute-level axis is always reserved even when the elevation is missing, so the track headers still line up. Hidden tracks are excluded so no empty gap is left behind, and the hidden set defaults to empty so older callers that do not pass it still show every track — the additive, backward-compatible default.

.. CG-EXPLANATION-END id=function:computeLayout

``function humanizeObservationType``
------------------------------------

.. CG-BLOCK id=function:humanizeObservationType lines=210-234

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 210-234
   :lineno-match:

.. CG-EXPLANATION-START id=function:humanizeObservationType

**What this does.** Turns a raw observation-type token into a readable, translated label — for example the internal "formal_stratigraphy" becomes the translated "Formal stratigraphy" — and returns an unknown token unchanged.

**Why it is here.** This is the translate-at-the-presentation-boundary rule in action: the raw DOV token is never altered — the engine keeps it — and only the shown label is translated, so the track headers and legend read in plain language while the underlying data stays in the upstream vocabulary. Returning an unknown token verbatim means a new upstream value still shows something rather than a blank.

.. CG-EXPLANATION-END id=function:humanizeObservationType

``function truncate``
---------------------

.. CG-BLOCK id=function:truncate lines=235-242

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 235-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:truncate

**What this does.** Shortens a string to at most a given number of characters, adding an ellipsis when it had to cut.

**Why it is here.** A shared helper used wherever a label must fit a fixed width, so every track trims text the same way and signals with an ellipsis that more text exists.

.. CG-EXPLANATION-END id=function:truncate

``function roundTo``
--------------------

.. CG-BLOCK id=function:roundTo lines=243-253

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 243-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:roundTo

**What this does.** Rounds a number to a given number of decimal places using the standard multiply-round-divide recipe.

**Why it is here.** A small shared maths helper so depth and elevation values are rounded consistently across the log, for example when the axis de-duplicates its surface and bottom ticks.

.. CG-EXPLANATION-END id=function:roundTo

``function pctForAmount``
-------------------------

.. CG-BLOCK id=function:pctForAmount lines=254-265

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 254-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:pctForAmount

**What this does.** Turns a DOV admixture-amount word into a percentage weight: much is 15, moderate is 10, little is 5, and a missing or unknown amount falls back to 5.

**Why it is here.** The admixture strips and chips size themselves by these weights, so the amount word drives how wide each admixture shows. The comment records why an unknown amount falls back to the little baseline rather than zero: a chip with no amount would otherwise vanish. It reads the raw Dutch amount words directly, matching the translate-at-the-boundary rule that keeps upstream tokens intact.

.. CG-EXPLANATION-END id=function:pctForAmount

``function formatMtaw``
-----------------------

.. CG-BLOCK id=function:formatMtaw lines=266-268

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/utils.ts
   :language: typescript
   :lines: 266-268
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatMtaw

**What this does.** Formats an absolute level for an axis label: two decimals, with a leading plus sign when the level is positive.

**Why it is here.** The leading plus lets an engineer scan signed levels at a glance, telling a level above the datum from one below it without hunting for a minus sign — used for the labels on the absolute-level axis.

.. CG-EXPLANATION-END id=function:formatMtaw

