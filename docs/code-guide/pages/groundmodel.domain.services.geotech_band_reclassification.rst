groundmodel.domain.services.geotech_band_reclassification
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_band_reclassification.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_band_reclassification.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-87

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 1-87
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: the coverage
thresholds and validity checks shared with the subdivision engine, the NAD
classifier, the shared "representative qc" statistic, the admixture and soil
types. It then sets two tolerances (a 1 cm boundary-agreement grain and a
near-zero depth grain) and the string codes for the warnings and the gesture kinds.
The file handles the engineer's hand split, merge, and boundary-drag of packing
sub-bands.

**Why it is here.** The docstring records the owner's spec and the four rulings it
encodes, and nothing else. First: the class is DERIVED, not carried — after a split
or merge each resulting interval is reclassified from the cone resistance (qc) over
its own new extent. Second: the statistic used is the MODEL's choice, read through
one shared function — the owner said "average qc" but the model actually uses its
representative statistic (a median by default, robust to spikes), and computing a
warning with any other statistic would promise a reclassification the build never
performs. Third: the lithostratigraphic unit is the only hard wall — a packing
boundary moves freely inside its litho body and clamps at the edge, but never
crosses a litho contact; a geological contact is NOT a wall (owner, 2026-08-26:
"just drop the wall everywhere"). Fourth: a manual override always wins — a thin
band or an unsupported boundary is a WARNING, never a block. And "cannot answer" is
a first-class outcome: where the qc coverage is too thin the class comes back empty
with a reason, never a plausible-looking guess. It is pure by construction, so the
preview and the commit share one implementation and the preview shows exactly what
the button will do.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechBandEditError``
------------------------------

.. CG-BLOCK id=class:GeotechBandEditError lines=88-95

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 88-95
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandEditError

**What this does.** Defines the one error type this file raises — a named kind of
"bad request" error — when a hand edit would breach the three-level hierarchy.

**Why it is here.** The two things are kept apart: the engineer may overrule the
derived CLASS, but he may not move or cross a lithostratigraphic contact from the
geotech axis. Only that second, structural violation raises this error; everything
advisory is a warning instead. The web layer turns this error into an HTTP 422
(the "your request is not allowed" reply), so the desktop can show the reason.

.. CG-EXPLANATION-END id=class:GeotechBandEditError

Class ``GeotechBand``
---------------------

.. CG-BLOCK id=class:GeotechBand lines=96-125

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 96-125
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBand

**What this does.** Defines a read-only record for one existing packing band on one
column: its stable identifier, its top and base depth, the NAD packing class it
carries today (which may be empty for a "needs review" band), the litho formation
it subdivides, and the geological formation it sits within (which may be empty for
the open shallow band).

**Why it is here.** The edit planners need each band's bounds and current class to
work out what an edit changes, and they need the two parent formations to enforce
the hierarchy rulings. The litho parent is the hard wall — the boundary can never
leave it — so it is stored plainly. The geological parent is deliberately a derived
LABEL, never a wall (owner, 2026-08-26): it is carried only for provenance and
identity, and no edit is ever refused or clamped by it.

.. CG-EXPLANATION-END id=class:GeotechBand

Class ``ProposedInterval``
--------------------------

.. CG-BLOCK id=class:ProposedInterval lines=126-144

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 126-144
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProposedInterval

**What this does.** Defines a read-only record for one interval a hand edit would
produce: its top and base depth, and the existing band or bands whose material ends
up in it.

**Why it is here.** The reclassifier needs to know not just where a new interval is
but which bands feed it, because the warning quotes what each contributing band
carried before. A split half has exactly one source (the band being cut); a merge
result has one per merged band.

.. CG-EXPLANATION-END id=class:ProposedInterval

Class ``SourceContribution``
----------------------------

.. CG-BLOCK id=class:SourceContribution lines=145-168

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 145-168
   :lineno-match:

.. CG-EXPLANATION-START id=class:SourceContribution

**What this does.** Defines a read-only record for what one existing band
contributes to a proposed interval: the band's identifier, the class it carries
today, its own representative qc over its own extent (which may be empty when its
qc cannot answer), and how much of the new interval it supplies.

**Why it is here.** The warning tells the engineer that this band's representative
qc is pulled up or down by the material it now shares a layer with, so it must
carry that band's own "before" number and how much it contributes. The qc is
allowed to be empty, honestly, when the band's own coverage cannot answer.

.. CG-EXPLANATION-END id=class:SourceContribution

Class ``IntervalOutcome``
-------------------------

.. CG-BLOCK id=class:IntervalOutcome lines=169-206

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 169-206
   :lineno-match:

.. CG-EXPLANATION-START id=class:IntervalOutcome

**What this does.** Defines a read-only record for the re-derived answer for one
proposed interval: its bounds, its representative qc, its newly derived class, the
class its material carries today, whether those two differ, a reason when no class
could be derived, and the per-band contributions behind it.

**Why it is here.** This is the full answer the preview shows and the commit acts
on. When the interval draws from several bands, "what it carries today" is taken
from the thickness-dominant source — the same tie-break the body aggregator uses
for an inconsistent group. The class and its reason are allowed to be empty
together: an interval whose qc cannot answer becomes a "needs review" band, exactly
as the build's thin-coverage path produces, rather than a guessed class.

.. CG-EXPLANATION-END id=class:IntervalOutcome

Class ``BandEditWarning``
-------------------------

.. CG-BLOCK id=class:BandEditWarning lines=207-229

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 207-229
   :lineno-match:

.. CG-EXPLANATION-START id=class:BandEditWarning

**What this does.** Defines a read-only record for one advisory consequence of an
edit: a code the desktop switches on, a ready-to-show plain-language message, the
interval it is about, and the existing band it names (when it names one).

**Why it is here.** These warnings are advisory, never blocking — that is the
fourth ruling. Carrying a code lets the desktop pick an icon or colour while the
message carries the prose, and naming the interval and band lets the desktop point
at the right place on the column.

.. CG-EXPLANATION-END id=class:BandEditWarning

Class ``BandEditPlan``
----------------------

.. CG-BLOCK id=class:BandEditPlan lines=230-273

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 230-273
   :lineno-match:

.. CG-EXPLANATION-START id=class:BandEditPlan

**What this does.** Defines a read-only record for the whole plan a gesture
produces: its kind (split or merge), the hard walls it is confined to, the
resulting intervals with their re-derived classes, the advisory warnings, the
statistic every interval was derived with, and — for a merge — which side of the
pair is swallowed.

**Why it is here.** This is the single object the preview and the commit both work
from. It names the statistic so the consequence sheet can quote it and can never
show a number the classifier would not produce (the single-source ruling). The
"absorbs" field records the merge direction (down means the unit above grows, up
means the reverse), because the writer needs it: the two directions keep different
rows alive and classify the survivor under different units' soils, so re-deriving
the direction from depths at write time would be a second copy of the same rule.

.. CG-EXPLANATION-END id=class:BandEditPlan

Function ``def enclosing_litho_bounds``
---------------------------------------

.. CG-BLOCK id=function:enclosing_litho_bounds lines=274-319

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 274-319
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosing_litho_bounds

**What this does.** Finds the hard walls for an edit on one band by walking up and
then down the column, collecting the run of neighbouring bands that share the same
litho parent and touch without a gap. It returns the top of the highest and the
base of the lowest band in that run.

**Why it is here.** A packing band is materialised inside one litho unit, so the
unit is exactly this contiguous run of same-parent bands, and its outer edges are
where a packing boundary must clamp. The docstring records that the geological
parent is deliberately NOT part of the test (owner, 2026-08-26: "just drop the
wall everywhere"): including it used to end the editable run mid-unit at a
geological line and made the server clamp tighter than the section editor's own,
so the two now agree. The walk also stops at a real hole in the column, because a
gap between bands is not one continuous unit.

.. CG-EXPLANATION-END id=function:enclosing_litho_bounds

Function ``def _index_of``
--------------------------

.. CG-BLOCK id=function:_index_of lines=320-327

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 320-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:_index_of

**What this does.** Finds the position of a band with a given identifier in the
column's list, and raises the edit error if no band has it.

**Why it is here.** The planners are handed a band identifier and need its position
to look at its neighbours. An identifier that is not on the column is a bad request,
so it fails loudly with a clear message rather than silently doing the wrong thing.

.. CG-EXPLANATION-END id=function:_index_of

Function ``def _assert_same_litho_body``
----------------------------------------

.. CG-BLOCK id=function:_assert_same_litho_body lines=328-371

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 328-371
   :lineno-match:

.. CG-EXPLANATION-START id=function:_assert_same_litho_body

**What this does.** Raises the edit error when the two bands a gesture spans sit in
different litho units, with a message naming the gesture the caller passed in.

**Why it is here.** This is the third ruling as a guard: a merge or a boundary drag
may never swallow a lithostratigraphic contact. It judges the litho parent and
nothing else — a geological contact is not a wall, so the engineer crosses it
himself and re-divides by hand. The gesture name is passed in because the wall is
shared between verbs: telling an engineer who dragged a boundary that a MERGE was
rejected describes a gesture he did not make and reads as a bug rather than a rule
about the ground (dogfeed 2026-08-09).

.. CG-EXPLANATION-END id=function:_assert_same_litho_body

Function ``def _representative_qc_over``
----------------------------------------

.. CG-BLOCK id=function:_representative_qc_over lines=372-436

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 372-436
   :lineno-match:

.. CG-EXPLANATION-START id=function:_representative_qc_over

**What this does.** Collects the cone-resistance readings that fall in an interval,
checks the coverage is good enough, and returns the interval's representative qc —
or, if it cannot, returns nothing plus a plain reason. It rejects an interval with
no readings, one where too much of the depth is missing or the longest gap is too
wide, and one with no usable readings at all.

**Why it is here.** This number is what the class is re-derived from, so it must be
the exact number the build would classify on. It samples the same half-open window
and judges coverage against the same thresholds the build uses to flag a unit
"needs review", so the preview and the build never disagree about whether an
interval can be answered. The comment records why the window is taken verbatim: an
older version shifted it by a millionth of a metre under a docstring that claimed
exact parity, an armed trap that would have fired the day anyone widened that grain.
The docstring is explicit that this deliberately does NOT use the build's borehole
fallback — that fallback gives a borehole some band with no samples, but here the
owner asked for a class re-derived from the qc, and with no qc there is nothing to
re-derive, so it says so honestly.

.. CG-EXPLANATION-END id=function:_representative_qc_over

Function ``def _classify_or_reason``
------------------------------------

.. CG-BLOCK id=function:_classify_or_reason lines=437-476

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 437-476
   :lineno-match:

.. CG-EXPLANATION-START id=function:_classify_or_reason

**What this does.** Takes a parent soil type, its admixtures, and an
already-validated representative qc, and returns the NAD packing class — or, when
the unit has no soil type or the classifier refuses, returns nothing plus a
readable reason.

**Why it is here.** The NAD classifier rejects input it cannot classify rather than
mapping it to a plausible class (owner rule 2026-07-25), and an unknown or absent
soil makes it raise. The preview must show that as a real answer, not crash, so the
rejection is turned into a "cannot answer" reason. This mirrors the build, which
materialises an empty-class skeleton band when the parent unit has no usable soil
code.

.. CG-EXPLANATION-END id=function:_classify_or_reason

Function ``def reclassify_intervals``
-------------------------------------

.. CG-BLOCK id=function:reclassify_intervals lines=477-575

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 477-575
   :lineno-match:

.. CG-EXPLANATION-START id=function:reclassify_intervals

**What this does.** For each proposed interval, computes its representative qc,
derives its new class from it, records each contributing band's own class and qc,
picks the thickness-dominant source as "what the interval carries today", and marks
whether the class changed. It first computes each contributing band's own qc once,
reusing it wherever that band appears.

**Why it is here.** This is the single implementation behind both the preview and
the commit, so what the owner is shown before pressing the button is exactly what
the button does. Computing a band's own qc once — rather than once per interval it
feeds — is a small saving, since the same band can feed several intervals in a
merge. Choosing the thickness-dominant source as the "before" class reuses the same
tie-break the body aggregator uses for an inconsistent group, so the two agree. An
interval whose qc cannot answer comes back with an empty class and a reason, never
a guessed class.

.. CG-EXPLANATION-END id=function:reclassify_intervals

Function ``def _class_phrase``
------------------------------

.. CG-BLOCK id=function:_class_phrase lines=576-586

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 576-586
   :lineno-match:

.. CG-EXPLANATION-START id=function:_class_phrase

**What this does.** Builds the short clause of a warning that describes the class
transition — "class 6 becomes 7", "class 5 becomes 'needs review'", "no class
either way", and so on — handling the cases where either side has no class.

**Why it is here.** The warnings need consistent wording for how the class moves,
and the empty-class ("needs review") state has to read naturally in either
direction. Keeping this in one small helper means every warning phrases the
transition the same way.

.. CG-EXPLANATION-END id=function:_class_phrase

Function ``def _build_warnings``
--------------------------------

.. CG-BLOCK id=function:_build_warnings lines=587-694

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 587-694
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_warnings

**What this does.** Builds the advisory warnings for a set of re-derived intervals.
For each interval it warns when the resulting band is thinner than the configured
minimum, and for each band feeding it, whether that band's representative qc is
pulled down or up and what its class becomes. It handles the case where the qc
cannot answer, and the case where the qc did not move but the class still did.

**Why it is here.** These are the two warning families from the owner's spec, and
they are advisory only — never a reason to refuse an edit. The subtle rule, spelled
out in the comment, is that the CLASS is what ships, so a warning must fire whenever
the class changes even if the median qc rounds to the same value: reporting only qc
movement once let a real reclassification through silently (a sand band whose split
moved it from class 6 to 7 while the warning read "class 6 is unchanged"). The
thin-band warning states the number and says it is kept anyway, because a manual
edit overrules the minimum.

.. CG-EXPLANATION-END id=function:_build_warnings

Function ``def plan_split``
---------------------------

.. CG-BLOCK id=function:plan_split lines=695-783

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 695-783
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_split

**What this does.** Plans splitting one band at a chosen depth. It finds the band
and its hard walls, rounds the split depth, refuses a depth outside the litho body
or outside the band being split, and otherwise builds the two halves, reclassifies
each from the qc, and returns the plan with its warnings.

**Why it is here.** This is the split gesture. The depth is rounded FIRST — before
it is validated or classified — because the commit writes the rounded depth, so
validating the raw depth would preview a split the disk never gets; the comment
records that a raw depth just inside the band could round onto its edge and reach
the database as a zero-width row and a mid-transaction error (audit F15). The two
refusals enforce the hard-wall ruling and the plain requirement that a split land
strictly inside the band it cuts.

.. CG-EXPLANATION-END id=function:plan_split

Function ``def plan_merge``
---------------------------

.. CG-BLOCK id=function:plan_merge lines=784-842

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 784-842
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_merge

**What this does.** Plans merging two adjacent bands by handing the pair to the
run-merge planner below.

**Why it is here.** A two-band merge is just the two-band case of merging a run of
bands, so rather than keep a second copy of the union-and-refusal logic, this
delegates to the general planner. The comment notes the small-lens absorb is the
other caller of that same union — the "extract on the second copy" rule applied.

.. CG-EXPLANATION-END id=function:plan_merge

Function ``def plan_merge_run``
-------------------------------

.. CG-BLOCK id=function:plan_merge_run lines=843-926

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 843-926
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_merge_run

**What this does.** Plans merging a run of two or more touching bands into one. It
orders the bands by depth, refuses a run with fewer than two distinct bands, one
that is not consecutive, one with a gap, or one that crosses a litho contact. It
then builds the single spanning interval, reclassifies it, and returns the plan.

**Why it is here.** This is the general merge, and it is the shape the small-lens
absorb needs: merging a host, a lens, and a host in ONE atomic plan gives one
honest preview and one undo step, whereas two sequential pair merges would show an
intermediate class that never exists. The refusals enforce that a merge only joins
adjacent bands that actually share a boundary and never swallows a litho contact
(the second ruling).

.. CG-EXPLANATION-END id=function:plan_merge_run

Function ``def plan_move``
--------------------------

.. CG-BLOCK id=function:plan_move lines=927-1034

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 927-1034
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_move

**What this does.** Plans dragging the shared boundary of two adjacent same-unit
bands to a new depth. It normalises the pair order, refuses a non-adjacent pair, a
pair with no shared boundary, a cross-unit pair, or a depth not strictly inside the
pair, then builds the two new intervals, reclassifies BOTH from the qc over their
new extents, and returns the plan.

**Why it is here.** This is the packing-boundary drag, and it re-derives both sides
(ruling 3 applied to the drag: "you recalculate after drag merge, the qc"). The
pair is always inside one litho unit, so its own envelope is the hard wall and the
strictly-inside test already keeps it there. The squeeze-to-collapse case — a
survivor thinner than the storage grain — is refused here on purpose, because
collapsing a band entirely is the ABSORB gesture's honest job: the desktop turns a
past-threshold release into a merge, and the message says so.

.. CG-EXPLANATION-END id=function:plan_move

Function ``def plan_restated_contact_move``
-------------------------------------------

.. CG-BLOCK id=function:plan_restated_contact_move lines=1035-1266

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_band_reclassification.py
   :language: python
   :lines: 1035-1266
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_restated_contact_move

**What this does.** Plans dragging the boundary that RESTATES a lithostratigraphic
contact — the boundary between two bands in DIFFERENT litho units. It refuses a
non-adjacent pair, a pair with no shared boundary, or a same-unit pair. Then it
handles three landings: dropping onto the lower band's base is a downward merge (the
unit above grows), landing on the pair's top is the upward merge (the reverse), and
anywhere strictly inside re-derives both sides. Each side is reclassified under its
OWN unit's soil, and a landing that would delete a whole unit is refused with a
reason.

**Why it is here.** This is the sibling of the packing drag for the other kind of
boundary: a boundary inside one unit is a packing subdivision the packing drag
owns, while a boundary between two units is a litho contact, and moving it moves all
three model levels together (owner, 2026-08-09: "we're refining from
geo-litho-geotech, so if we want to refine in the geotech then the rest should move
too"). It cannot be a flag on the packing drag because the two bands have different
soils, and the chain runs soil type to qc to class, so each side must classify under
its own soil — passing one soil for both would classify the sand with the clay's
column. The two merge landings are the headline cases, not edge ones: the desktop's
clamp lands every such drag exactly on a boundary, so a strictly-inside rule would
refuse the only landing the gesture can produce (audit F02/F02-mirror). The
delete-a-unit guards are the second line of defence behind the desktop's own clamp,
turning a bare database failure into a clear reason. And a landing that only reaches
a geological contact is allowed and coupled by the writer, not walled (owner
reversal, 2026-08-12: "yes allow it and couple them, this is unnecessary
friction") — the geological contact is never a wall.

.. CG-EXPLANATION-END id=function:plan_restated_contact_move

