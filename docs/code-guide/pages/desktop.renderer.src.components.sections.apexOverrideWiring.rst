desktop.renderer.src.components.sections.apexOverrideWiring
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/apexOverrideWiring.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/apexOverrideWiring.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the pure module that bridges the app to the partition engine for lens apex shaping — building the per-body, per-gap lens-tip overrides and the matched two-band contact overrides the engine consumes. It imports the boundary types, the lens-apex override types and key helper, the contact-override helper next door, and a shapeable-region test.

**Why it is here.** The docstring records the root cause it fixes (section 88): the engine reshape tests fed an override map directly to the engine, bypassing the app's own gate, which is exactly why a 'manual reshape does nothing' bug hid behind green tests — the app never built the override for a two-sided band's lens tip because the gate that builds one-sided lens tips skips a full-width band. The fix adds the dragged two-sided body back in for its lens tip and disentangles it from the contact path so the same node is never applied twice.

.. CG-EXPLANATION-END id=module-header

``const NODE_OWN_EPS``
----------------------

.. CG-BLOCK id=const:NODE_OWN_EPS lines=40-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:NODE_OWN_EPS

**What this does.** The ownership tolerance in screen pixels for deciding whether a boundary node belongs to a gap — a node within this distance of a gap edge still counts as owned.

**Why it is here.** The comment: it mirrors the overlay's own value and is kept in sync, because a sub-pixel change either way is a render seam, not a functional change.

.. CG-EXPLANATION-END id=const:NODE_OWN_EPS

``const CONTACT_MATCH_M``
-------------------------

.. CG-BLOCK id=const:CONTACT_MATCH_M lines=43-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 43-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_MATCH_M

**What this does.** The elevation match tolerance in metres, one millimetre, for the lens-tip span membership test.

**Why it is here.** A small tolerance is needed to decide whether a stored node's elevation sits inside a lens tip's elevation span.

.. CG-EXPLANATION-END id=const:CONTACT_MATCH_M

``const clamp01``
-----------------

.. CG-BLOCK id=const:clamp01 lines=46-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 46-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:clamp01

**What this does.** A tiny helper that clamps a value into the range 0 to 1.

**Why it is here.** A fraction along a gap must never fall outside 0 (the left column) to 1 (the right column), so this keeps every computed fraction in range.

.. CG-EXPLANATION-END id=const:clamp01

``const MIN_VISIBLE_APEX_FRACTION``
-----------------------------------

.. CG-BLOCK id=const:MIN_VISIBLE_APEX_FRACTION lines=53-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 53-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_VISIBLE_APEX_FRACTION

**What this does.** The minimum visible lens-tip reach, 8 percent of the gap from either anchored side.

**Why it is here.** The comment (section 72): flooring the apex fraction so a click near a column face can never pinch the lens to a hairline sliver; it mirrors the overlay's own clamp.

.. CG-EXPLANATION-END id=const:MIN_VISIBLE_APEX_FRACTION

``const clampVisibleApex``
--------------------------

.. CG-BLOCK id=const:clampVisibleApex lines=54-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 54-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:clampVisibleApex

**What this does.** A helper that clamps an apex fraction to the visible reach floor on both sides.

**Why it is here.** Same reason as the minimum-fraction constant above — it keeps a lens tip visible whether it is anchored on the left or the right.

.. CG-EXPLANATION-END id=const:clampVisibleApex

``interface LensDragState``
---------------------------

.. CG-BLOCK id=interface:LensDragState lines=58-78

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 58-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LensDragState

**What this does.** The named shape of the live lens-drag fields this module reads: the body id, gap index, which edge (upper or lower), the node index, the gap's left screen x, the cursor x and y, and an is-new flag.

**Why it is here.** The comment on the is-new flag: a node created on the mousedown press is not yet stored, so the live override must inject the dragged node from the cursor so a brand-new node reshapes on the same press-drag rather than needing the old two-step gesture.

.. CG-EXPLANATION-END id=interface:LensDragState

``interface GapExtent``
-----------------------

.. CG-BLOCK id=interface:GapExtent lines=79-84

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 79-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapExtent

**What this does.** The named shape of one gap's screen x-extent: its left edge (the left column's right face) and its right edge (the right column's left face).

**Why it is here.** The lens fraction is measured across this extent, so each gap's two screen edges are carried together.

.. CG-EXPLANATION-END id=interface:GapExtent

``interface ApexOverrideInputs``
--------------------------------

.. CG-BLOCK id=interface:ApexOverrideInputs lines=85-109

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 85-109
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ApexOverrideInputs

**What this does.** The named shape of everything the override builder needs, a pure snapshot of the fill memo's closure: the ordered columns, the gap extents, the stored boundary shapes, the two screen transforms, the two live drag states, and the persisted-lens-bodies set.

**Why it is here.** The long comment on the last field records the section-91 fix: for a two-sided body whose stored node is a genuine lens tip with no live drag, the memo rebuild after release must route that node through the lens path, not the contact path, or the tip floods to a band and the reshape snaps back on release; this set makes the persisted routing match the live routing.

.. CG-EXPLANATION-END id=interface:ApexOverrideInputs

``interface ApexOverrideResult``
--------------------------------

.. CG-BLOCK id=interface:ApexOverrideResult lines=110-136

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 110-136
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ApexOverrideResult

**What this does.** The named shape of the result: the override map fed to the engine (holding both lens-apex and contact keys) and the set of gap-scoped bodies whose contact was overridden.

**Why it is here.** The caller needs both — the map to drive the engine, and the contact-overridden set to gate the old off-engine reshape off for those bodies.

.. CG-EXPLANATION-END id=interface:ApexOverrideResult

``function buildApexOverridesForGaps``
--------------------------------------

.. CG-BLOCK id=function:buildApexOverridesForGaps lines=137-362

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 137-362
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildApexOverridesForGaps

**What this does.** The main function. For each gap it finds the bodies on the left and right columns, then for each one-sided body (present on exactly one side) it builds its lens-tip apex override from the stored boundary nodes, applying the live drag or injecting a brand-new node from the cursor. It then handles the two special cases where a two-sided full-width band nonetheless owns a genuine lens tip in the gap — the live lens drag, and a persisted lens tip — routing those through the lens path and collecting them so the contact path skips them. Finally it calls the contact-override helper for the gap's shared boundaries. It returns the assembled override map and the set of contact-overridden bodies.

**Why it is here.** The comments record the careful apex-selection reasoning (section 84): the top-level apex must ride the edge the owner is actively dragging, not an unconditional first upper node, because a tall band can carry a stale upper node near the section top and the lower lens node being dragged, and pinning the apex to the stale node flooded the tip to the top and it snapped back. The raw pre-clamp reach is preserved as an over-reach signal so a deliberate over-drag past a column edge can be told from a clamped visible reach. The disentangle set ensures a node is never applied both as a lens apex and a contact bend, with the drag or persist KIND (lens) deciding, not the body's two-sidedness.

.. CG-EXPLANATION-END id=function:buildApexOverridesForGaps

``function detectPersistedLensBodies``
--------------------------------------

.. CG-BLOCK id=function:detectPersistedLensBodies lines=363-416

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/apexOverrideWiring.ts
   :language: typescript
   :lines: 363-416
   :lineno-match:

.. CG-EXPLANATION-START id=function:detectPersistedLensBodies

**What this does.** The function that recovers, from engine truth, which two-sided bodies have a stored node that is really a lens tip rather than a shared-contact bend. It measures the elevation span of every apex-shapeable lens region in each gap, then for each two-sided body checks whether any stored in-gap node's elevation sits inside that span — if so, the node is shaping the lens tip and is flagged.

**Why it is here.** The docstring records the problem: both a lens-edge drag and a shared-contact drag persist their node onto the same stored array, so the node's kind is not recoverable from storage alone; after a lens-drag release the memo would route it through the contact path and the reshape would snap back. This function recovers the kind from engine truth — a node inside a shapeable lens tip's elevation span is a lens node — while a genuine shared-contact bend sits at the band's base, outside the tip's span, and is not flagged.

.. CG-EXPLANATION-END id=function:detectPersistedLensBodies

