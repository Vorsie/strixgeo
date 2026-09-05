desktop.renderer.src.utils.fencePanels
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/fencePanels.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/fencePanels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fencePanels.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for turning partition regions into 3-D wall panels: the partition point type, the polygon triangulation helper, and the section projection helpers.

**Why it is here.** The panels are built by projecting 2-D partition geometry into world space and triangulating it, so this file pulls in exactly those two capabilities.

.. CG-EXPLANATION-END id=module-header

``interface FenceColumn``
-------------------------

.. CG-BLOCK id=interface:FenceColumn lines=7-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fencePanels.ts
   :language: typescript
   :lines: 7-22
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceColumn

**What this does.** Describes one section column: an investigation id, its along-section position in metres, and an optional canonical world position at which it should be drawn.

**Why it is here.** The comment records why the optional world position exists: a tie-section anchors each end at the cross-section column of the same test so a tie rung snaps onto the cross-section wall (dogfeed 2026-06-10), while a cross-section leaves it unset and is drawn by projecting its along position — so the change is inert there.

.. CG-EXPLANATION-END id=interface:FenceColumn

``interface FenceRegion``
-------------------------

.. CG-BLOCK id=interface:FenceRegion lines=23-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fencePanels.ts
   :language: typescript
   :lines: 23-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceRegion

**What this does.** Describes a partition region carrying which gap it sits in: its formation and body ids, the ids of the layers that produced it, the left column's index, and its outline as gap-fraction-and-elevation points.

**Why it is here.** The comment records that the layer ids are the label-independent identity currency, carried so a consumer can resolve a panel's true body through the layers rather than the body label, which the weld mints locally and the recompute later rewrites.

.. CG-EXPLANATION-END id=interface:FenceRegion

``interface FencePanel``
------------------------

.. CG-BLOCK id=interface:FencePanel lines=46-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fencePanels.ts
   :language: typescript
   :lines: 46-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FencePanel

**What this does.** Describes one filled wall panel in world coordinates: its formation and body ids, its optional source layer ids, its vertices as x-y-elevation metres, and the triangle indices into them. The block also shows the builder's documentation of how a region becomes a panel.

**Why it is here.** The comment records that the vertex convention matches the formation-surface response so downstream 3-D code treats fence panels and surfaces alike, and that the layer ids field is additive and optional in keeping with the additive-only contract.

.. CG-EXPLANATION-END id=interface:FencePanel

``function buildFencePanels``
-----------------------------

.. CG-BLOCK id=function:buildFencePanels lines=84-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fencePanels.ts
   :language: typescript
   :lines: 84-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFencePanels

**What this does.** Turns each partition region into a world-space wall panel. For a region in a gap it takes the left and right bounding columns, resolves each to a world position (its canonical position if set, otherwise the foot of its along position on the section line), then places each outline point by interpolating horizontally between the two columns by its fraction and using its elevation as the height. It triangulates in the panel's own flat 2-D plane and reuses those triangle indices for the 3-D vertices, skipping any region that lacks a valid column pair or enough vertices.

**Why it is here.** The docstring records that triangulating in the flat plane is concave-safe and valid to reuse for the 3-D vertices because the panel is planar, and that for a cross-section the two world points lie on the section line so interpolating between them is identical to projecting the along position — the world-position path is inert there and only changes tie sections.

.. CG-EXPLANATION-END id=function:buildFencePanels

