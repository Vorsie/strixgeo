desktop.renderer.src.components.sections.geotechLensSuggestion
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it detects a small enclosed class-lens — a thin band of one packing class fully inside a host stack of another — and drives the 'merge into surrounding band' suggestion. It imports the interval types and the merge check.

**Why it is here.** The docstring records the owner idea (debt #227): tiny enclosed packing-class lenses get an affordance suggesting the absorb, mirroring the litho stage's assisted-manual philosophy where the system points and the engineer acts. Detection gates only the affordance; the server never checks smallness or host-class equality, and the smallness threshold reuses the model's own minimum-layer-thickness preference rather than a new magic number.

.. CG-EXPLANATION-END id=module-header

``interface EnclosedLens``
--------------------------

.. CG-BLOCK id=interface:EnclosedLens lines=31-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts
   :language: typescript
   :lines: 31-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EnclosedLens

**What this does.** Describes a qualifying lens — the thin band, the two same-class hosts around it, the hosts' shared non-null NAD class, and the lens's own class (which may be null).

**Why it is here.** A data shape carrying the enclosure and the classes the absorb restores.

.. CG-EXPLANATION-END id=interface:EnclosedLens

``function enclosedLensAt``
---------------------------

.. CG-BLOCK id=function:enclosedLensAt lines=64-94

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts
   :language: typescript
   :lines: 64-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosedLensAt

**What this does.** Judges whether the band at a given index is an enclosed lens: it qualifies when both neighbours exist, both boundaries are legal merges, both hosts carry the same non-null NAD class, and the lens's own class differs (including being null).

**Why it is here.** The docstring records that requiring both boundaries to be legal merges gives 'a lens against a litho contact is excluded' for free (ruling 2), that an unclassifiable sliver between matching hosts is the best absorb candidate of all, and that thickness is judged by the caller so a menu opened on any band can still name the enclosure without the size gate.

.. CG-EXPLANATION-END id=function:enclosedLensAt

``function findSmallEnclosedLenses``
------------------------------------

.. CG-BLOCK id=function:findSmallEnclosedLenses lines=95-109

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechLensSuggestion.ts
   :language: typescript
   :lines: 95-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:findSmallEnclosedLenses

**What this does.** Returns every small enclosed lens on a column, top to bottom — the ones at or under the model's minimum-layer-thickness preference.

**Why it is here.** The size gate is applied here, so only lenses thin enough to suggest absorbing are returned.

.. CG-EXPLANATION-END id=function:findSmallEnclosedLenses

