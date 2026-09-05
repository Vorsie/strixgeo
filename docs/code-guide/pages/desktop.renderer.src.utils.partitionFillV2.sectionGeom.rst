desktop.renderer.src.utils.partitionFillV2.sectionGeom
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module turns the engine's public inputs — the columns, the correlation edges, and any lens-apex overrides — into a clean metres-by-elevation geometry the arrangement layer can consume. It drops empty columns, closes per-column depth gaps, collapses adjacent same-soil runs, precomputes each unit's top and base elevation (surface minus depth), and gives each column its real along-section position. The imports reuse the v1 normalisers (imported read-only, never re-implemented) plus the column-separation, per-gap-lens, tie-contact, and flag helpers.

**Why it is here.** The design (§2, §3) requires the arrangement to work in real along-section metres and elevation, and the KEPT v1 normalisation (``closeColumnGaps`` / ``collapseAdjacentSameFormation``) is imported rather than forked so the two engines cannot drift. Real along-metres are load-bearing — uniform column spacing diverges (memory ``feedback_partitionfill_needs_alongm``). It is a pure module: no React, no clock, no randomness.

.. CG-EXPLANATION-END id=module-header

``const ENABLE_ENCLOSED_LENS``
------------------------------

.. CG-BLOCK id=const:ENABLE_ENCLOSED_LENS lines=62-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 62-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:ENABLE_ENCLOSED_LENS

**What this does.** A constant, set true, that turns on extracting enclosed lenses — merging a same-soil sandwich into one continuous matrix band and recording the middle unit as a HOLE in it.

**Why it is here.** The docstring records this as the load-bearing prerequisite for the hardest defect class (design §4 increment-12): a lone interbedded stack's correct fill is own-elevation lenses OVERLAID on a facing band, which a true partition cannot overlay, so the facing band must become a matrix annulus with the lens as a hole. It is kept as a documented emergency kill-switch — flipping it to false falls back to the ordinary lens-closing path, still exercised by the same tests.

.. CG-EXPLANATION-END id=const:ENABLE_ENCLOSED_LENS

``const ENABLE_ENCLOSED_LENS_EDGED``
------------------------------------

.. CG-BLOCK id=const:ENABLE_ENCLOSED_LENS_EDGED lines=88-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 88-97
   :lineno-match:

.. CG-EXPLANATION-START id=const:ENABLE_ENCLOSED_LENS_EDGED

**What this does.** A constant, set false, guarding an experiment: recording a same-soil-enclosed minority whose enclosing band below is TIED, without doing the merge.

**Why it is here.** The docstring records it was MEASURED NEGATIVE (session 9, flag on): without the merge the enclosing soil is not a continuous annulus, so the emitted notch rides the column edge as a hole-free bite the flood face absorbs, reopening 53 coverage holes. It is kept off — the affected minorities stay absent, a pre-existing residual, not a new defect.

.. CG-EXPLANATION-END id=const:ENABLE_ENCLOSED_LENS_EDGED

``function edgedBelowMergeEnabled``
-----------------------------------

.. CG-BLOCK id=function:edgedBelowMergeEnabled lines=98-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 98-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgedBelowMergeEnabled

**What this does.** Returns whether the below-edged merge experiment is on, by reading the two-sided-terminations flag.

**Why it is here.** The session-24 experiment (growing an edged below unit up over the lens instead of splicing it out) is gated to the flag-on path only, so the flag-off engine stays byte-identical while the experiment is measured.

.. CG-EXPLANATION-END id=function:edgedBelowMergeEnabled

``interface UnitGeom``
----------------------

.. CG-BLOCK id=interface:UnitGeom lines=103-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 103-113
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitGeom

**What this does.** The shape of one unit with its elevations precomputed: layer id, formation id, body id, top elevation, and base elevation (all in metres TAW).

**Why it is here.** It is the elevation-space unit the whole engine passes around, replacing the raw depth-below-surface form the public input uses.

.. CG-EXPLANATION-END id=interface:UnitGeom

``interface ColumnGeom``
------------------------

.. CG-BLOCK id=interface:ColumnGeom lines=114-133

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 114-133
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnGeom

**What this does.** The shape of one column: its investigation id, its real along-section x, its surface elevation, its gap-free unit stack, and its extracted enclosed lenses.

**Why it is here.** The ``enclosedLenses`` field carries the v1 step-0 outcome (a minority whose neighbours above and below share one soil): the two enclosing units are merged into one continuous entry so the matrix band is one face, and the lens is recorded here to be drawn as a hole in that band; ``matrixFormationId`` names the enclosing soil so the lens is only drawn into a gap whose facing column carries that matrix at the lens's elevation.

.. CG-EXPLANATION-END id=interface:ColumnGeom

``interface EnclosedLens``
--------------------------

.. CG-BLOCK id=interface:EnclosedLens lines=134-155

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 134-155
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EnclosedLens

**What this does.** The shape of one extracted enclosed lens: the lens unit, the formation of its enclosing matrix, and an optional ``emitGaps`` set naming which adjacent gaps the lens may be drawn into.

**Why it is here.** The ``emitGaps`` field implements ruling 8v ("0 ties is ALWAYS a lens", the edged-enclosed S22 lower sand): when undefined the lens draws into both gaps as before, but a minority tied toward one neighbour and untied toward the other sets it to ONLY the untied gaps — so the lens flank draws there (0 ties equals a lens) while the tied gap keeps its band by construction.

.. CG-EXPLANATION-END id=interface:EnclosedLens

``const TOP_BAND_SNAP_M``
-------------------------

.. CG-BLOCK id=const:TOP_BAND_SNAP_M lines=156-188

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 156-188
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOP_BAND_SNAP_M

**What this does.** The 10 cm snap threshold for the top-band anchor.

**Why it is here.** Ruling 5-revised (2026-07-14 evening): where the first litho boundary and the first data point diverge by no more than this, the band snaps to the first data point; 10 cm is the owner's stated value.

.. CG-EXPLANATION-END id=const:TOP_BAND_SNAP_M

``function firstLithoTopElev``
------------------------------

.. CG-BLOCK id=function:firstLithoTopElev lines=189-217

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 189-217
   :lineno-match:

.. CG-EXPLANATION-START id=function:firstLithoTopElev

**What this does.** Returns a column's top-band anchor elevation — the first (topmost) unit's top, snapped to the first data point when one is supplied and within 10 cm, otherwise falling back to that data point; with no data point supplied it simply rides the first litho boundary.

**Why it is here.** Ruling 5-revised: the implicit top correlation band follows each test's first litho boundary, NEVER the ground surface, and the strip between that line and the ground stays empty (no invented soil above the first data point). The docstring notes the current extraction carries no separate first-data field, so today the snap is a no-op, but the ``diverged`` computation is kept visible so a future owner retune of the far case is a one-line change here.

.. CG-EXPLANATION-END id=function:firstLithoTopElev

``interface RawLayerContact``
-----------------------------

.. CG-BLOCK id=interface:RawLayerContact lines=218-235

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 218-235
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawLayerContact

**What this does.** The shape recording one picked unit's RAW pre-normalisation contact elevations, keyed by its layer id: its surviving column index, its raw top and base elevations, and its formation.

**Why it is here.** Ruling 8r ("the lines before the merge"): the enclosed-lens merge may splice a raw picked unit out of the normalised stack, after which the tie resolver could not find its layer id and would silently drop its approved ties. This table preserves every picked unit's drawn contact so a tie endpoint always resolves at the elevation the owner drew, and the formation field feeds the identity augmentation that must still know what soil was drilled there.

.. CG-EXPLANATION-END id=interface:RawLayerContact

``interface SectionInput``
--------------------------

.. CG-BLOCK id=interface:SectionInput lines=236-268

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 236-268
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionInput

**What this does.** The shape of the whole normalised section: the columns, the edges, any lens-apex overrides, and the raw-layer-contact table.

**Why it is here.** It is the single bundle curve emission consumes; the raw-contact table is the ruling-8r fallback the tie resolver consults when a tie endpoint's layer id was spliced out of the normalised stack, and it is absent flag-off so flag-off resolution stays byte-identical.

.. CG-EXPLANATION-END id=interface:SectionInput

``function buildSectionInput``
------------------------------

.. CG-BLOCK id=function:buildSectionInput lines=269-418

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 269-418
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSectionInput

**What this does.** The normaliser. It gathers every layer id that takes part in any edge, builds the per-column tie-contact elevations, then for each non-empty column clones its units, closes depth gaps, collapses adjacent same-soil runs, precomputes elevations, records the raw contacts before any extraction, and extracts enclosed lenses. It bails to an empty result if fewer than two columns survive, assigns each survivor its real along-section x (or its index), enforces a minimum separation for a paired CPT and borehole, and — under the two-sided flag — runs the per-gap edged-enclosed-lens extraction before returning.

**Why it is here.** The order matters and is pinned: raw contacts are captured BEFORE ``extractEnclosedLenses`` mutates the stack (ruling 8r), the along-metres are the real ``alongM`` because uniform spacing diverges, and the per-gap pass (ruling 8v) extracts the S22-shaped edged minority the section-wide extraction skips and emits it only into its untied gap. The docstring records that the once-tempting shortcut of skipping the merge under the flag was measured negative (session 22, +104 wrong-soil overlaps), so the merge stays on for both flag states.

.. CG-EXPLANATION-END id=function:buildSectionInput

``function extractEnclosedLenses``
----------------------------------

.. CG-BLOCK id=function:extractEnclosedLenses lines=419-513

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 419-513
   :lineno-match:

.. CG-EXPLANATION-START id=function:extractEnclosedLenses

**What this does.** Finds and extracts enclosed lenses in place: a unit is a lens when the units immediately above and below share one formation that is not the unit's own. It merges the two enclosing units into one continuous band (keeping the shallower's identity, unless the below unit is edged, in which case it grows the below unit up instead) and returns the extracted lenses, repeating until none remain.

**Why it is here.** This is v1's enclosed-lens step-0, formation-keyed. The docstring pins several guards: an interbed whose contact rides a tie is 8a-tied and must stay a real un-merged unit (it bands emergently, ruling 8l(b)); the same-body guard was RELAXED (ruling-8e Milestone-2, 2026-07-15) because requiring one body kept 14 of 19 absent minorities out of the clean hole path; the lens itself must be uncorrelated (a tied unit bands via its tie); and the below unit must be un-edged unless the flag permits keeping its identity, else its own tie would lose its layer id and its band would vanish (the Cross-section-3 regression).

.. CG-EXPLANATION-END id=function:extractEnclosedLenses

``function extractEdgedEnclosedLenses``
---------------------------------------

.. CG-BLOCK id=function:extractEdgedEnclosedLenses lines=514-531

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sectionGeom.ts
   :language: typescript
   :lines: 514-531
   :lineno-match:

.. CG-EXPLANATION-START id=function:extractEdgedEnclosedLenses

**What this does.** The gated-off experiment (Target C): it non-destructively records a same-soil-enclosed minority whose ordinary merge was blocked because an enclosing unit is edged, without touching the column stack.

**Why it is here.** The ordinary pass cannot merge it (the merge would splice out an edged below unit and drop its tie), so it would render absent. Recording it as an un-merged lens was MEASURED NEGATIVE (kept off): without the merge the enclosing soil is not a continuous annulus, so the notch rides the column edge and the flood face absorbs it or a sliver appears. Kept for the record per the prompt's prove-it-and-record allowance.

.. CG-EXPLANATION-END id=function:extractEdgedEnclosedLenses

