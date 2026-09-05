desktop.renderer.src.utils.geotechHierarchicalFill.constructive.ownContactTies
==============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module answers, for the fill's remainder step, which correlation lines a candidate band must never be found on the wrong side of. Its heart is the rule that a line drawn ON a band's own top or base contact bounds that band everywhere its class is proposed — not only in the gap the line happens to cross. It builds a run-wide index of each band's own-contact ties plus a small helper for reading a line's elevation. It imports the tie-elevation helper and the band and tie shapes from ``constructs.ts`` and a contact tolerance.

**Why it is here.** Owner, 2026-08-28, Cross-section 1 gap 14: "i don't want the VD sand to spill below that bottom tie". A correlation drawn on a band's contact is that band's own boundary, and the absolute rule — a class may never cross a correlation — is strongest there. The remainder step already tests candidates against the gap's drawn ties, but that set only holds lines that span THIS gap, so the owner's tie drawn one gap back was absent while the very dense sand reached across an intervening test and was handed the wedge beneath exactly that line. Making the index run-wide fixes that: the line bounds the band wherever the band's class is proposed.

.. CG-EXPLANATION-END id=module-header

``function ownContactTiesOf``
-----------------------------

.. CG-BLOCK id=function:ownContactTiesOf lines=43-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 43-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:ownContactTiesOf

**What this does.** Builds a lookup from each band to the ties that land on that band's own top or base at that band's own column. For each band it keeps the ties whose endpoint sits at the band's top or base elevation, on either side of the correlation.

**Why it is here.** A contact is shared by the band above it and the band below, so a tie recorded against either lands on this band's contact just the same — which is why the test is on the ELEVATION at this band's column, never on which band the correlation row happens to name. Bands with no tie of their own are simply absent, so a lookup miss cleanly means "this band has no boundary of its own to honour here".

.. CG-EXPLANATION-END id=function:ownContactTiesOf

``type WallScope``
------------------

.. CG-BLOCK id=type:WallScope lines=80-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=type:WallScope

**What this does.** A type (a named set of allowed values) with two options: ``drawn``, the lines actually crossing this gap, and ``own-contacts``, those lines dropped and replaced by the candidate's own boundaries.

**Why it is here.** The remainder ladder widens in stages and each stage names which of these two scopes it tests against. There is deliberately no third "no walls at all" option, because standing a class across the very line drawn on its own contact is not a fill decision the ladder is ever allowed to make.

.. CG-EXPLANATION-END id=type:WallScope

``interface WallSource``
------------------------

.. CG-BLOCK id=interface:WallSource lines=83-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 83-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:WallSource

**What this does.** The data shape holding the two tie collections the wall builder draws from: the ties drawn across this gap, and the run-wide index of each band's own-contact ties.

**Why it is here.** It bundles the two inputs the composer needs so the per-candidate wall set can be assembled in one place.

.. CG-EXPLANATION-END id=interface:WallSource

``interface Wall``
------------------

.. CG-BLOCK id=interface:Wall lines=91-121

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 91-121
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Wall

**What this does.** The data shape for one correlation line as a wall: the tie itself, and a flag saying whether the line speaks only between its own two ends. A drawn tie speaks right across the gap; a tie borrowed from a neighbouring gap is read only at its nearest end.

**Why it is here.** A drawn line really is there, so reading it at any position is honest and that extrapolation is left alone. A tie from a neighbouring gap is not drawn on this ground at all, so continuing its slope would invent a boundary nobody drew — the more so the further it runs. The docstring records this was MEASURED both ways over the whole 14-section model: un-clamped it also nudged an unrelated CS3 wedge by about 0.09 m2, clamped the change is confined to the two CS1 gaps the ruling is about.

.. CG-EXPLANATION-END id=interface:Wall

``function wallElevAt``
-----------------------

.. CG-BLOCK id=function:wallElevAt lines=122-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 122-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:wallElevAt

**What this does.** Reads a wall's elevation at an along-section position, clamping to the line's own ends when the line speaks only between them.

**Why it is here.** It is the one place the span-only flag is honoured, so both readers get the same clamped answer for a borrowed line and the same free answer for a drawn one.

.. CG-EXPLANATION-END id=function:wallElevAt

``function wallsFor``
---------------------

.. CG-BLOCK id=function:wallsFor lines=150-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/ownContactTies.ts
   :language: typescript
   :lines: 150-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:wallsFor

**What this does.** Assembles the exact set of walls one candidate band is tested against on a given rung: the drawn ties for the ordinary rungs, or the candidate's own-contact ties for the final wall-less rung. A tie that both spans this gap and lands on the band's contact is counted once, as the drawn kind.

**Why it is here.** The final rung drops the drawn walls for the reason it always has — a wall chooses between candidates and must never starve legitimate ground into hatch — but it must NOT drop the candidate's own boundary. Composing the set here, per candidate, is what makes that structural: every rung names a scope, every scope answers with lines, and the last rung's scope IS the candidate's own contacts, so putting a class back across its own tie would need a scope that does not exist. The comment records why the first four rungs do not also get the undrawn lines: measured 2026-08-28, handing those to rungs that still keep their walls cut a test's own clay off from ground beside its own column on CS1 gap 2 and moved the golden-master reference.

.. CG-EXPLANATION-END id=function:wallsFor

