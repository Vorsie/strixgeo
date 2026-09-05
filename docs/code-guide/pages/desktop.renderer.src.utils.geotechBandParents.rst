desktop.renderer.src.utils.geotechBandParents
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechBandParents.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechBandParents.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBandParents.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file pairs each packing band with the litho unit it subdivides, on that band's own column. The comment frames it as the join between two sides: geotech layers on one, litho layers on the other, with the geotech unit roster as the link (a geotech unit's ``source_litho_formation_id`` names the litho formation it subdivides). It states two load-bearing rules, both settled against the owner's real model: the lookup is per column because two CPTs are two different holes, and a formation may occur more than once on one column (on the owner's model, 119 of 199 column-formation pairs carry two or more rows), so each band is matched to the occurrence it actually overlaps rather than to the formation as a whole. It imports the formation and litho-layer response types and the band-fit types.

**Why it is here.** The reasons are recorded in the comment. Matching on formation alone would judge a band against a unit metres away on another hole; keeping only one row per column-formation pair would judge most bands against the wrong body and report columns nobody had touched. Both rules exist because the owner's real data has recurring formations, so the safe answer had to be measured against that data, not assumed.

.. CG-EXPLANATION-END id=module-header

``function keyOf``
------------------

.. CG-BLOCK id=function:keyOf lines=35-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBandParents.ts
   :language: typescript
   :lines: 35-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:keyOf

**What this does.** Builds the composite index key for one occurrence set — a formation as it sits on one column — by joining the column id and formation id with a bar.

**Why it is here.** The docstring notes both halves are UUIDs, so the bar separator can never appear inside either half and two different pairs can never collide on the same key.

.. CG-EXPLANATION-END id=function:keyOf

``function overlapM``
---------------------

.. CG-BLOCK id=function:overlapM lines=48-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBandParents.ts
   :language: typescript
   :lines: 48-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:overlapM

**What this does.** Returns how many metres of the depth interval from ``aTop`` to ``aBase`` also lie within the interval from ``bTop`` to ``bBase``, or zero when the two intervals do not touch.

**Why it is here.** A small shared measure of depth overlap that the occurrence-picking step uses to decide which body a band belongs to.

.. CG-EXPLANATION-END id=function:overlapM

``function pickOccurrence``
---------------------------

.. CG-BLOCK id=function:pickOccurrence lines=71-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBandParents.ts
   :language: typescript
   :lines: 71-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickOccurrence

**What this does.** Chooses which occurrence of a recurring unit a band belongs to: the one it overlaps most. It starts with the first candidate and keeps whichever later candidate has a larger overlap, breaking a tie by choosing the shallower one. When a band overlaps none of the occurrences it returns the first candidate rather than nothing.

**Why it is here.** The docstring records the logic. A band lying wholly inside one occurrence overlaps it by its own full length, which no other occurrence can beat (occurrences on a column do not overlap each other), so a real fit always resolves cleanly. The tie-break is by depth, not list position, so a band straddling the contact between two bodies is paired the same way regardless of the order the server returned the rows — the shallower body wins, an arbitrary but stable choice. Returning the first occurrence when a band overlaps none is deliberate: the band is then judged against a unit it lies entirely outside, which correctly flags that column as needing re-derivation; returning nothing would mislabel that worst case as "not stale".

.. CG-EXPLANATION-END id=function:pickOccurrence

``function pairBandsWithLithoParents``
--------------------------------------

.. CG-BLOCK id=function:pairBandsWithLithoParents lines=112-154

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBandParents.ts
   :language: typescript
   :lines: 112-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:pairBandsWithLithoParents

**What this does.** Pairs every CPT-anchored packing band with the litho unit it subdivides. It first groups every CPT-anchored litho layer into a map from (column, formation) to all its occurrences on that column; builds a lookup from each geotech unit to the litho formation it subdivides; then for each CPT-anchored packing band finds the candidate occurrences of its parent formation on its column and records the band paired with the occurrence it overlaps most — or with nothing when the parent cannot be resolved. Bands anchored on a borehole are skipped entirely.

**Why it is here.** Borehole bands are dropped, not paired, because the only consumer is the re-derive prompt on "Subdivide CPTs", a verb that rewrites CPT columns only — naming a borehole column would send the engineer to a verb that cannot help it. A band whose parent cannot be resolved (its unit is missing from the roster, carries no source link, or that litho formation has no row on this column) is paired with nothing, which the downstream rule treats as a data-integrity problem rather than as staleness.

.. CG-EXPLANATION-END id=function:pairBandsWithLithoParents

