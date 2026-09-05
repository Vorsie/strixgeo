desktop.renderer.src.utils.geotechHierarchicalFill.constructive.onlapClosure
============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a module — one file of related code. It first imports (borrows) two data shapes from elsewhere: ``ProbeEntry``, the fill engine's own record of what each band drew in each gap, and ``SectionRegion``, one painted shape the section shows. It then defines the whole of a safety check. Recall the 2/1/0 rule: a packing band with two correlation ties (lines the engineer draws tying one column's contact to the next) runs straight across the gap between two test columns as a rectangle; a band with one tie follows that tied contact and pinches to a point on its free side — an onlap, which must be a triangle; and a band with no ties closes inside the gap as a lens. This module catches two ways an onlap can come out wrong: one where the wedge ends in a vertical wall part-way across the gap instead of closing to a point, and its sibling where a band drew its closed shape correctly but then owned no ground on screen because a neighbour took it.

**Why it is here.** It exists because the owner reported the same broken shape five times — a wedge squared off into a rectangle — and each earlier fix only moved which shape owned the offending piece, so a sixth report was always waiting. The docstring records the owner's two rulings that together define the invariant: 2026-08-22, "The loose sand has a bottom tie, not a top tie that is why it is an onlap and should be a triangle and not a quad", and 2026-08-20, "an onlap can't paint over ground near test itself, it terminates at 0.5 Distance approximately". A vertical wall between two OPEN masses is deliberately legal — it is the law's own mid-gap seam — so the check only ever looks at masses that actually emitted an onlap, and it reads the merged shapes the render draws rather than the raw ones, because that weld is exactly what the owner sees.

.. CG-EXPLANATION-END id=module-header

``const INTERIOR_VERTICAL_MIN_DROP``
------------------------------------

.. CG-BLOCK id=const:INTERIOR_VERTICAL_MIN_DROP lines=56-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 56-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:INTERIOR_VERTICAL_MIN_DROP

**What this does.** A constant (a fixed named value): the smallest vertical drop, five centimetres, that a wall must span before this check counts it as a real wall rather than rounding noise.

**Why it is here.** Shapes carry their corners on a millimetre grid, so a welded outline routinely closes with a sub-centimetre riser that means nothing, while the owner's real reports are decimetres to metres tall. Five centimetres sits an order of magnitude below the smallest genuine report (0.36 m) and an order above the grid noise.

.. CG-EXPLANATION-END id=const:INTERIOR_VERTICAL_MIN_DROP

``const EDGE_EPS``
------------------

.. CG-BLOCK id=const:EDGE_EPS lines=59-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 59-69
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_EPS

**What this does.** A tiny tolerance deciding how far inside a gap a wall must sit — away from the 0 and 1 column edges — to count as interior rather than sitting on a column.

**Why it is here.** A wall standing exactly at a test column is a band's own face, not the defect this check hunts, so the tolerance keeps those column-edge walls out.

.. CG-EXPLANATION-END id=const:EDGE_EPS

``const TERMINATION_EPS``
-------------------------

.. CG-BLOCK id=const:TERMINATION_EPS lines=70-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 70-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:TERMINATION_EPS

**What this does.** A small tolerance, one part in a thousand of the gap, for deciding whether a wall stands at an onlap's own closing point.

**Why it is here.** The closing point is a single computed fraction the arrangement places exactly, so this only has to absorb millimetre-grid rounding, not search a neighbourhood — any wider and the ordinary seam between two unrelated masses would start reading as a broken onlap.

.. CG-EXPLANATION-END id=const:TERMINATION_EPS

``interface InteriorVertical``
------------------------------

.. CG-BLOCK id=interface:InteriorVertical lines=73-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 73-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InteriorVertical

**What this does.** A named data shape — an interface, TypeScript's word for the list of fields a value carries — describing one vertical edge found strictly inside a gap: where it stands across the gap as a fraction (0 at the left column, 1 at the right), and its lower and upper elevations in metres TAW.

**Why it is here.** It is the small record the wall-finder hands back, so its caller can report exactly where a suspect wall is.

.. CG-EXPLANATION-END id=interface:InteriorVertical

``interface OnlapClosureViolation``
-----------------------------------

.. CG-BLOCK id=interface:OnlapClosureViolation lines=82-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 82-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OnlapClosureViolation

**What this does.** The data shape for one reported defect: which gap it is in, which litho formation the offending region is, the onlap-emitting bands it carries, and the interior wall itself.

**Why it is here.** It packages everything an engineer needs to find the broken triangle on screen — the same idea as the shape above, for a whole violation instead of a bare edge.

.. CG-EXPLANATION-END id=interface:OnlapClosureViolation

``interface SilentConstruct``
-----------------------------

.. CG-BLOCK id=interface:SilentConstruct lines=91-121

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 91-121
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SilentConstruct

**What this does.** The data shape for the sibling defect: a band that drew a closed shape (an onlap or a lens) whose point falls inside the gap yet owns no painted ground — carrying the gap index, the band's id, what it emitted, and where its point sits.

**Why it is here.** The 2026-08-26 dogfeed was exactly this — S6's loose sand emitted its onlap, the record showed it, but the medium sand beside it took the whole wedge, so there was no wall to find and nothing for the other check to report. This record makes that silence visible.

.. CG-EXPLANATION-END id=interface:SilentConstruct

``function silentConstructs``
-----------------------------

.. CG-BLOCK id=function:silentConstructs lines=122-151

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 122-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:silentConstructs

**What this does.** A function (a named, reusable step). Given the fill run's own per-gap records, it returns every band that emitted a closed shape whose point sits strictly inside its gap yet owns not one painted face. It walks each gap's records, collects which bands actually own a face there, and flags any onlap or lens whose point is interior but whose id is missing from the owners.

**Why it is here.** Owner, 2026-08-22: "where a band's own construct speaks, it speaks completely" — a lens or onlap that closes inside the gap holds real ground from its own column to its point, so owning zero faces means the ground silently went to somebody else. Two cases are skipped because the band genuinely has no wedge here: a stacked-seam run, which answers from the tests' own stacks and consults no construct, and an extended construct whose point is the far column and closes in some other gap.

.. CG-EXPLANATION-END id=function:silentConstructs

``function interiorVerticals``
------------------------------

.. CG-BLOCK id=function:interiorVerticals lines=152-181

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 152-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:interiorVerticals

**What this does.** Given one region's outline as a ring of points, it returns the vertical edges of that ring that stand strictly inside the gap and span more than the minimum drop. It walks each pair of neighbouring points, keeps only near-vertical pairs, drops the ones at the column edges, and drops the ones too short to matter.

**Why it is here.** It is the geometric worker the closure check needs — the pure detector of "this outline has a wall here" — kept separate so the meaning-laden test can stay short.

.. CG-EXPLANATION-END id=function:interiorVerticals

``function onlapTerminationsByGap``
-----------------------------------

.. CG-BLOCK id=function:onlapTerminationsByGap lines=182-213

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 182-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:onlapTerminationsByGap

**What this does.** Reads the fill's own records and builds a lookup: for each gap, which band closed its onlap and at what fraction across the gap it closed. Stacked-seam runs are left out entirely.

**Why it is here.** The closure check must know where each onlap was SUPPOSED to pinch to a point before it can tell whether a wall stands at that exact spot. Stacked-seam runs are excluded because the vertical there is the owner-accepted "keep mtaw lvl" fallback of 2026-08-25, never a defect.

.. CG-EXPLANATION-END id=function:onlapTerminationsByGap

``function onlapClosureViolations``
-----------------------------------

.. CG-BLOCK id=function:onlapClosureViolations lines=214-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapClosure.ts
   :language: typescript
   :lines: 214-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:onlapClosureViolations

**What this does.** The top-level check. Given the merged regions the render draws and the per-gap map of where each onlap closes, it returns every onlap that ends in a vertical face right at its own closing point. For each region it finds the onlap-bands it carries, looks for interior walls, and reports a wall only where it coincides with one of those bands' termination fraction.

**Why it is here.** The invariant is deliberately narrow — a vertical face is only a defect where a wedge that should have closed to a point instead squared off. A vertical anywhere else is a band standing at its own test, or the law's legal mid-gap seam between two open masses, and "if it is different then vertical line in the middle" (the owner's own words) is none of this rule's business.

.. CG-EXPLANATION-END id=function:onlapClosureViolations

