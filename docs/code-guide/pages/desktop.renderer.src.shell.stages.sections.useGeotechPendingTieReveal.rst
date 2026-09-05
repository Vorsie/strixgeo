desktop.renderer.src.shell.stages.sections.useGeotechPendingTieReveal
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that makes the geotech 'N pending here' chip answer its own count — pressing it centres and flashes the next pending correlation tie, or explains why it cannot be shown.

**Why it is here.** Owner dogfeed 2026-08-25: 'I get a one-pending notification but I don't see any pending ties — make it clickable so it highlights the tie.' The count is per section but the canvas draws per rendered column, so a tie whose end column is not drawn counts and renders nothing — the exact state the owner was looking at. WHETHER the tie can be drawn is the panel's call (it owns the columns and the pan); WHY it cannot is the shell's call (only the shell sees the project-level hide gates). Because the two answer different questions they cannot disagree.

.. CG-EXPLANATION-END id=module-header

``interface RevealInvestigation``
---------------------------------

.. CG-BLOCK id=interface:RevealInvestigation lines=45-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 45-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RevealInvestigation

**What this does.** The minimum an investigation must carry to be projected and named: id, name, and map location.

**Why it is here.** The reveal both projects the column onto the section and names it in the 'why not shown' message, so it needs the location and the name.

.. CG-EXPLANATION-END id=interface:RevealInvestigation

``interface RevealSection``
---------------------------

.. CG-BLOCK id=interface:RevealSection lines=53-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 53-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RevealSection

**What this does.** The section geometry the corridor check reads: the two endpoints, the projection buffer, and the per-section exclusion lists.

**Why it is here.** The absence explanation runs the same corridor projection the section view uses, so it needs the section's own geometry and exclusions.

.. CG-EXPLANATION-END id=interface:RevealSection

``interface GeotechPendingTieRevealArgs``
-----------------------------------------

.. CG-BLOCK id=interface:GeotechPendingTieRevealArgs lines=64-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 64-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechPendingTieRevealArgs

**What this does.** Everything a press needs to walk, reveal and explain: the open section id and row, the geotech edges, the geotech bands, the model's excluded boreholes, every project CPT and borehole (unfiltered), the visible id lists, the project-local hide sets, whether column focus is on, and the box the panel publishes its reveal into.

**Why it is here.** It reads the UNFILTERED project lists and the hide sets because the whole point is to explain why a column the canvas is NOT drawing was dropped — an answer the post-filter visible lists cannot give.

.. CG-EXPLANATION-END id=interface:GeotechPendingTieRevealArgs

``type PendingTieRevealOutcome``
--------------------------------

.. CG-BLOCK id=type:PendingTieRevealOutcome lines=97-124

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 97-124
   :lineno-match:

.. CG-EXPLANATION-START id=type:PendingTieRevealOutcome

**What this does.** The four possible results of one press: revealed (centred and flashed), undrawable (found but an end is off screen, with a message saying which and why), none (nothing pending here), and unavailable (no panel mounted).

**Why it is here.** The toolbar turns each into a toast, and 'undrawable' is the one that must never be silent — it is the count-with-nothing-behind-it the owner was staring at.

.. CG-EXPLANATION-END id=type:PendingTieRevealOutcome

``function useGeotechPendingTieReveal``
---------------------------------------

.. CG-BLOCK id=function:useGeotechPendingTieReveal lines=125-188

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 125-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechPendingTieReveal

**What this does.** Returns the press function and registers it on the toolbar bridge box. A press reads the current inputs through a ref, lists the section's pending ties, advances a visit index (a ref, not state), asks the panel to reveal that tie's two end columns, and returns 'revealed' or an 'undrawable' outcome carrying a composed explanation of each missing end. Leaving a section resets the walk.

**Why it is here.** The visit index and inputs are refs so advancing does not re-render the canvas — the pan and flash happen inside the panel. The absence explanation runs through the SAME on-section projection the view uses, so its answer can never drift from what the canvas actually did. Resetting the walk on a section change avoids skipping ties for no reason the engineer can see.

.. CG-EXPLANATION-END id=function:useGeotechPendingTieReveal

``function labelsFor``
----------------------

.. CG-BLOCK id=function:labelsFor lines=189-208

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 189-208
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelsFor

**What this does.** Builds an investigation-id to display-name map for both ends of one tie, looking each end up in the CPT or borehole pool.

**Why it is here.** The 'why not shown' message names each end, so it needs the display names resolved from the unfiltered pools.

.. CG-EXPLANATION-END id=function:labelsFor

``function absenceFor``
-----------------------

.. CG-BLOCK id=function:absenceFor lines=209-243

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPendingTieReveal.ts
   :language: typescript
   :lines: 209-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:absenceFor

**What this does.** For one absent investigation, reads every visibility gate — is it known to the project, hidden project-wide, in the visible set, excluded from the model or the section, does it project onto the section, is column focus on — and returns a coded reason.

**Why it is here.** Running the corridor test through the same projection helper the section uses means the explanation can never contradict what the section actually drew.

.. CG-EXPLANATION-END id=function:absenceFor

