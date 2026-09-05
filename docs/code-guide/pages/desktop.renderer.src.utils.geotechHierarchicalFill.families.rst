desktop.renderer.src.utils.geotechHierarchicalFill.families
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module works out the litho FAMILIES of one section — a family being the chain of litho units that read as ONE mass on this section, the thing the owner means by "a litho". Two facts join units into a family: an approved litho correlation the engineer drew, and two units bounding the same painted litho region (the engine already welded them). Every litho region is then attributed to exactly one family. It imports the correlation-edge, column and region shapes.

**Why it is here.** The hierarchical fill runs the partition engine once per family, so a family must be exactly a body of one soil. A region painted with no unit of its own formation bounding it — substrate below every log — is attributed to the nearest family of ITS OWN formation on the gap's two columns, never to another soil's family. This keeps the families' outputs tiling without overlap, because the litho partition is a true tiling and each face belongs to one chain.

.. CG-EXPLANATION-END id=module-header

``interface LithoFamily``
-------------------------

.. CG-BLOCK id=interface:LithoFamily lines=30-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts
   :language: typescript
   :lines: 30-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoFamily

**What this does.** The data shape for one litho body on this section: a stable id (the alphabetically first member layer id), the set of all its member layer ids, and its own litho regions grouped by gap.

**Why it is here.** It is the unit the fill runs once per, so it carries both the membership and the geometry the run needs.

.. CG-EXPLANATION-END id=interface:LithoFamily

``interface LithoFamilySplit``
------------------------------

.. CG-BLOCK id=interface:LithoFamilySplit lines=40-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts
   :language: typescript
   :lines: 40-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoFamilySplit

**What this does.** The result of splitting a section's litho frame: the list of families, a lookup from each litho layer to its family, and the regions no family could claim.

**Why it is here.** The caller needs all three — the families to fill, the lookup to route bands, and the unclaimed regions to render as bare litho.

.. CG-EXPLANATION-END id=interface:LithoFamilySplit

``class DisjointSet``
---------------------

.. CG-BLOCK id=class:DisjointSet lines=49-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts
   :language: typescript
   :lines: 49-82
   :lineno-match:

.. CG-EXPLANATION-START id=class:DisjointSet

**What this does.** A class (a bundle of data with the operations on it) implementing union-find — a standard tool for grouping things that are linked directly or through a chain. It can find a member's group, ask whether a member is known, and union two members into one group.

**Why it is here.** Grouping units into families is exactly a connected-components problem — unit A ties to B, B ties to C, so A, B and C are one family — and union-find is the direct, well-worn way to compute that.

.. CG-EXPLANATION-END id=class:DisjointSet

``function buildLithoFamilies``
-------------------------------

.. CG-BLOCK id=function:buildLithoFamilies lines=83-227

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/families.ts
   :language: typescript
   :lines: 83-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoFamilies

**What this does.** Splits a section's litho frame into families and attributes every region. It seeds the union-find with the drilled units, unions units joined by a same-soil approved correlation, unions units bounding the same region, names each family by its alphabetically first member, then attributes each region — to a named bounding unit whose extent actually meets the region, else to the nearest same-formation unit on the gap's two columns, else to the unattributed pile.

**Why it is here.** Only SAME-lithology correlations weld a family — the body resolver's own rule — because the engineer draws cross-soil correlations deliberately to state a contact, not one body, and welding across one chained the whole of CS1 (67 of 142 units, three lithologies) into a single family, exactly the whole-section run this construction replaces. The docstring records the attribution subtlety: a merged same-soil sandwich keeps only the top piece's id, so a named unit is trusted only when its own extent meets the region, otherwise the geometric pick answers — which stopped a silt unit's cover on CS1 gap 5 being painted from bands two gaps away.

.. CG-EXPLANATION-END id=function:buildLithoFamilies

