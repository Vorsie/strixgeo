desktop.renderer.src.utils.partitionFillV2.seedClassifier
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the ONE shared classifier that decides what soil a traced arrangement face should be, from the column-edge segments on its boundary. A face is one cell of the planar arrangement (the tiling built from all the input lines). The rule, stated in the docstring: look at the face's real boundary edges that come from column-vertical curves, resolve each to its picked unit's formation, deduplicate — exactly one formation means a clean single seed, zero means either a genuine void or a topology defect, two or more means a missing or crossed separator line.

**Why it is here.** This module is extracted so the measured seed gate AND the flag-on paint path resolve seeds through the SAME code, so they cannot drift (the SEED_FILL_MANDATE "one invariant"). The docstring stresses that a vertex touch is NOT a seed — a face must own a non-zero-length column edge — and that an explicit void is GEOMETRIC ONLY, never "the old code had no label" and never "below TD, so guess it". Pure module.

.. CG-EXPLANATION-END id=module-header

``const COL_SEED_RE``
---------------------

.. CG-BLOCK id=const:COL_SEED_RE lines=35-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 35-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:COL_SEED_RE

**What this does.** A regular expression (a text pattern) matching a column-vertical curve id of the form ``col<number>:u<number>`` — the primary seed vocabulary.

**Why it is here.** A column vertical carries the picked unit's identity; matching this pattern is how the classifier recognises a genuine soil seed on a face boundary.

.. CG-EXPLANATION-END id=const:COL_SEED_RE

``const COL_LENS_SEED_RE``
--------------------------

.. CG-BLOCK id=const:COL_LENS_SEED_RE lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:COL_LENS_SEED_RE

**What this does.** A pattern matching the enclosed-lens sub-segment id ``col<number>:lens<number>``.

**Why it is here.** Ruling 8r / Step 4.1 (the column-vertical id split): a merged host's column vertical is split so the lens interval carries its own id, letting an interior-hole lens's own face seed its raw interbed soil instead of the enclosing matrix.

.. CG-EXPLANATION-END id=const:COL_LENS_SEED_RE

``function isColumnSeedId``
---------------------------

.. CG-BLOCK id=function:isColumnSeedId lines=47-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 47-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:isColumnSeedId

**What this does.** Returns whether a curve id is any column-vertical seed — either a real ``col:u`` id or a ``col:lens`` sub-segment.

**Why it is here.** The seed scan needs one predicate that accepts both seed vocabularies when collecting a face's seed refs.

.. CG-EXPLANATION-END id=function:isColumnSeedId

``const MIN_SEED_EDGE_M``
-------------------------

.. CG-BLOCK id=const:MIN_SEED_EDGE_M lines=57-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 57-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_SEED_EDGE_M

**What this does.** The minimum length (just over one 1 mm cell) a boundary column edge must have to count as a seed.

**Why it is here.** The docstring's mandate: a vertex touch is not a seed. Below the snap grid a "segment" is only a touch, so requiring strictly more than one snap unit separates an owned edge from a mere touch.

.. CG-EXPLANATION-END id=const:MIN_SEED_EDGE_M

``type SeedClass``
------------------

.. CG-BLOCK id=type:SeedClass lines=60-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 60-62
   :lineno-match:

.. CG-EXPLANATION-START id=type:SeedClass

**What this does.** A ``type`` (a fixed set of allowed labels) naming the four possible classifications of a face: single-seed, explicit-void, zero-seed-defect, or multi-seed-defect.

**Why it is here.** It is the vocabulary the whole seed gate and paint path share for a face's verdict.

.. CG-EXPLANATION-END id=type:SeedClass

``interface FaceBounds``
------------------------

.. CG-BLOCK id=interface:FaceBounds lines=63-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 63-70
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FaceBounds

**What this does.** The x and elevation bounding box of a face.

**Why it is here.** The void test needs the face's extent to compare against the fillable envelope, so the box is computed once and passed around.

.. CG-EXPLANATION-END id=interface:FaceBounds

``interface SeedResult``
------------------------

.. CG-BLOCK id=interface:SeedResult lines=71-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 71-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeedResult

**What this does.** The full output record for one face: its classification, its non-zero-length seed refs, its distinct seed formations, and its bounds.

**Why it is here.** Callers need not just the verdict but the evidence behind it (which refs, which formations) so a defect can be reported concretely.

.. CG-EXPLANATION-END id=interface:SeedResult

``function ptKey``
------------------

.. CG-BLOCK id=function:ptKey lines=81-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 81-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:ptKey

**What this does.** Builds a snapped-integer text key for a metres-by-elevation point, matching the arrangement snap grid.

**Why it is here.** Two points within one grid cell get the same key, so an exact vertex lookup is possible without floating-point comparison.

.. CG-EXPLANATION-END id=function:ptKey

``function segKey``
-------------------

.. CG-BLOCK id=function:segKey lines=86-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 86-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:segKey

**What this does.** Builds an undirected key for a segment from its two point keys, ordering them so the same segment gives the same key either way round.

**Why it is here.** A face-boundary edge and its twin must map to one entry, so the key must not depend on direction.

.. CG-EXPLANATION-END id=function:segKey

``function buildSegCurveMap``
-----------------------------

.. CG-BLOCK id=function:buildSegCurveMap lines=106-119

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 106-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSegCurveMap

**What this does.** Builds a map from each undirected snapped segment to the input curve ids that contributed it, by walking the arrangement's half-edges. A half-edge is one directed side of a segment in the arrangement's edge structure.

**Why it is here.** The docstring explains why this is needed: the face's aggregate ``boundingCurveIds`` has no per-edge provenance, so it cannot tell a non-zero-length column edge from a mere vertex touch. This per-segment map recovers exactly which curve gave each traced edge.

.. CG-EXPLANATION-END id=function:buildSegCurveMap

``function edgeLen``
--------------------

.. CG-BLOCK id=function:edgeLen lines=120-124

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 120-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeLen

**What this does.** Returns the metres length of a face-polygon edge.

**Why it is here.** The seed scan needs each boundary edge's own length to apply the vertex-touch floor.

.. CG-EXPLANATION-END id=function:edgeLen

``function faceBounds``
-----------------------

.. CG-BLOCK id=function:faceBounds lines=125-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 125-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:faceBounds

**What this does.** Returns the x and elevation bounding box of a traced face's outer ring.

**Why it is here.** It supplies the ``FaceBounds`` the void test consumes.

.. CG-EXPLANATION-END id=function:faceBounds

``function seedRefsOfFace``
---------------------------

.. CG-BLOCK id=function:seedRefsOfFace lines=158-189

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 158-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:seedRefsOfFace

**What this does.** Returns the non-zero-length column-edge seed refs on a face's boundary: it walks each boundary edge, maps it to its input curve, and keeps a column-seed ref only when that edge's own length exceeds the snap floor, then resolves notch-versus-hole ambiguity and sorts.

**Why it is here.** This is the mandate step 1 in code — a column curve merely present in the aggregate but owning no real edge (a vertex touch) is excluded, which is the whole point of the invariant.

.. CG-EXPLANATION-END id=function:seedRefsOfFace

``function resolveNotchLensRefs``
---------------------------------

.. CG-BLOCK id=function:resolveNotchLensRefs lines=190-200

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 190-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveNotchLensRefs

**What this does.** Resolves the notch-versus-hole ambiguity: if a face carries any host ``col:u`` edge, its ``col:lens`` edges are dropped (the matrix host owns the notch); a face carrying only ``col:lens`` edges is the interior-hole lens's own face.

**Why it is here.** Ruling 8r / Step 4.1: an interior-hole lens's own face should seed its raw interbed soil, but a NOTCH lens rides its own column edge as a bite the arrangement cannot separate from the enclosing matrix, so on that shared face the matrix host wins. The rule is purely structural, needing no interior-hole-versus-notch guess at emission time, and keeps both interior holes and notch faces single-seeded.

.. CG-EXPLANATION-END id=function:resolveNotchLensRefs

``function formationOfRef``
---------------------------

.. CG-BLOCK id=function:formationOfRef lines=201-244

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 201-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationOfRef

**What this does.** Resolves a column-vertical seed ref to its unit's formation: a ``col:u`` ref reads the unit at that column and index, a ``col:lens`` ref reads that column's recorded enclosed lens's raw soil.

**Why it is here.** The classification is about formations, not raw ids, so each seed ref must be turned into the soil it stands for — and the two ref forms resolve to different places (a live unit versus a recorded lens).

.. CG-EXPLANATION-END id=function:formationOfRef

``function isMergeArtifactSeed``
--------------------------------

.. CG-BLOCK id=function:isMergeArtifactSeed lines=245-263

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 245-263
   :lineno-match:

.. CG-EXPLANATION-START id=function:isMergeArtifactSeed

**What this does.** Tests whether a single-seed enclosed-lens face's seed was manufactured BY the same-column merge and is therefore illegitimate: it is a merge artifact only when a seed edge belongs to a column that hosts an enclosed lens whose soil equals the face's minority AND whose matrix equals the seed formation.

**Why it is here.** That triple — same host column, minority match, matrix match — is the merge's exact fingerprint (the merge deleted the minority and merged the enclosing matrix into one band, leaving only that merged matrix as the lens face's column edge). The test deliberately excludes a foreign lens biting a matrix notch (a real seed) so the ``merged-minority`` defect fires only on the true artifact.

.. CG-EXPLANATION-END id=function:isMergeArtifactSeed

``function interpAcross``
-------------------------

.. CG-BLOCK id=function:interpAcross lines=264-301

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 264-301
   :lineno-match:

.. CG-EXPLANATION-START id=function:interpAcross

**What this does.** A straight-line interpolation of a per-column value across the section's x axis.

**Why it is here.** The void test needs the top-band and floor elevations at an arbitrary x between columns, which this reads off the two bracketing columns.

.. CG-EXPLANATION-END id=function:interpAcross

``function isExplicitVoidGeometric``
------------------------------------

.. CG-BLOCK id=function:isExplicitVoidGeometric lines=302-332

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 302-332
   :lineno-match:

.. CG-EXPLANATION-START id=function:isExplicitVoidGeometric

**What this does.** Returns whether a seedless face sits GEOMETRICALLY outside the fillable domain: entirely above the local top-band (the deliberately-empty strip between ground and first litho) or entirely below the deepest bracketing column's floor, tested conservatively at both x-extent ends.

**Why it is here.** The mandate: a void is a purely geometric fact, never "no old label" and never a guess below TD. A sub-TD face overlapping a real column's drilled elevation is fillable domain and, if seedless, is a defect, not a void — so the envelope test must be strict.

.. CG-EXPLANATION-END id=function:isExplicitVoidGeometric

``function classifyFaceSeed``
-----------------------------

.. CG-BLOCK id=function:classifyFaceSeed lines=333-372

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 333-372
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyFaceSeed

**What this does.** The shared entry point: for one face it collects the seed refs, resolves and deduplicates the formations, computes the bounds, and returns the classification — single-seed for one formation, multi-seed-defect for two or more, and for zero either explicit-void or zero-seed-defect depending on the geometric void test.

**Why it is here.** It is the single place both the gate and the paint path call, so the classification cannot differ between what the engine paints and what the gate checks.

.. CG-EXPLANATION-END id=function:classifyFaceSeed

``type ZeroSeedResolution``
---------------------------

.. CG-BLOCK id=type:ZeroSeedResolution lines=373-396

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 373-396
   :lineno-match:

.. CG-EXPLANATION-START id=type:ZeroSeedResolution

**What this does.** A type naming the four ways a zero-seed face can be legitimately owned: ``carry-seed`` (a substrate face), ``unterminated-litho`` (a flood face with one soil on its boundary), ``band-contour`` (a band or top-band contour face), or ``owner-ambiguous`` (undecided).

**Why it is here.** A zero-seed face carries no column seed but is usually not a defect — it is a doctrine-scaffold face already correctly painted by one of the fill doctrines. Recording which doctrine owns it drops the gate's unresolved tally to the genuinely undecided faces only, without changing any geometry or paint.

.. CG-EXPLANATION-END id=type:ZeroSeedResolution

``function resolveZeroSeedClass``
---------------------------------

.. CG-BLOCK id=function:resolveZeroSeedClass lines=397-427

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seedClassifier.ts
   :language: typescript
   :lines: 397-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveZeroSeedClass

**What this does.** Classifies a zero-seed face from its boundary curve ids alone: substrate curves make it carry-seed; flood or band-seam curves make it unterminated-litho when they resolve to exactly one soil and owner-ambiguous otherwise; band or surface contours make it band-contour; anything else is owner-ambiguous.

**Why it is here.** It encodes the fill doctrines' ownership. Ruling 8n makes a sub-TD substrate carry the seed (no column reaches there). Ruling 8o fills a hole with its single unterminated soil, and its own ask-clause makes zero or more than one soil owner-ambiguous, listed for the owner and never guessed. The mismatched midpoint seam is grouped with the flood curves so the classification stays byte-identical to when that seam was flood-prefixed.

.. CG-EXPLANATION-END id=function:resolveZeroSeedClass

