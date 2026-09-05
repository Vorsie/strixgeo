desktop.renderer.src.utils.sectionPartition.types
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/types.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/types.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is a module: one source file the program loads as a unit. It holds the shared vocabulary of the partition fill, meaning the named data shapes every other file speaks in. A ``type`` or an ``interface`` here is a TypeScript declaration that names the shape of a piece of data (which fields it has and of what kind); it is a description, it computes nothing. The comment at the top records that these shapes were lifted out of the old single ``partitionFill.ts`` file verbatim, so the vocabulary could be shared without dragging the engine along.

**Why it is here.** The shapes were extracted into their own file under debt #201 (a campaign to break up over-large files). Keeping the vocabulary in one small module means the litho engine, the geotech fill, the overlay that draws the section and the 3-D build all refer to the exact same field names, so none can drift from another.

.. CG-EXPLANATION-END id=module-header

``interface PartitionUnit``
---------------------------

.. CG-BLOCK id=interface:PartitionUnit lines=5-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 5-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PartitionUnit

**What this does.** One unit on a column: a single accepted litho layer, measured as a top and base DEPTH below the ground surface in metres. It also carries its ``formationId`` (which fixes the fill colour, i.e. the soil), a ``bodyId`` (which continuous mass of soil it belongs to), a ``layerId`` (the database id of the layer), and an optional ``virtual`` flag.

**Why it is here.** The two identity fields are deliberately different because they are trusted for different things, and the docstring is emphatic about it: ``bodyId`` is kept only for naming a region (the resolver over-lumps it, joining one body across several lithologies), while banding decisions use ``layerId`` and the explicit correlation edges instead — two units join into a band only when an approved correlation line connects their ``layerId``s. The ``virtual`` flag marks a geometry-only extension injected below a shallow neighbour's drilled depth; it is given a ``virtual:`` id prefix so no correlation edge can ever match it.

.. CG-EXPLANATION-END id=interface:PartitionUnit

``interface PartitionColumn``
-----------------------------

.. CG-BLOCK id=interface:PartitionColumn lines=36-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 36-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PartitionColumn

**What this does.** One investigation drawn as a column: its id, its surface elevation in metres TAW (the Belgian height datum), and its stack of units sorted from top to bottom. The surface elevation is what converts a unit's depth-below-surface into an absolute elevation.

**Why it is here.** The section is drawn between columns, so the column — an id, where its ground surface sits, and its ordered soil stack — is the atom every later step reads. Sorting the units top-to-bottom is assumed by the tiling that follows.

.. CG-EXPLANATION-END id=interface:PartitionColumn

``interface CorrelationEdge``
-----------------------------

.. CG-BLOCK id=interface:CorrelationEdge lines=61-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 61-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CorrelationEdge

**What this does.** An approved correlation: a pair of layer ids the engineer (or the auto-correlator) explicitly tied together, plus which SIDE of each layer's contact the tie joins — its top contact (the default when the side is omitted) or its base contact. The docstring spells out the three tie meanings: a top-tie (both tops) makes the standard flat band; a base-tie (both bases) lets the deepest unit, which has no layer below it, band across a gap; a mixed tie (one top, one base) makes a rising triangle rather than a flat rectangle.

**Why it is here.** A correlation edge is the trustworthy signal that two units are the same body across a gap — this is the ``2`` in the owner's 2/1/0 rule, where two tied bounding contacts make a band. The docstring stresses this is trusted over the resolver's ``body_id`` because ``body_id`` over-lumps. The side-awareness exists because a deepest unit's base is otherwise unaddressable, and because the spec's rule 2 requires a mixed tie to draw a rising triangle.

.. CG-EXPLANATION-END id=interface:CorrelationEdge

``const EPS``
-------------

.. CG-BLOCK id=const:EPS lines=70-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 70-77
   :lineno-match:

.. CG-EXPLANATION-START id=const:EPS

**What this does.** A single very small number (0.000000001) used as a tolerance when comparing two elevations for overlap.

**Why it is here.** Elevations are floating-point numbers, so two values that should be equal can differ in their last bits; comparing with a tiny tolerance instead of exact equality stops that noise from being read as a real overlap or gap.

.. CG-EXPLANATION-END id=const:EPS

``const LENS_PINCH_FRACTION``
-----------------------------

.. CG-BLOCK id=const:LENS_PINCH_FRACTION lines=78-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 78-86
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_PINCH_FRACTION

**What this does.** The fraction of the way across a gap (0.45) at which an enclosed lens tapers to its pinch-out point. A fraction is a position from 0 at the left column to 1 at the right column, so 0.45 means the lens narrows to a tip at 45 percent of the way across.

**Why it is here.** This is the shape of the ``0`` in the 2/1/0 rule: a unit with no ties to the neighbour closes off inside the gap as a lens. The value is the default reach; the docstring notes the engineer can later override it per lens with the freedraw apex handle.

.. CG-EXPLANATION-END id=const:LENS_PINCH_FRACTION

``const INTERIOR_PINCH_FRACTION``
---------------------------------

.. CG-BLOCK id=const:INTERIOR_PINCH_FRACTION lines=87-96

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 87-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:INTERIOR_PINCH_FRACTION

**What this does.** The fraction of the way across a gap (0.5, i.e. halfway) at which a lone interior pinch tapers to its tip.

**Why it is here.** Owner directive 2026-06-07: a unit that thins out mid-gap should reach a point halfway and let the enclosing soil close up beyond it, rather than running all the way to the neighbour (the old drooping pinch). Like the lens value it is a default that a freedraw handle can reshape.

.. CG-EXPLANATION-END id=const:INTERIOR_PINCH_FRACTION

``interface LensApexOverride``
------------------------------

.. CG-BLOCK id=interface:LensApexOverride lines=97-131

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 97-131
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LensApexOverride

**What this does.** A hand override for where a lens's pinch point sits: a horizontal ``fraction`` across the gap and an ``elevation`` in metres TAW, replacing the automatic default. It can also carry a full multi-point freedraw shape (ordered points along the lens's upper and lower edges) and a ``rawApexFraction`` recording where the user actually dragged the tip before it was clamped to stay visible.

**Why it is here.** Dogfeed 2026-06-05: the engineer must be able to set how far a lens reaches and at what depth. The freedraw points exist (per the docstring) so a hand-drawn lens is clipped to its enclosing soil (rides the seam) instead of crossing it. ``rawApexFraction`` was added and owner-locked 2026-07-23 to tell an over-reach apart from a valid in-gap reshape: the visible clamp discards whether the tip was dragged past a column edge, so the raw value is kept to drive the collapse-invalid-snapback rule.

.. CG-EXPLANATION-END id=interface:LensApexOverride

``function lensApexOverrideKey``
--------------------------------

.. CG-BLOCK id=function:lensApexOverrideKey lines=132-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 132-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensApexOverrideKey

**What this does.** Builds the lookup key for a lens override by joining the body id and the gap index into one string.

**Why it is here.** A lens body that pinches into two gaps has an independent apex in each, so the docstring requires the override be keyed per body-and-gap; a body-only key would let one gap's apex overwrite the other and leave a mismatched notch in the enclosing soil.

.. CG-EXPLANATION-END id=function:lensApexOverrideKey

``interface PartitionPoint``
----------------------------

.. CG-BLOCK id=interface:PartitionPoint lines=141-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 141-153
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PartitionPoint

**What this does.** A single point in the section's output space: a ``fraction`` from 0 (left column) to 1 (right column) and an absolute ``elevation`` in metres TAW.

**Why it is here.** The whole partition is expressed in this fraction-by-elevation space; the overlay that draws the section is what turns each such point into a screen pixel.

.. CG-EXPLANATION-END id=interface:PartitionPoint

``interface PartitionRegion``
-----------------------------

.. CG-BLOCK id=interface:PartitionRegion lines=154-227

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 154-227
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PartitionRegion

**What this does.** One filled patch of the partition: its soil (``formationId``), its body, a ``kind`` that is ``quad`` (present on both columns, a four-corner shape), ``pinch`` (present on one column, tapering to meet inside the gap), or ``lens`` (an enclosed pinch-out that overlays its surrounding soil), and its closed polygon ring. Several optional fields carry extra facts: which carve tier a lens belongs to, a tied band's true base, whether it was clipped at a sloping tie, a diagnostic source tag, a ``fallback`` flag for inferred fill, and the ``layerIds`` that produced the paint.

**Why it is here.** This is the currency the fill hands to every consumer, so each optional field records a decision that a downstream step must respect: ``tiedBandBase`` keeps an explicit user correlation from being chopped flat (owner directive 2026-07-08, a user correlation is absolute); ``fallback`` and ``layerIds`` keep inferred fill out of the persisted body identity, added because feeding body-labelled evidence back on itself made the facts oscillate live (dogfeed 2026-08-12). The optionals are absent-when-empty so older consumers that compare regions exactly are untouched.

.. CG-EXPLANATION-END id=interface:PartitionRegion

``interface Interface``
-----------------------

.. CG-BLOCK id=interface:Interface lines=228-233

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 228-233
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Interface

**What this does.** A tiny shape naming one horizontal interface line by the depth it sits at on the left column and the depth on the right column.

**Why it is here.** A small internal shape the tiling passes around: it pairs one contact line's depth on the left column with its depth on the right. It is not part of the engine's public output.

.. CG-EXPLANATION-END id=interface:Interface

``interface PinchUnit``
-----------------------

.. CG-BLOCK id=interface:PinchUnit lines=234-254

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 234-254
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PinchUnit

**What this does.** A unit waiting to be placed inside an interval as a pinch: its soil and body, its ``layerId``, which side of the gap it is on, and its own top and base depths.

**Why it is here.** The docstring records that the ``layerId`` is carried so a later step can ask whether this unit is correlated to a reaching neighbour beyond a data void — the band-versus-lens decision (owner directive 2026-06-16).

.. CG-EXPLANATION-END id=interface:PinchUnit

``interface ExtractedLens``
---------------------------

.. CG-BLOCK id=interface:ExtractedLens lines=255-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/types.ts
   :language: typescript
   :lines: 255-278
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ExtractedLens

**What this does.** A lens that has been pulled out of a column: its body (null when its minority was never correlated), soil, and top and base depths. It stores no left/right side.

**Why it is here.** The docstring explains the side is decided at draw time, not stored: a column's lens is a left lens in the gap to its right and a right lens in the gap to its left, so fixing a side here would be wrong for one of the two gaps.

.. CG-EXPLANATION-END id=interface:ExtractedLens

