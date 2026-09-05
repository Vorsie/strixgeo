desktop.renderer.src.utils.sectionProjection
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionProjection.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionProjection.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the pure geometry behind a cross-section. For each investigation (a CPT or borehole) it works out where the point lands when dropped onto the straight section line: ``along`` — the distance from the section's start point measured along the line, in metres — and ``offset`` — the signed sideways distance from the line, whose sign tells which side of the line the point sits on. The comment also states the filter rules: a point too far to the side (outside the lateral buffer) is not projected at all, a point whose foot lands beyond either end of the line is skipped, and a column the engineer has explicitly hidden takes precedence.

**Why it is here.** The comment records the coordinate-system decision: the endpoints and the investigation points are both in the section's horizontal *CRS* — a coordinate reference system — named by an EPSG number (Lambert 72 for Belgium, RD New for the Netherlands), and distances are straight-line in that CRS. That is sound because both supported CRSes are projected metric systems with negligible distortion at a typical site scale under 10 km, so metres are meaningful. Note that ``along`` here is the raw projected distance; downstream the section renderer nudges columns apart for spacing, and every other section overlay must be drawn at the post-nudge column position, not at this raw along-distance (section-view spacing rule).

.. CG-EXPLANATION-END id=module-header

``interface SectionEndpoints``
------------------------------

.. CG-BLOCK id=interface:SectionEndpoints lines=33-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 33-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionEndpoints

**What this does.** A data shape — an *interface*, which is a note describing the fields a value must have — naming the section line by its start x/y and end x/y.

**Why it is here.** It groups the four numbers the projection math needs into one named argument so the functions below read cleanly.

.. CG-EXPLANATION-END id=interface:SectionEndpoints

``interface ProjectionResult``
------------------------------

.. CG-BLOCK id=interface:ProjectionResult lines=40-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 40-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectionResult

**What this does.** The result shape of a projection: ``along`` and ``offset`` in metres, with the note that a positive offset means the point lies to the left of the line direction. It is followed by the documentation for the projection function, which records that the function returns nothing (``null``) for a zero-length section.

**Why it is here.** The docstring records the reason for the null: the API already rejects zero-length sections when they are created or updated, but a defensive caller should not crash on a stale row that somehow has zero length, so it gets ``null`` instead of a divide-by-zero.

.. CG-EXPLANATION-END id=interface:ProjectionResult

``function projectPointOntoLine``
---------------------------------

.. CG-BLOCK id=function:projectPointOntoLine lines=54-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 54-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectPointOntoLine

**What this does.** The projection itself. It forms the line's direction, measures its squared length, and returns nothing if that is essentially zero. Otherwise it turns the direction into a unit-length arrow, forms the arrow from the start point to the investigation point, and returns ``along`` as the dot product (distance along the line) and ``offset`` as the 2-D cross product (the signed sideways distance).

**Why it is here.** The comment records the maths and the sign convention: because the direction is unit-length, the dot product is exactly the along-distance, and the cross product gives a signed offset with the same left-hand convention relative to the line direction that the offset indicators (S5) rely on to show engineers which side of the line an investigation lives on.

.. CG-EXPLANATION-END id=function:projectPointOntoLine

``function sectionLength``
--------------------------

.. CG-BLOCK id=function:sectionLength lines=78-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 78-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionLength

**What this does.** Returns the straight-line length of the section in metres, then documents ``projectionFoot`` below — the world point on the line at a given along-distance, used by the map to draw leader lines.

**Why it is here.** The length is meaningful in metres because the endpoints are in a projected metric CRS; the documented ``projectionFoot`` returns nothing only for a zero-length section, the same defensive guard as above.

.. CG-EXPLANATION-END id=function:sectionLength

``function projectionFoot``
---------------------------

.. CG-BLOCK id=function:projectionFoot lines=93-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 93-112
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectionFoot

**What this does.** Returns the real-world x/y of the point that sits on the section line at ``along`` metres from the start — the start point plus ``along`` times the unit direction — or nothing for a zero-length line. It is followed by the divider comment that introduces the investigation filter below.

**Why it is here.** The docstring records the use: the map's leader-line renderer draws a thin grey segment from each investigation's true position to this foot point, so the engineer can see where each column was pulled onto the line.

.. CG-EXPLANATION-END id=function:projectionFoot

``interface InvestigationPoint``
--------------------------------

.. CG-BLOCK id=interface:InvestigationPoint lines=113-118

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 113-118
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InvestigationPoint

**What this does.** The smallest shape an investigation needs to be projected — an id plus its x/y location.

**Why it is here.** Keeping the required fields minimal means any record that has a location can be filtered onto a section, not only a fully-loaded CPT or borehole.

.. CG-EXPLANATION-END id=interface:InvestigationPoint

``interface ProjectedInvestigation``
------------------------------------

.. CG-BLOCK id=interface:ProjectedInvestigation lines=119-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 119-134
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectedInvestigation

**What this does.** The per-item result of the filter — the original item carried through unchanged, plus its ``along`` and ``offset``. It is followed by the documentation for the filter, which says it keeps only the points that project onto the section's span and within the lateral buffer, and returns their projected coordinates so callers do not have to redo the maths at draw time.

**Why it is here.** The ``<T>`` is a *generic type* — a placeholder for whatever kind of item is passed in — so one filter serves CPTs, boreholes, or anything with a location; the docstring records that the output order matches the input order and callers sort by ``along`` when they want a left-to-right render.

.. CG-EXPLANATION-END id=interface:ProjectedInvestigation

``function investigationsOnSection``
------------------------------------

.. CG-BLOCK id=function:investigationsOnSection lines=135-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionProjection.ts
   :language: typescript
   :lines: 135-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:investigationsOnSection

**What this does.** The filter. It measures the section length (returning an empty list if zero), then for each item it skips any explicitly-excluded id, projects the point, and drops it if the projection failed, if its along-distance falls outside the line's span, or if its sideways distance exceeds the section's buffer; whatever survives is returned together with its projected coordinates.

**Why it is here.** The comments record each rule: explicit hides chosen by the engineer take precedence, the buffer keeps only investigations near the line, and the span check drops feet that land beyond either endpoint (the DOV-style "extend the line" behaviour is noted as a possible later section-level preference).

.. CG-EXPLANATION-END id=function:investigationsOnSection

