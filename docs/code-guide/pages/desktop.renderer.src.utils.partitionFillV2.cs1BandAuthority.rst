desktop.renderer.src.utils.partitionFillV2.cs1BandAuthority
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds one check, called the "CS1 band-authority" test. A correlation band is a same-soil tie the engineer has drawn between the tops of the same soil in two columns (two boreholes on the section); the space between those two tops belongs to that soil. The check builds each band straight from the tie lines, samples points inside the band, and reports any place where a different soil has been painted inside it. The imports bring in the section point and region types and one point-in-polygon test (the "is this point inside this shape" test) from the sibling parity file.

**Why it is here.** The comment records that this is a *pure function* module — every answer depends only on the inputs, with no screen drawing and no file access, so it is safe to call and to test in isolation. It was ported verbatim out of a test file and factored into its own helper so the main v2 gate file stays under the 500-line budget (debt #201). The band-authority rule it enforces is part of the interpretation model in ``docs/design/section-fill.md``: a tie carries a weight of 2 = BAND, 1 = ONLAP, 0 = LENS, and a full band (weight 2) is authoritative — its soil owns the space between the two tied tops and no other soil may be drawn inside it.

.. CG-EXPLANATION-END id=module-header

``interface BandUnit``
----------------------

.. CG-BLOCK id=interface:BandUnit lines=21-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 21-26
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandUnit

**What this does.** An *interface* — a declared data shape — describing one soil layer inside a column: its top depth, its base depth, the id of the geological formation it belongs to, and its own layer id.

**Why it is here.** These are exactly the four facts the band maths needs from a layer: the top and base depths place it in elevation, the formation id says which soil it is so two layers can be compared, and the layer id lets a tie edge look the layer up by name.

.. CG-EXPLANATION-END id=interface:BandUnit

``interface BandColumn``
------------------------

.. CG-BLOCK id=interface:BandColumn lines=27-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 27-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandColumn

**What this does.** The shape of one column: the ground-surface elevation at that borehole, plus its ordered list of layers.

**Why it is here.** The check works in elevation (metres above the datum), but a layer stores its top and base as depths below the surface, so every column must carry its surface level to convert one into the other.

.. CG-EXPLANATION-END id=interface:BandColumn

``interface BandEdge``
----------------------

.. CG-BLOCK id=interface:BandEdge lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandEdge

**What this does.** The shape of one approved correlation tie between two layers: the two layer ids (``a`` and ``b``) and, optionally, which side of each layer is tied (``top`` or ``base``).

**Why it is here.** A band is built only from top-to-top ties, so the edge has to record which side each end touches; the side is optional because an older tie with no side recorded is treated as a top tie.

.. CG-EXPLANATION-END id=interface:BandEdge

``const FORMATION_LABEL``
-------------------------

.. CG-BLOCK id=const:FORMATION_LABEL lines=38-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 38-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:FORMATION_LABEL

**What this does.** A tiny lookup that turns the tail of a formation id into a readable Dutch soil name — ZAND (sand), KLEI (clay), SILT, VEEN (peat) — and falls back to the last six characters of the id when it is not one of those four.

**Why it is here.** The offender messages this file produces are read by a person during a dogfeed session, so a message that names ZAND is far clearer than one that names a raw id. This is the translate-at-the-presentation-boundary pattern (CLAUDE.md, Data Integrity Rule 2): the engine stores the raw token and the display label is added only where a human will read it.

.. CG-EXPLANATION-END id=const:FORMATION_LABEL

``interface Band``
------------------

.. CG-BLOCK id=interface:Band lines=41-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 41-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Band

**What this does.** The shape of one finished band after two tied layers have been matched up: the lower and upper column indices it spans, the top and base elevation at each of those two ends, and the soil (formation id) it carries.

**Why it is here.** To draw or sample a band across the columns between its two ends, the geometry of both endpoints is needed — the top and base elevation on the left and on the right — so the band's slanted top and base can be interpolated at any column in between.

.. CG-EXPLANATION-END id=interface:Band

``function bandAuthorityOffenders``
-----------------------------------

.. CG-BLOCK id=function:bandAuthorityOffenders lines=70-275

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 70-275
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandAuthorityOffenders

**What this does.** The check itself. First it builds a lookup from every layer id to where that layer sits (its column index and its top and base elevation, worked out from the column's surface level). Then, for each approved tie that joins the tops of two layers of the SAME soil in DIFFERENT columns, it builds one Band. It groups the fill regions by gap (the space between two neighbouring columns), and builds the real soil stack of every column. The authority check then walks each band: at every gap the band spans it interpolates the band's four-cornered patch, skips the gap when a bounding column's real data of a different soil overlaps the patch (the "over-match" exclusion), samples a grid of points inside the patch, and counts the points that a different soil's region has covered — ignoring lens regions and ignoring points that fall inside a competing band's own patch. If twenty or more samples in a gap are wrong it records an offender line. A second check, edge-on-tie, walks each column the band crosses and confirms the band's own soil is NOT drawn above its tie top and IS drawn just below it. It returns the two offender lists (both empty means clean).

**Why it is here.** The comment records that the authority rule and its two exceptions were preserved verbatim from the original v1 test: the over-match exclusion (a bounding column's real data of another soil legitimately overlaps the band) and the band-versus-band conflict zone (two bands of different soils cross, so neither is wrong). This is the CS1 real-data gate described in ``docs/design/section-fill.md`` — the fixed reference section that arbitrates whether the fill is correct. The small horizontal and vertical margins keep the sampler off the hairline seams at a band's own edges, and the twenty-sample threshold tolerates a stray edge pixel while still catching a real flood of the wrong soil into the band.

.. CG-EXPLANATION-END id=function:bandAuthorityOffenders

``function nonEmptyAlong``
--------------------------

.. CG-BLOCK id=function:nonEmptyAlong lines=276-287

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.cs1BandAuthority.ts
   :language: typescript
   :lines: 276-287
   :lineno-match:

.. CG-EXPLANATION-START id=function:nonEmptyAlong

**What this does.** Builds the along-section position (in metres) for each non-empty column. If real along-metre positions are supplied it keeps only the ones for columns that actually have layers; if none are supplied it falls back to plain 0, 1, 2, … indices. The last line re-exports the section point type so callers get it from one place.

**Why it is here.** The check numbers its columns 1:1 with the engine's own gap indexing, which skips empty columns, so the position list has to skip them the same way. The index fallback only matches the engine's own fallback; when real spacing exists it must be passed in, because a uniform-index spacing diverges from the true section geometry (memory: partition-fill offline tooling must pass real ``alongM`` spacing).

.. CG-EXPLANATION-END id=function:nonEmptyAlong

