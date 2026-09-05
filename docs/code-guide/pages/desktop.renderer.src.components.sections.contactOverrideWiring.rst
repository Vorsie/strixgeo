desktop.renderer.src.components.sections.contactOverrideWiring
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/contactOverrideWiring.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/contactOverrideWiring.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the pure module that bridges the app to the partition engine for a matched two-band contact free-draw: given a gap's two columns and the stored boundary control nodes, it produces the shared-contact bend overrides the engine consumes. It imports the boundary-node types, the contact override key helper, and the partition types.

**Why it is here.** The docstring records the root reason: a horizontal contact between two full-width bands is shaped by a node the app stores on the upper band body's lower nodes, and the engine now re-partitions BOTH bands from a single shared-contact override so both faces re-derive from the one bent boundary with no holes or overlaps by construction. The app must feed that override instead of the old off-engine single-body reshape, which grew the upper band and left the lower band's top in place.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_MATCH_M``
-------------------------

.. CG-BLOCK id=const:CONTACT_MATCH_M lines=27-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 27-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_MATCH_M

**What this does.** The elevation match tolerance in metres, one millimetre, for deciding two contacts sit at the same level.

**Why it is here.** The comment: the units are pre-arrangement-snap, so a small tolerance is needed to match a lower band's top to the upper band's base.

.. CG-EXPLANATION-END id=const:CONTACT_MATCH_M

``interface ContactDragState``
------------------------------

.. CG-BLOCK id=interface:ContactDragState lines=30-74

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 30-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactDragState

**What this does.** The named shape of the live boundary-drag fields this module reads: the upper and lower body ids, the node index, the cursor x and y, the gap's left and right screen edges, and an is-new flag.

**Why it is here.** The comment on the is-new flag: when a drag CREATED the node on mousedown it is not yet stored, so the override must synthesize the control point from the cursor so the new bend reshapes on the same press-drag; without it, the new node would not render until it persisted (the old two-step gesture).

.. CG-EXPLANATION-END id=interface:ContactDragState

``function classifyFreeDrawTarget``
-----------------------------------

.. CG-BLOCK id=function:classifyFreeDrawTarget lines=75-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 75-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyFreeDrawTarget

**What this does.** Classifies a free-draw click target as a two-sided contact or a one-sided apex: a body present in BOTH gap columns is a full-width band whose base is a shared contact; a body present in only one column terminates inside the gap as a one-sided lens or onlap tip.

**Why it is here.** The docstring: the protocol distinction the free-draw tool must honour is that a shared contact is shaped by a contact override and a one-sided tip by an apex override, and merging them by a hit-test heuristic is exactly what the repair forbids — so the target is classified before an override is generated.

.. CG-EXPLANATION-END id=function:classifyFreeDrawTarget

``function unitTopElev``
------------------------

.. CG-BLOCK id=function:unitTopElev lines=86-90

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 86-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitTopElev

**What this does.** Returns the absolute elevation in metres TAW of a unit's top contact, from the column's surface elevation minus the unit's top depth.

**Why it is here.** A one-line helper so the depth-to-elevation conversion for a unit top is written once.

.. CG-EXPLANATION-END id=function:unitTopElev

``function unitBaseElev``
-------------------------

.. CG-BLOCK id=function:unitBaseElev lines=91-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 91-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitBaseElev

**What this does.** Same as the top helper, for a unit's base contact.

**Why it is here.** Same shape as the top helper above, for the base contact instead of the top.

.. CG-EXPLANATION-END id=function:unitBaseElev

``function bodyBaseElev``
-------------------------

.. CG-BLOCK id=function:bodyBaseElev lines=99-111

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 99-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyBaseElev

**What this does.** Returns the base elevation of a body across the two columns — the lowest of its unit bases, its own floor — or null when the body has no unit in either column.

**Why it is here.** The upper band's base is where the lower band's top sits, so finding that base is the first step in locating the two bands a contact bend joins.

.. CG-EXPLANATION-END id=function:bodyBaseElev

``function lowerBodyAtContact``
-------------------------------

.. CG-BLOCK id=function:lowerBodyAtContact lines=112-175

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 112-175
   :lineno-match:

.. CG-EXPLANATION-START id=function:lowerBodyAtContact

**What this does.** Finds the lower body of a two-band contact: the body (other than the upper one) whose top contact sits at the given contact elevation across either column, returning the first match or null when no band sits directly below.

**Why it is here.** The comment: the elevation-set match in the engine handles the rest, so returning the first match here is enough to identify which lower band the shared boundary belongs to.

.. CG-EXPLANATION-END id=function:lowerBodyAtContact

``function collectContactOverridesForGap``
------------------------------------------

.. CG-BLOCK id=function:collectContactOverridesForGap lines=176-266

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactOverrideWiring.ts
   :language: typescript
   :lines: 176-266
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectContactOverridesForGap

**What this does.** The main function. For one gap it finds the bodies present on both columns (full-width bands), and for each — unless it is already being handled as a lens tip — it finds the natural base contact and the lower band beneath, takes the first stored in-gap control node (or synthesizes one from the cursor for a new-node drag), applies the live drag position, and writes a shared-contact bend override keyed by the upper and lower body ids and gap. It returns the set of upper-body ids whose contact it overrode.

**Why it is here.** The comments record the safeguards: it skips a body already applied as a lens apex so the same node is never applied twice (once as a lens tip, once as a shared-contact bend); it proceeds with empty stored nodes only for a new-node drag on this exact contact so the new bend reshapes on the same press; and it writes nothing when there is no stored node and no new-node drag, keeping the output byte-identical for a clean gap. The returned set lets the caller turn the old off-engine reshape off for these contacts.

.. CG-EXPLANATION-END id=function:collectContactOverridesForGap

