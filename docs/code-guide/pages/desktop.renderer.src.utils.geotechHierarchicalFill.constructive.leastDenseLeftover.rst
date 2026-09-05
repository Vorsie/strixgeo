desktop.renderer.src.utils.geotechHierarchicalFill.constructive.leastDenseLeftover
==================================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/leastDenseLeftover.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/leastDenseLeftover.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/leastDenseLeftover.ts
   :language: typescript
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the fill's last resort — ground trapped between two legally-closed facing constructs, which is filled as ONE region taking the lowest density among the masses that bound it. It imports the adjacency helpers and the face-point type.

**Why it is here.** Owner 2026-08-26: 'if 2 lenses are pointed to eachother and there is nothing else to fill the gap, no open band above or below, then you fill with the lowest density', and to splitting it down the middle, 'a big NOOOO'. The docstring defines 'bound' as every classed face sharing an arrangement edge with the leftover, not the facing pair by name, because the engine cannot know which pair a leftover faces until it looks at what touches it. Least dense is the lowest NAD class number (owner 'least dense yeah', 2026-08-25). It lists the four things the rule deliberately does not do: it never runs where anything else can answer, never redraws a shape, never splits a connected run, and never invents an owner.

.. CG-EXPLANATION-END id=module-header

``interface LeftoverFace``
--------------------------

.. CG-BLOCK id=interface:LeftoverFace lines=65-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/leastDenseLeftover.ts
   :language: typescript
   :lines: 65-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LeftoverFace

**What this does.** One loop as this rule needs to see it: the mass key the fill gave it — or nothing where every rung of the ladder declined and the loop is the leftover — its NAD class rank or nothing, and the ring.

**Why it is here.** The leftover is exactly the null-key faces, and the rank is what 'least dense' is read from among the bounding masses.

.. CG-EXPLANATION-END id=interface:LeftoverFace

``function resolveLeftovers``
-----------------------------

.. CG-BLOCK id=function:resolveLeftovers lines=85-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/leastDenseLeftover.ts
   :language: typescript
   :lines: 85-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveLeftovers

**What this does.** Hands each connected run of leftover faces the least dense mass that bounds it. It marks the leftover faces, groups touching ones into one component with union-find, gathers every classed face that borders each component, and picks the lowest NAD class rank; a leftover nothing borders keeps its hatch.

**Why it is here.** It is one region no matter which line the arrangement cut it on — the owner's 'a big NOOOO' is precisely the answer that would give each half a different owner. It reads the whole boundary before choosing, so the decision does not depend on the arrangement's emit order, and a mass whose packing carries no class can never displace one that does.

.. CG-EXPLANATION-END id=function:resolveLeftovers

