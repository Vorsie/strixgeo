desktop.renderer.src.utils.geotech210Conformance.coverReads
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file supplies the conformance oracle with each band's reading of its "cover contacts" — whether a cover boundary is a tied contact for the law and, if so, the line the construct rides there. The comment quotes the owner ruling (2026-08-26) that started it: the tops of all tests are connected, so a cover boundary whose far band is the same litho and the same packing is a tied contact — "follow the tie, same nad class, emit nothing". It imports the fill engine's own construct, cover-weld, mass and far-band helpers plus the partition types.

**Why it is here.** The reason is recorded in the comment. Without this reading the oracle read every welded band as an untied lens that had painted its whole gap — 17 sections of false "overreach" the day the ruling landed, the first of them the ruling's own target. And the module decides nothing on its own: it marshals the inputs exactly the way the fill engine marshals them and then asks the engine's own predicate, because a second opinion written here would be a place the audit and the render could drift apart — the very class of bug this gate exists to catch.

.. CG-EXPLANATION-END id=module-header

``interface CoverRead``
-----------------------

.. CG-BLOCK id=interface:CoverRead lines=42-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts
   :language: typescript
   :lines: 42-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverRead

**What this does.** Describes one band's reading of one of its cover contacts across one gap: which side of the band it is (top or base), whether that contact welds (is tied for the law), and the straight line the construct rides there given at the gap's two columns, or nothing when the contact just holds the band's own flat level.

**Why it is here.** The docstring records an important subtlety: the line here is a straight chord, but a welded contact deliberately draws no line of its own — its line is the cover's own edge, which is a polyline the litho stage drew — so the oracle widens the ridden side to the cover ring's own extent rather than trusting the chord alone.

.. CG-EXPLANATION-END id=interface:CoverRead

``interface CoverReadContext``
------------------------------

.. CG-BLOCK id=interface:CoverReadContext lines=63-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts
   :language: typescript
   :lines: 63-94
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverReadContext

**What this does.** Describes everything the reading needs about the section it runs on: the geotech bands on the litho frame's axis, the litho frame's columns and approved edges, the along-metres, a function from a formation to its packing class key, the band-to-family and band-to-parent maps, which columns each family is banded on, and the set of contacts a packing tie already bounds.

**Why it is here.** Gathering all of it into one context object lets the reading be called with a single argument, and each field's comment records why it is needed — notably that the cover is only asked about contacts where no packing tie was found, since a packing tie is the law's own tie and is counted in the oracle itself.

.. CG-EXPLANATION-END id=interface:CoverReadContext

``function coverReadsOf``
-------------------------

.. CG-BLOCK id=function:coverReadsOf lines=95-260

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts
   :language: typescript
   :lines: 95-260
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverReadsOf

**What this does.** Produces every cover contact's reading, keyed by band-and-gap. It first indexes every band per column and every litho unit, defines a band's mass as its parent litho unit's soil plus its own packing class, marks for each family band whether its contact sits on the family cover's own boundary, and resolves the cover's own boundaries into lines per family (the same call the fill's own planner makes). Then for each band, for each gap it faces, for each cover contact not already bounded by a packing tie, it asks the per-contact reader whether the contact welds and rides a line, and records the result.

**Why it is here.** Every step is written to reproduce the fill engine's own marshalling — the same band-per-column helper, the same definition of mass as "same litho and packing", the same cover-tie resolution over the litho edges, the same run bracket the constructor is handed — so the answer the oracle gets is exactly the answer the render was built from. The packing class it compares on is the Belgian-annex characterisation label (NBN EN 1997-1 ANB Tabel 2.1); nothing here computes a soil parameter, it only reports which contacts are tied and where their lines run.

.. CG-EXPLANATION-END id=function:coverReadsOf

``function readCover``
----------------------

.. CG-BLOCK id=function:readCover lines=261-290

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.coverReads.ts
   :language: typescript
   :lines: 261-290
   :lineno-match:

.. CG-EXPLANATION-START id=function:readCover

**What this does.** Reads one contact's cover answer by asking the engine's ``coverContactOf`` predicate. When a contact carries a fan of several litho lines it puts every candidate line to the engine's predicate and lets a welding answer win, falling back to the first answer otherwise; when there is no candidate line it asks the predicate with no tie.

**Why it is here.** The docstring records why it enumerates candidates rather than re-scoring them: the constructor picks one line by a scoring that is private to another module, and keeping a second copy of that scoring here would be the exact duplication this module exists to avoid. The two readings could differ only on a contact carrying several litho ties whose far ends are different masses, and the lenient choice is deliberate — a false "overreach" the engineer cannot act on costs more than a missed one the ratchet catches anyway — and measured on the owner's real sections, no cover contact carries such a fan.

.. CG-EXPLANATION-END id=function:readCover

