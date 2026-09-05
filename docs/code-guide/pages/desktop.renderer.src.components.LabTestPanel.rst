desktop.renderer.src.components.LabTestPanel
============================================

.. CG-PAGE source=desktop/src/renderer/src/components/LabTestPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/LabTestPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports and top comment for the lab-test detail panel. The imports bring in the ``useEffect`` hook, a few icons, a set of charting pieces from the Recharts library (used to draw the grain-size curve), the TypeScript shapes for the lab data, a keyboard helper, four label-lookup helpers, and the translator. The comment records that this panel slides in when the user clicks a sample marker in the borehole log, shows the sample header plus one sub-section per lab-test family the sample actually has, and renders empty families as nothing so the panel stays short.

**Why it is here.** This is a slide-in detail *panel* (drawn as a side strip, not a blocking dialog) — the app's inspector pattern for showing the detail of a clicked item. The comment notes the deliberate technology split: the layout is plain HTML, and only the grain-size cumulative curve uses the Recharts charting library, which is already a dependency for the CPT chart, so no new library is pulled in just for this.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=39-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 39-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The panel's inputs: the clicked ``sample``, the full ``allSamples`` list from the same borehole, a callback to select another sample by id, and a callback to close.

**Why it is here.** The full sample list is passed in (per the comment) so the panel can offer previous/next navigation and know its position; it is already sorted by depth upstream in the borehole log, so the panel does not re-sort.

.. CG-EXPLANATION-END id=interface:Props

``function LabTestPanel``
-------------------------

.. CG-BLOCK id=function:LabTestPanel lines=49-194

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 49-194
   :lineno-match:

.. CG-EXPLANATION-START id=function:LabTestPanel

**What this does.** The panel component. It works out which lab-test families the sample has data for and whether it has any at all, finds the sample's position in the sibling list to know the previous and next samples, and installs a keyboard listener while it is on screen: Escape closes, and the left/right arrows step to the previous/next sample. It then draws a fixed-width side strip with a header (sample number, depth or depth range, type/composition/instrument/date, and previous/next/close buttons) and a scrollable body that shows an empty note if there is no data, the grain-size section if present, and a single merged "Identification tests" section for every other family that has data.

**Why it is here.** The keyboard listener is attached to the whole document, not the panel, because the panel does not hold keyboard focus; it skips its shortcuts while a text box is being typed in so arrow keys do not steal the caret, and Escape-to-dismiss follows the platform convention for transient panels. The big body comment records an owner decision: all non-grain-size families (Atterberg limits, carbonate, organic, water content, and the scalar catch-all) are merged under one "Identification tests" heading — the translation of the Dutch "Onderkenningsproeven" — rather than shown as a separate section each, while grain size keeps its own section because it needs the chart.

.. CG-EXPLANATION-END id=function:LabTestPanel

``function SectionTitle``
-------------------------

.. CG-BLOCK id=function:SectionTitle lines=195-211

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 195-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionTitle

**What this does.** A tiny piece that draws a section's small-caps title and an optional grey subtitle beneath it.

**Why it is here.** Every sub-section needs the same title styling, so it is written once and reused for consistency.

.. CG-EXPLANATION-END id=function:SectionTitle

``const GRAIN_FRACTIONS``
-------------------------

.. CG-BLOCK id=const:GRAIN_FRACTIONS lines=212-219

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 212-219
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRAIN_FRACTIONS

**What this does.** The soil-fraction zones — clay, silt, sand, gravel, cobbles — each with its diameter range in millimetres, a label, and a background shade. They become the shaded vertical bands behind the grain-size chart.

**Why it is here.** The boundaries follow ISO 14688-1 (the international soil-description standard the reference plot uses), as the comment states, so the shaded bands on the chart match the fraction limits a geotechnical engineer expects.

.. CG-EXPLANATION-END id=const:GRAIN_FRACTIONS

``const GRAIN_X_DOMAIN``
------------------------

.. CG-BLOCK id=const:GRAIN_X_DOMAIN lines=220-224

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 220-224
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRAIN_X_DOMAIN

**What this does.** The chart's horizontal range: from 0.0001 mm to 200 mm, drawn on a logarithmic scale.

**Why it is here.** Grain diameters span several orders of magnitude, from clay fines to cobbles, so a log scale is the standard way to show them all on one axis.

.. CG-EXPLANATION-END id=const:GRAIN_X_DOMAIN

``const GRAIN_CURVE_COLORS``
----------------------------

.. CG-BLOCK id=const:GRAIN_CURVE_COLORS lines=225-226

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 225-226
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRAIN_CURVE_COLORS

**What this does.** A short list of line colours, one picked per grain-size record.

**Why it is here.** One sample can carry several methods (a sieve test, a hydrometer test, a laser test), and the comment notes each gets its own colour so the curves read as distinct lines on the combined chart.

.. CG-EXPLANATION-END id=const:GRAIN_CURVE_COLORS

``interface GrainSizeChartPoint``
---------------------------------

.. CG-BLOCK id=interface:GrainSizeChartPoint lines=227-234

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 227-234
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GrainSizeChartPoint

**What this does.** The shape of one row of chart data: a ``diameter`` value plus one field per curve (named ``series_0``, ``series_1`` and so on) holding the percent-finer for that curve at that diameter.

**Why it is here.** The field names are dynamic because the number of curves is not known ahead of time; declaring the flexible shape here lets the chart plot however many methods the sample has (built by ``buildCombinedSeries`` below).

.. CG-EXPLANATION-END id=interface:GrainSizeChartPoint

``function GrainSizeSection``
-----------------------------

.. CG-BLOCK id=function:GrainSizeSection lines=235-382

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 235-382
   :lineno-match:

.. CG-EXPLANATION-START id=function:GrainSizeSection

**What this does.** Draws the grain-size section: it turns each record into a coloured, labelled curve, builds the combined chart data, and collects any chemistry pre-treatments (lime removed, organics removed) into a deduplicated set of pills. If there is no curve data it shows a note; otherwise it draws the log-scale cumulative curve with the shaded fraction bands behind it, a tooltip, and a legend of method name, colour and test date.

**Why it is here.** Multiple methods each cover a different diameter range (a sieve reaches gravel and sand, a hydrometer reaches silt and clay), so the section plots them as separate lines on shared axes rather than forcing them into one curve. The horizontal axis is reversed — coarse on the left, fines on the right — per the owner's preferred plot orientation, as the comment records.

.. CG-EXPLANATION-END id=function:GrainSizeSection

``function buildCombinedSeries``
--------------------------------

.. CG-BLOCK id=function:buildCombinedSeries lines=383-408

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 383-408
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCombinedSeries

**What this does.** Merges all the grain-size records into one chart dataset: it gathers every distinct diameter measured across the records, and for each diameter emits a row carrying the percent-finer for whichever records measured at that point, leaving the others blank. The rows are returned sorted by diameter.

**Why it is here.** Because each method measures at its own diameters, a blank (rather than a zero) at an unmeasured point tells the chart to break the line there instead of drawing a false straight segment bridging the gap between methods, as the comment explains. Percent-finer is derived as 100 minus the recorded percent-larger, keeping the stored value and the plotted value distinct.

.. CG-EXPLANATION-END id=function:buildCombinedSeries

``function ScalarTestsSection``
-------------------------------

.. CG-BLOCK id=function:ScalarTestsSection lines=409-458

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 409-458
   :lineno-match:

.. CG-EXPLANATION-START id=function:ScalarTestsSection

**What this does.** Draws a section of scalar (single-number or single-code) lab tests. It groups the rows by their parameter group so related tests cluster, then draws each group under a translated group heading as a small table, one row per test.

**Why it is here.** Grouping keeps related results together (grain density beside water content, for instance). The group heading is shown through a label lookup while the raw group token is kept as the element's hover title — the translate-at-the-presentation-boundary rule (CLAUDE.md; Data Integrity Rule 2), which shows the raw token as a tooltip so a domain expert can verify the mapping. The title is configurable so the panel can pass "Identification tests" when it funnels every non-grain family in here.

.. CG-EXPLANATION-END id=function:ScalarTestsSection

``function ScalarRow``
----------------------

.. CG-BLOCK id=function:ScalarRow lines=459-487

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 459-487
   :lineno-match:

.. CG-EXPLANATION-START id=function:ScalarRow

**What this does.** Draws one scalar-test row: the parameter label with its method/date beneath, and the formatted value on the right. For an ASTM soil-classification code it also shows the plain-language description under the code.

**Why it is here.** The parameter and its raw token are both surfaced (the label is shown, the raw token is the hover title) per the translate-at-the-boundary rule. The ASTM description is spelled out (per the comment) so someone without a classification chart in hand can read what a code like CL or SW means.

.. CG-EXPLANATION-END id=function:ScalarRow

``function formatScalarValue``
------------------------------

.. CG-BLOCK id=function:formatScalarValue lines=488-513

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 488-513
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatScalarValue

**What this does.** Turns a scalar test into display text: a number with its unit when there is one, otherwise the text value, otherwise a detection condition, otherwise a dash.

**Why it is here.** A *formatter* — a small pure function that turns a stored value into readable text — kept in one place so every scalar row shows values the same way, including the case where a lab reported a word or a below-detection note instead of a number.

.. CG-EXPLANATION-END id=function:formatScalarValue

``function collectIdentificationTests``
---------------------------------------

.. CG-BLOCK id=function:collectIdentificationTests lines=514-639

.. literalinclude:: ../../../desktop/src/renderer/src/components/LabTestPanel.tsx
   :language: tsx
   :lines: 514-639
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectIdentificationTests

**What this does.** Flattens every non-grain-size lab family into one uniform list of scalar-shaped rows. Atterberg records explode into up to three rows (liquid limit, plastic limit, and a computed plasticity index — or a "non-plastic" marker); carbonate, organic and water-content records each become one or two rows; and the scalar catch-all tests pass through unchanged. Each synthetic row gets a stable, unique id built from its parent record's id plus a suffix.

**Why it is here.** The owner asked for all these families under one "Identification tests" heading, so this helper does the merge in one place (the per-family sections it replaced are noted as removed in the comment above). The scalar catch-all family is the app's flexible lab-test shape that new test kinds map into without a schema change (memory), which is why every family can be re-expressed as its rows. The distinct id suffixes (``-LL``, ``-PL`` and so on) keep the merged list's keys unique even though liquid and plastic limit come from the same parent record. The stored Dutch parameter tokens are carried through untouched and translated only when drawn — again the translate-at-the-boundary rule.

.. CG-EXPLANATION-END id=function:collectIdentificationTests

