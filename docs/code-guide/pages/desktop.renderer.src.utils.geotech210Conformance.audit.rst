desktop.renderer.src.utils.geotech210Conformance.audit
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotech210Conformance.audit.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotech210Conformance.audit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 1-101
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the "2/1/0 conformance oracle": given one section's finished partition, it names which packing bands break the platform's 2/1/0 drawing law and how. The long comment states the law itself — a band with two tied contacts BANDS across its gap, one tie ONLAPS following that tie, zero ties closes as a LENS at its own level — and names the four ways to break it (a construct that balloons far outside its own extent, one that emits nothing into a gap it should reach, one tied twice that fails to span to the far column, and a one-tie construct that paints past the middle of its run). It records the owner's rulings on how ties are counted, what else can tie a contact (the "cover weld" and the "least-dense leftover"), and imports the fill engine's own modules so it reads the same family, parent and cover facts the render was built from. Below it are the tuning constants, the shapes of the dumped data, and the audit functions.

**Why it is here.** The reasons are recorded throughout the comment. It exists as its own module (split from the test harness when that file passed 500 lines, debt #201) so a hand-built partition can be handed to the oracle to prove it still FLAGS a violation rather than merely failing to find one. Crucially it asks the engine's own modules for every fact — family membership, tie counts, the cover weld — rather than re-deciding them here, because a re-implementation is exactly where the audit and the render could drift apart, which is the class of bug this gate exists to catch. The 2/1/0 law is the platform's interpolation framework (docs/design/section-fill.md and project_partition_fill_pinchout_matrix); the oracle is deliberately coarse and used as a ratchet, so the caller counts violations per section against a frozen baseline and lets the count only shrink.

.. CG-EXPLANATION-END id=module-header

``const BALLOON_SLACK``
-----------------------

.. CG-BLOCK id=const:BALLOON_SLACK lines=102-103

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 102-103
   :lineno-match:

.. CG-EXPLANATION-START id=const:BALLOON_SLACK

**What this does.** The factor by which a zero- or one-tie construct is allowed to be taller than its own band before it counts as a balloon: two times.

**Why it is here.** The balloon check needs some tolerance because a construct can legitimately be a little taller than the band that seeded it; twice its thickness is the agreed ceiling above which growth is a defect.

.. CG-EXPLANATION-END id=const:BALLOON_SLACK

``const MIDDLE_GRACE``
----------------------

.. CG-BLOCK id=const:MIDDLE_GRACE lines=104-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 104-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIDDLE_GRACE

**What this does.** The slack allowed around the "terminates at 0.5 distance approximately" rule: 0.06.

**Why it is here.** The owner's own wording is "approximately", so the middle-reach check carries a small tolerance rather than demanding an exact half.

.. CG-EXPLANATION-END id=const:MIDDLE_GRACE

``const BALLOON_GRACE_M``
-------------------------

.. CG-BLOCK id=const:BALLOON_GRACE_M lines=106-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 106-107
   :lineno-match:

.. CG-EXPLANATION-START id=const:BALLOON_GRACE_M

**What this does.** An absolute grace in metres added to the balloon cap: 0.05.

**Why it is here.** Snap-rounding grain and label strokes can push a region a few centimetres past its true envelope, so a fixed small margin keeps those from reading as balloons.

.. CG-EXPLANATION-END id=const:BALLOON_GRACE_M

``const SPAN_REACH``
--------------------

.. CG-BLOCK id=const:SPAN_REACH lines=108-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 108-111
   :lineno-match:

.. CG-EXPLANATION-START id=const:SPAN_REACH

**What this does.** How close to the far column a same-mass welded span must reach, as a fraction of the gap: 0.99.

**Why it is here.** A band whose far end is the same mass emits nothing and the mass runs continuously, so its ground must arrive essentially at the far column; 0.99 rather than exactly 1 leaves a hair for rounding.

.. CG-EXPLANATION-END id=const:SPAN_REACH

``const MIDDLE_REACH``
----------------------

.. CG-BLOCK id=const:MIDDLE_REACH lines=112-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 112-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIDDLE_REACH

**What this does.** How close to the middle a two-tie construct with a different mass at the far end must reach: 0.4 (with the same tolerance applied on both sides).

**Why it is here.** The law says such a construct's vertical stands in the middle at about 0.5 distance, so the check requires it to reach roughly the middle and uses the same tolerance whichever side of the gap the band stands on.

.. CG-EXPLANATION-END id=const:MIDDLE_REACH

``interface RawUnit``
---------------------

.. CG-BLOCK id=interface:RawUnit lines=115-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 115-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawUnit

**What this does.** Describes one packing band as it appears in the dumped data: its layer id, its top and base depth below the collar, the formation it belongs to, and its body id (which may be absent).

**Why it is here.** The oracle reads a saved dump of a real section, so it needs a plain shape for each band the dump carries.

.. CG-EXPLANATION-END id=interface:RawUnit

``interface RawColumn``
-----------------------

.. CG-BLOCK id=interface:RawColumn lines=123-128

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 123-128
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawColumn

**What this does.** Describes one test column of the dump: its investigation id, its collar surface elevation (which may be absent), and its list of bands.

**Why it is here.** A column groups the bands that sit on one hole, which is the unit the audit reasons about per test.

.. CG-EXPLANATION-END id=interface:RawColumn

``interface RawArm``
--------------------

.. CG-BLOCK id=interface:RawArm lines=129-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 129-134
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawArm

**What this does.** Describes one model arm of the dump — either the litho arm or the geotech arm: its columns, its correlation edges (each naming the two layers it ties and optionally which side of each), and the along-section distances of the columns.

**Why it is here.** Both models share the same arm shape, so one interface serves the litho frame and the geotech bands it carries.

.. CG-EXPLANATION-END id=interface:RawArm

``interface RawSection``
------------------------

.. CG-BLOCK id=interface:RawSection lines=135-139

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 135-139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawSection

**What this does.** Describes one whole section of the dump: it is a litho arm plus a name and a nested geotech arm.

**Why it is here.** The geotech bands are always built on top of a litho frame, so a section carries its litho arm directly and nests the geotech arm inside it.

.. CG-EXPLANATION-END id=interface:RawSection

``interface Violation``
-----------------------

.. CG-BLOCK id=interface:Violation lines=140-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 140-144
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Violation

**What this does.** Describes one band that broke the law: which of the four kinds it is (balloon, missing, nospan, or overreach) and a text detail naming the section, column, gap and measurements.

**Why it is here.** The detail string is what a developer reads to locate the exact band and see how far it strayed, so a violation carries both a machine-sortable kind and a human-readable explanation.

.. CG-EXPLANATION-END id=interface:Violation

``type Counts``
---------------

.. CG-BLOCK id=type:Counts lines=145-151

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 145-151
   :lineno-match:

.. CG-EXPLANATION-START id=type:Counts

**What this does.** A small record holding one section's violation totals, one number per kind.

**Why it is here.** The ratchet compares these per-kind totals against the frozen baseline, so the counts are grouped into one shape.

.. CG-EXPLANATION-END id=type:Counts

``interface AuditBundle``
-------------------------

.. CG-BLOCK id=interface:AuditBundle lines=152-164

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 152-164
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AuditBundle

**What this does.** Describes one section's partition exactly as the oracle needs to see it: the geotech bands and their along-metres and edges; the merged surface regions (where existence and span are read); the pre-merge loops tagged as either "construct" or "fill"; and the litho frame the geotech arm was built on (its columns, edges and regions).

**Why it is here.** The docstring records why both surfaces are carried: existence and span are read on the merged surface (the mass), while the balloon and overreach checks read only the pre-merge construct loops — the shapes the law actually drew from ties — because fill loops are ground handed to a mass by an ownership rule and are allowed to exceed one band's extent. The litho frame is needed because the families, parents and cover boundaries all come from there.

.. CG-EXPLANATION-END id=interface:AuditBundle

``function assemble``
---------------------

.. CG-BLOCK id=function:assemble lines=165-206

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 165-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:assemble

**What this does.** Turns one raw arm of the dump into the partition engine's own column/edge shapes: it keeps only columns that have a surface elevation and at least one band, sorts them left to right by along-distance, sorts each column's bands top-first, and normalises each edge's two sides to "top" or "base" (defaulting to top).

**Why it is here.** The dump is a loose record; the engine functions expect tidy, sorted inputs, so this converts one to the other in a single place before either the raw or the framed audit path uses it.

.. CG-EXPLANATION-END id=function:assemble

``function auditedPartition``
-----------------------------

.. CG-BLOCK id=function:auditedPartition lines=207-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 207-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:auditedPartition

**What this does.** Builds the partition the oracle will audit. By default it produces the rendered one — the hierarchical geotech fill computed on the litho frame's column axis, exactly as the render and the 3-D build do. When asked for the ``raw`` variant it instead partitions the whole-section geotech arm on its own axis (what the committed baseline was frozen on) and tags every region as a construct, with no litho frame. It returns the bundle the audit reads, and returns an empty one if there are fewer than two litho columns.

**Why it is here.** The docstring records that the two paths agree column-for-column wherever every borehole is divided, and the raw path simply has fewer gaps elsewhere because an un-banded column is dropped from its axis. The default framed path is the one that matches what the user actually sees; the raw path is kept so the audit can also be run against the historical baseline. The pre-merge regions are carried through role-tagged because, as the inline comment records, the owner's rule is that there should be no pre-merge ballooning anywhere until the geometrical fill step, so any construct-loop balloon is a constructor bug.

.. CG-EXPLANATION-END id=function:auditedPartition

``function ringExtentOver``
---------------------------

.. CG-BLOCK id=function:ringExtentOver lines=279-318

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 279-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringExtentOver

**What this does.** Measures the elevation range that a set of polygon rings occupies within a given horizontal fraction window. It walks each ring's edges and, for every edge that enters the window, records the elevation at any vertex inside the window and at the exact points where an edge crosses the window's left or right boundary, returning the lowest and highest elevations found (or nothing when no ring reaches the window).

**Why it is here.** The docstring records why it interpolates edge crossings rather than reading vertices alone: a ring's lowest point inside a window is often on an edge that crosses the window boundary, so reading only vertices would report a floor the ring never actually had. The measured case is CS1 gap 11's cover, which kinks a hair outside the loop that follows it.

.. CG-EXPLANATION-END id=function:ringExtentOver

``function auditPartition``
---------------------------

.. CG-BLOCK id=function:auditPartition lines=319-891

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 319-891
   :lineno-match:

.. CG-EXPLANATION-START id=function:auditPartition

**What this does.** The heart of the file: it audits one section's partition against the 2/1/0 law and returns every violation. It works in stages. First it reconstructs, using the fill engine's own helpers, which litho family each band belongs to and which columns each family is banded on. Then it counts, for every band-and-gap, how many contacts are tied — counting a tie the same way the fill does (dropping ties whose two ends are in different litho families, treating a tie that jumps a column the family has no bands on as an adjacent tie, and counting a fan on one contact as one tie), and it records the tie lines and the formation at each tie's far end. It folds in the "cover weld" answers asked of the engine's own module (a cover boundary to the same litho and same packing is itself a tied contact) and the litho parent's own tie lines (which widen the allowed envelope without counting as packing ties). Finally it walks every band in every gap: it skips gaps whose facing test has no bands (un-divided ground reads empty by ruling); for two-tie bands it checks that a same-mass weld reaches the far column and a different-mass construct reaches the middle; for zero/one-tie bands it checks the construct exists, does not paint past the middle of its run, and does not balloon outside the union of its own extent and the lines it rides.

**Why it is here.** Almost every branch carries a comment tying it to a specific owner ruling and a real measured case, and the through-line is stated in the module header: the audit must count ties and compare masses exactly as the fill does — by class, not by row id (the owner's "one mass, one body", 2026-08-21) — or it would be auditing a law the fill was never given. Skipping the un-divided facing test honours the 2026-08-15 ruling that un-divided ground shows empty until the engineer presses Divide; auditing it would bury real regressions under hundreds of intended absences. The cover-weld and least-dense-leftover handling implement the 2026-08-26 refinements. The packing class it compares on is the Belgian-annex characterisation label (NBN EN 1997-1 ANB Tabel 2.1); the oracle only measures geometry against the law, it computes no soil parameter.

.. CG-EXPLANATION-END id=function:auditPartition

``function auditSection``
-------------------------

.. CG-BLOCK id=function:auditSection lines=892-898

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotech210Conformance.audit.ts
   :language: typescript
   :lines: 892-898
   :lineno-match:

.. CG-EXPLANATION-START id=function:auditSection

**What this does.** Audits one section of the dump from end to end: it builds the section's partition (framed by default, or raw when asked) and then runs the full audit on it, returning every violation found.

**Why it is here.** A one-call convenience that pairs the partition builder with the auditor, so callers do not have to wire the two steps together each time.

.. CG-EXPLANATION-END id=function:auditSection

