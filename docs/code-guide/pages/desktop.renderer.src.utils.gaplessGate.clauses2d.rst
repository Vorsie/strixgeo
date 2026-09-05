desktop.renderer.src.utils.gaplessGate.clauses2d
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that computes clauses 1 to 3 for one section straight off that section's own geotech fill, and imports the geometry library (JTS, a computational-geometry toolkit) it uses to union and compare cover shapes.

**Why it is here.** The docstring records that clauses 2 and 3 only relabel what the engine already found (re-deriving would give the report a second opinion that can disagree with the engine), while clause 1 (area-conservation) is genuinely new — nothing else asserts that classed plus unclassed cover equals the litho cover it subdivides. It also records the two things a real report on 2026-08-28 taught: give the engineer a magnitude he can act on, and somewhere to go.

.. CG-EXPLANATION-END id=module-header

``type Clause2dKey``
--------------------

.. CG-BLOCK id=type:Clause2dKey lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:Clause2dKey

**What this does.** The three clause keys this file answers — area-conservation, edge-reach and cause-closure — as a narrowed subset of the full seven (clause 4 lives in the sibling file).

**Why it is here.** Naming exactly the three keys this module owns keeps it from accidentally producing a clause that belongs to another file.

.. CG-EXPLANATION-END id=type:Clause2dKey

``interface SectionClauseEvidence``
-----------------------------------

.. CG-BLOCK id=interface:SectionClauseEvidence lines=50-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionClauseEvidence

**What this does.** One section's answer for one of the three 2-D clauses: the key, the status, an optional not-evaluated reason, and the list of named spots. Substance only, with no clause number or title.

**Why it is here.** It mirrors the wire input shape but per-section, because these clauses are computed section by section and merged afterwards; leaving off the number and title keeps the naming on the backend as the type contract requires.

.. CG-EXPLANATION-END id=interface:SectionClauseEvidence

``interface SectionClause2dInput``
----------------------------------

.. CG-BLOCK id=interface:SectionClause2dInput lines=59-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 59-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionClause2dInput

**What this does.** Everything one section needs to compute its three 2-D clauses: the section id and name, its hierarchical fill result (or undefined when none ran), the litho frame's own partition as clause 1's reference, the along-section metre positions, and the investigation each column stands on.

**Why it is here.** The docstring makes ``columnInvestigationIds`` required, not optional, because it is the ONLY list a gap index is valid against and it exists here so the two column names can be resolved while the frame is still in scope; a caller that could supply it and did not would mint findings nobody can navigate to, so the type refuses to let it be forgotten.

.. CG-EXPLANATION-END id=interface:SectionClause2dInput

``const NO_FILL_REASON``
------------------------

.. CG-BLOCK id=const:NO_FILL_REASON lines=86-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 86-111
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_FILL_REASON

**What this does.** The fixed sentence used when a section ran no hierarchical geotech fill — a litho build, or a section with no matching litho frame.

**Why it is here.** Naming the reason once means every not-evaluated clause on such a section reports the same honest explanation instead of an invented pass.

.. CG-EXPLANATION-END id=const:NO_FILL_REASON

``function formatMeasure``
--------------------------

.. CG-BLOCK id=function:formatMeasure lines=112-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 112-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatMeasure

**What this does.** Turns a measured number into the text a human sentence shows: two decimals while two decimals still say something, but three significant figures when two decimals would round the value to the word "0". A value that really is zero (including negative zero) still prints "0".

**Why it is here.** The docstring records this was the whole rule until 2026-08-28, when it was shown to be a lie for clause 1: that clause compares covers exactly, so a genuine mismatch below 0.005 square metres rounded to "0" and reported a guarantee broken by an amount of nothing. Significant figures are used because the range runs from a square millimetre to thousands of square metres and a fixed decimal count is wrong at one end by construction.

.. CG-EXPLANATION-END id=function:formatMeasure

``function gapLocator``
-----------------------

.. CG-BLOCK id=function:gapLocator lines=135-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 135-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:gapLocator

**What this does.** Builds the navigation fields every 2-D entry carries: the section id and name, the gap index the sentence says, and the gap's two column investigations — included only when the frame's column list actually reaches that gap.

**Why it is here.** The docstring restates the rule that an index must never leave this module as a way to find a gap: the sentence quotes the index but the reader navigates by the two column names, and the pair is omitted rather than guessed when the frame does not reach the gap — which happens when the fill reports a violation on a gap the frame's own axis does not hold.

.. CG-EXPLANATION-END id=function:gapLocator

``const geometryFactory``
-------------------------

.. CG-BLOCK id=const:geometryFactory lines=154-167

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 154-167
   :lineno-match:

.. CG-EXPLANATION-START id=const:geometryFactory

**What this does.** A single shared factory object from the geometry library, used to build the polygons the cover comparison operates on.

**Why it is here.** The library needs one factory to create its geometry objects; making it once and reusing it avoids rebuilding it for every polygon.

.. CG-EXPLANATION-END id=const:geometryFactory

``function coverGeometry``
--------------------------

.. CG-BLOCK id=function:coverGeometry lines=168-218

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 168-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverGeometry

**What this does.** Measures one set of regions as a single covered SHAPE, not as a sum of its rings: it turns each region's polygon into a real-coordinate polygon (scaling the fraction axis by the gap width), unions them all with the geometry library, and returns the union and its area.

**Why it is here.** The docstring explains a hierarchical result's sibling rings can meet, cross a snapped junction, or overlap while still painting the same ground once; a raw shoelace sum would turn that into an invented shortfall or excess. Unioning first counts every patch once at the coordinates the section actually holds, so only genuinely unpainted or over-painted ground moves the result.

.. CG-EXPLANATION-END id=function:coverGeometry

``function realGroundM2``
-------------------------

.. CG-BLOCK id=function:realGroundM2 lines=219-253

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 219-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:realGroundM2

**What this does.** Given the difference between two covers, returns only the area of the pieces that hold REAL ground: it erodes each piece inward by half a snap-grid cell and keeps a piece only if something survives, reporting a surviving piece at its FULL area. A piece the erosion cannot measure is kept, not dropped.

**Why it is here.** Owner ruling 2026-08-31, quoted at length: the two covers come from two engines that snap-round independently onto a millimetre grid, so where the geotech cuts a sloping litho contact its cut can only land on a grid point that is not exactly on the litho's straight line — leaving a real, grid-exact triangle 90 metres long and half a millimetre thick that is neither noise nor removable by rounding. The clause therefore asks the question the engineer actually has — is any ground MISSING — and ground has width: a difference nowhere wider than the grid is one contact stated twice, while a real hole survives erosion and is reported at its full area. A geometry it cannot measure is reported rather than swallowed, because silently dropping real ground is the one outcome worse than a false alarm.

.. CG-EXPLANATION-END id=function:realGroundM2

``function describeGeometryFailure``
------------------------------------

.. CG-BLOCK id=function:describeGeometryFailure lines=254-262

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 254-262
   :lineno-match:

.. CG-EXPLANATION-START id=function:describeGeometryFailure

**What this does.** Turns whatever the geometry library threw into a short phrase for a report line, reading both an error's name and message and truncating anything over 80 characters.

**Why it is here.** The docstring notes the library raises objects that are not always standard errors (a topology exception carries its own name), so both shapes are read and an unrecognised one still yields readable text rather than the word "undefined".

.. CG-EXPLANATION-END id=function:describeGeometryFailure

``function areaConservationFor``
--------------------------------

.. CG-BLOCK id=function:areaConservationFor lines=263-327

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 263-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:areaConservationFor

**What this does.** Computes clause 1 for one section that did run a fill: for every gap, it measures the painted cover and the litho cover as shapes, takes the real-ground part of their symmetric difference, and if that is non-zero records an entry naming the section, gap and the shortfall in square metres. A gap whose geometry throws is reported in words with no number rather than crashing.

**Why it is here.** The docstring records this clause runs INSIDE the voxel-request build, so anything it throws would take the Build button with it, not just the report — and both obvious responses are wrong: crashing hides the finding and swallowing passes a gap nobody measured. So a self-crossing ring is reported in those words with no number, because no number was obtained. This is the one clause that genuinely checks that classed plus unclassed equals the litho cover.

.. CG-EXPLANATION-END id=function:areaConservationFor

``function edgeReachFor``
-------------------------

.. CG-BLOCK id=function:edgeReachFor lines=328-344

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 328-344
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeReachFor

**What this does.** Computes clause 2 for one section by relabelling the engine's own edge-reach violations: each one becomes an entry saying the 3-D build would read a named gap edge as empty ground even though the litho cover holds soil there.

**Why it is here.** The docstring is explicit that this is a verbatim relabel of the engine diagnostic, so the report never gives a second opinion that could disagree with the engine that drew the fill.

.. CG-EXPLANATION-END id=function:edgeReachFor

``function causeClosureFor``
----------------------------

.. CG-BLOCK id=function:causeClosureFor lines=345-366

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 345-366
   :lineno-match:

.. CG-EXPLANATION-START id=function:causeClosureFor

**What this does.** Computes clause 3 for one section by relabelling the engine's totality violations: each becomes an entry saying how many square metres of litho cover are neither classed nor accounted for, and by how many unanswered loops.

**Why it is here.** Like clause 2 the docstring records this is a verbatim relabel of an engine diagnostic — the totality tripwire — so the gate reports exactly what the fill already knows rather than re-deriving it.

.. CG-EXPLANATION-END id=function:causeClosureFor

``function clauses2dForSection``
--------------------------------

.. CG-BLOCK id=function:clauses2dForSection lines=367-390

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/clauses2d.ts
   :language: typescript
   :lines: 367-390
   :lineno-match:

.. CG-EXPLANATION-START id=function:clauses2dForSection

**What this does.** The section-level entry point: if the section ran no fill it returns all three clauses as ``not-evaluated`` with the no-fill reason; otherwise it runs the three clause computations and returns exactly three answers in clause-number order.

**Why it is here.** It is the one place that turns "this section has no geotech fill" into three honest not-evaluated answers rather than three vacuous passes, matching the type's insistence that not-evaluated is not a soft pass.

.. CG-EXPLANATION-END id=function:clauses2dForSection

