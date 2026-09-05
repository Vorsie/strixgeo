desktop.renderer.src.utils.geotechHierarchicalFill.constructive.emitKernel
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens THE LAW — the owner's complete emit specification, quoted verbatim in the docstring. This module is those rules and nothing else: it knows no geometry. Handed what a band's ties show at their far ends, it answers what to emit. In the 2/1/0 rule, no ties emit a LENS (the band closes inside the gap), one tie emits an ONLAP if the far mass differs (a triangle following the tie) or nothing if it matches, and two ties make a band that spans.

**Why it is here.** The docstring carries THE LAW verbatim (owner 2026-08-19) and his own note that it is 'a few very simple rules that can be written in 50 lines of code when bare'. It also records the bidirectional ruling of 2026-08-25 — 'no it has one tie on top, so it should onlap that same tie' — so a band with one tie always onlaps it and thickness is never consulted by either side. That supersedes the 2026-08-21 'clearly thicker wins' collision, which is deleted rather than left inert.

.. CG-EXPLANATION-END id=module-header

``interface Mass``
------------------

.. CG-BLOCK id=interface:Mass lines=52-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 52-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Mass

**What this does.** A mass, as the law compares them: a lithology and a packing density.

**Why it is here.** It is the one thing the law compares. Identity is this pair — the class, not the formation row (owner 2026-08-21, 'one mass one body') — so two rows of one class can never read as different masses.

.. CG-EXPLANATION-END id=interface:Mass

``type Emit``
-------------

.. CG-BLOCK id=type:Emit lines=58-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 58-60
   :lineno-match:

.. CG-EXPLANATION-START id=type:Emit

**What this does.** Declares a type — a fixed set of allowed values — for what the law can say: 'lens', 'onlap' or 'nothing'.

**Why it is here.** It names the only three outcomes so every part of the code that consumes the law's answer handles exactly those three and no others.

.. CG-EXPLANATION-END id=type:Emit

``function sameMass``
---------------------

.. CG-BLOCK id=function:sameMass lines=61-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 61-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:sameMass

**What this does.** Returns whether two masses are equal — same litho and same packing.

**Why it is here.** It is the one comparison the law makes, 'same litho and packing density', named once so every caller asks it identically.

.. CG-EXPLANATION-END id=function:sameMass

``function emitFor``
--------------------

.. CG-BLOCK id=function:emitFor lines=73-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 73-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitFor

**What this does.** The law itself. No ties gives a lens. One tie gives nothing when the far mass matches, else an onlap. Two ties give nothing — the band stays open and spans — whatever the far ends read.

**Why it is here.** Each clause quotes the owner's specification in the comments. Two tied contacts make a band (owner 2026-08-21, 'two ties is two tied contacts'), so it emits nothing and spans. His 'vertical line in the middle' is still drawn, but it is the seam where two open masses meet, decided elsewhere, not something one band emits on its own.

.. CG-EXPLANATION-END id=function:emitFor

``const FILL_ORDER``
--------------------

.. CG-BLOCK id=const:FILL_ORDER lines=105-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 105-112
   :lineno-match:

.. CG-EXPLANATION-START id=const:FILL_ORDER

**What this does.** A constant listing the order a loop's owner is looked for in: 'lens', then 'onlap', then 'remainder'.

**Why it is here.** It encodes the owner's fill order verbatim: 'emit lenses first, then emit onlaps, then fill in the rest with the dominant lithology'.

.. CG-EXPLANATION-END id=const:FILL_ORDER

``function massKey``
--------------------

.. CG-BLOCK id=function:massKey lines=113-115

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/emitKernel.ts
   :language: typescript
   :lines: 113-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:massKey

**What this does.** Turns a mass into a string key of the form litho-bar-packing.

**Why it is here.** Two faces weld only when they carry the same key, so the fill sweep IS this key: touching plus same mass equals one body, and nothing else merges.

.. CG-EXPLANATION-END id=function:massKey

