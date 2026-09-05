desktop.renderer.src.shell.stages.parameters.unitStatistics
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the pure-arithmetic file behind the per-unit plots: it computes the spread of qc (cone resistance), fs (sleeve friction) and Rf (friction ratio) over the ground a unit covers. The header comment states that everything here is characterisation only, and fixes the depth frame as metres below the collar, positive down.

**Why it is here.** Split from the panel that draws it because none of it touches React and all of it is worth pinning and testing directly (the same reason as ``depthPanelGeometry.ts``). The characterisation-only note is load-bearing: nothing here is correlated, converted or calibrated into a design-ready value (φ′, c′, cu, E50, OCR, Vs, G0, M) — those stay Phase 5, and the panel says so on screen. The depth frame matches both the plot endpoint's depths and a geotech band's top and base, so the two intersect with no conversion.

.. CG-EXPLANATION-END id=module-header

``interface UnitBandInterval``
------------------------------

.. CG-BLOCK id=interface:UnitBandInterval lines=20-36

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 20-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitBandInterval

**What this does.** The shape of one CPT-anchored band of a unit: the CPT id it hangs off (the key into the series map) and its top and base depth in metres below the collar.

**Why it is here.** A band is where a unit sits inside one hole; the statistics read the cone measurements between its top and base, and the CPT id is the link to that hole's series.

.. CG-EXPLANATION-END id=interface:UnitBandInterval

``type UnitStatisticsChannel``
------------------------------

.. CG-BLOCK id=type:UnitStatisticsChannel lines=37-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=type:UnitStatisticsChannel

**What this does.** Names the three measurement channels a CPT offers for characterisation — ``qc`` cone resistance in MPa, ``fs`` sleeve friction in MPa, ``rf`` the friction ratio in percent — as a fixed set of three strings.

**Why it is here.** They are kept as three separate distributions, each with its own unit and its own axis, rather than one shared table — a single shared scale would be the dual-axis mistake.

.. CG-EXPLANATION-END id=type:UnitStatisticsChannel

``const UNIT_STATISTICS_CHANNELS``
----------------------------------

.. CG-BLOCK id=const:UNIT_STATISTICS_CHANNELS lines=40-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 40-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNIT_STATISTICS_CHANNELS

**What this does.** The three channels listed in the exact order the panel draws them: qc, then fs, then rf.

**Why it is here.** One ordered list so the arithmetic and the panel iterate the channels the same way every time, and the panel's row layout never depends on what one hole happened to record.

.. CG-EXPLANATION-END id=const:UNIT_STATISTICS_CHANNELS

``interface UnitChannelSeries``
-------------------------------

.. CG-BLOCK id=interface:UnitChannelSeries lines=53-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 53-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitChannelSeries

**What this does.** One CPT's series reduced to just the channels the statistics need: the ascending measurement depths, and per-depth cone resistance, sleeve friction and friction ratio (the last two may be null when the file has no such column).

**Why it is here.** The comment keeps a distinction worth keeping: a whole-channel null means the file never recorded it (a CPTM has no sleeve friction at all), which is different from a null entry inside a recorded channel — one depth the instrument could not answer for.

.. CG-EXPLANATION-END id=interface:UnitChannelSeries

``interface DistributionSummary``
---------------------------------

.. CG-BLOCK id=interface:DistributionSummary lines=72-95

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 72-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DistributionSummary

**What this does.** The five-number summary of one channel plus mean and spread: the sample count n, the minimum, the 5th percentile, the first quartile, the median, the third quartile, the 95th percentile, the maximum, the arithmetic mean, and the sample standard deviation. A distribution is how a set of readings spreads out; the median is the middle reading; a quartile or percentile is the value below which a given fraction of the readings fall; the standard deviation measures how far the readings scatter from the mean. Every field is null when the count cannot support it.

**Why it is here.** A null is never replaced with a stand-in number: an empty unit has no median, and a single measurement has no standard deviation. Reporting 0 for either would state a fact about the ground that no measurement supports.

.. CG-EXPLANATION-END id=interface:DistributionSummary

``interface UnitChannelStatistics``
-----------------------------------

.. CG-BLOCK id=interface:UnitChannelStatistics lines=96-110

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 96-110
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitChannelStatistics

**What this does.** One channel's pooled data: every finite sample it contains, ascending, plus that channel's summary.

**Why it is here.** The raw samples are carried alongside the summary because the strip half of the plot draws the measurements themselves; a box drawn without them would hide how many readings stand behind it, which is exactly what an engineer needs to judge whether the spread means anything.

.. CG-EXPLANATION-END id=interface:UnitChannelStatistics

``interface UnitStatistics``
----------------------------

.. CG-BLOCK id=interface:UnitStatistics lines=111-154

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 111-154
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitStatistics

**What this does.** Declares ``UnitStatistics`` — everything the per-unit panel needs about one unit: one entry per channel (always in the fixed channel order), how many CPT-anchored bands were offered, how many distinct CPTs those bands stand on, and the total metres of ground the bands cover. The lines that follow are the documentation comment for the next function, ``unitCptBands``.

**Why it is here.** The three counts let the panel state how much ground the numbers describe and flag when part of it is still missing; the trailing doc-comment explains the population filters applied next.

.. CG-EXPLANATION-END id=interface:UnitStatistics

``function unitCptBands``
-------------------------

.. CG-BLOCK id=function:unitCptBands lines=155-196

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 155-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitCptBands

**What this does.** Takes a scope's bands and narrows them to the ones the cone statistics may read: it keeps only accepted bands, only CPT-anchored ones, and — when a member set is given — only those whose CPT is on the sections. It returns each survivor as a plain {cptId, top, base}.

**Why it is here.** The scope selection (which unit, body or class the bands belong to) is done elsewhere by the single band authority, so this applies only the three population filters that stay per spec §3. Accepted-only is defensive, so a raw layer list cannot summarise ground the engineer has not committed to. CPT-anchored-only because a borehole-anchored band has no cone resistance to summarise — its class came from a flanking CPT. On-the-sections because the owner ruled that only CPTs on the sections pool, so hidden, removed and off-section holes are all excluded (2026-08-27).

.. CG-EXPLANATION-END id=function:unitCptBands

``function quantile``
---------------------

.. CG-BLOCK id=function:quantile lines=197-219

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 197-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:quantile

**What this does.** Reads a percentile off an ascending sample list by linear interpolation between the two nearest order statistics.

**Why it is here.** It uses the 'type 7' definition — the one Excel's PERCENTILE.INC, NumPy's default and R's default all use — so a number read off this panel matches the one an engineer reproduces in a spreadsheet from the same samples.

.. CG-EXPLANATION-END id=function:quantile

``function summariseDistribution``
----------------------------------

.. CG-BLOCK id=function:summariseDistribution lines=220-269

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 220-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:summariseDistribution

**What this does.** Turns a list of ascending samples into a full summary: the count, the minimum, the percentiles and quartiles and median via ``quantile``, the maximum, the mean, and the sample standard deviation. It returns all-null fields for an empty list and leaves the standard deviation null until there are at least two samples.

**Why it is here.** The standard deviation uses the sample (n-1) form, not the population form, because these readings are a sample OF the unit's ground, never the whole of it. The null-until-supported rule matches the summary type: no median for zero samples, no deviation for one.

.. CG-EXPLANATION-END id=function:summariseDistribution

``function depthInBand``
------------------------

.. CG-BLOCK id=function:depthInBand lines=270-274

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 270-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthInBand

**What this does.** Answers whether one measurement depth falls inside a band, using a half-open interval — at or below the top, and strictly above the base.

**Why it is here.** Half-open on purpose. A litho column is gap-free, so a band's base IS the next band's top; a closed interval would count every sample sitting exactly on a shared contact twice and inflate the count on precisely the samples two units disagree about. The cost is that the single deepest sample of a hole belongs to no band — one reading out of thousands, and cheaper than double-counting every contact.

.. CG-EXPLANATION-END id=function:depthInBand

``function channelValues``
--------------------------

.. CG-BLOCK id=function:channelValues lines=275-309

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 275-309
   :lineno-match:

.. CG-EXPLANATION-START id=function:channelValues

**What this does.** A one-line reader that returns the requested channel's array off a series — the qc array for 'qc', the fs array for 'fs', otherwise the rf array — or null when the file lacks that column. The lines that follow are the documentation comment for ``computeUnitStatistics``.

**Why it is here.** A tiny lookup so the pooling loop can ask for any channel by name without repeating the branch; the trailing doc-comment sets up the pooling function explained next.

.. CG-EXPLANATION-END id=function:channelValues

``function computeUnitStatistics``
----------------------------------

.. CG-BLOCK id=function:computeUnitStatistics lines=310-353

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitStatistics.ts
   :language: typescript
   :lines: 310-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeUnitStatistics

**What this does.** The core: it pools every cone reading lying inside a unit's bands and describes them. It groups the bands by CPT, sums the covered thickness, then for each channel walks each CPT's series once, keeps only finite readings whose depth lands inside one of that CPT's bands, sorts them, and summarises. It returns one summary per channel plus the band count, the CPT count and the covered thickness.

**Why it is here.** The unit's statistics are the statistics of the ground it covers — every in-band sample, pooled across every CPT, with no weighting by band thickness — because an engineer reading the box is asking 'what does the cone say in this material', and each reading is one answer. Bands are grouped by CPT so a 1500-sample series is walked once per channel, not once per band. A null or non-finite reading is treated as an absence and skipped, never as 0, which would drag the minimum and the mean toward a measurement nobody took. A CPT whose series has not arrived contributes nothing but is still counted, so the panel can say how much is still missing.

.. CG-EXPLANATION-END id=function:computeUnitStatistics

