groundmodel.domain.services.geotech_subdivision
===============================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_subdivision.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_subdivision.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the geotech NAD subdivision suggester and
imports its tools — the NAD qc bands and variant enum, the classifier, the
representative-statistic helper, the admixture and base-lithology types. It
sets two coverage-review thresholds and a cap on the re-derive passes.

**Why it is here.** The module suggests packing splits within one litho segment
through a deliberately conservative pipeline: sustained qc crossings place band
boundaries, each band is classified by its median qc (robust to spikes), thin
bands absorb into the weaker neighbour, and an optional gradient snap sharpens
contacts without ever making the placement less conservative. The two
thresholds encode the owner's 2026-07-25 rule that a unit is flagged "needs
review" rather than given a guessed class when its valid-qc coverage is too
thin — more than 40 % of the thickness missing, or a continuous bad run of 5 cm
or more. NAD packing classes are read from NBN EN 1997-1 ANB Tabel 2.1. The
pass cap is a backstop against a future weld rule that could oscillate, not a
tuning knob.

.. CG-EXPLANATION-END id=module-header

Function ``def _is_valid_qc``
-----------------------------

.. CG-BLOCK id=function:_is_valid_qc lines=40-55

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 40-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:_is_valid_qc

**What this does.** Returns whether one cone-resistance sample is usable:
present, finite (not NaN or infinity), and not negative. Here ``qc`` is the
cone tip resistance in MPa and NaN means "not a number".

**Why it is here.** A CPT records a void or corrupt reading as ``None``, NaN or
a negative number, and any statistic taken over those would be meaningless, so
every other step in the file drops them through this single gate.

.. CG-EXPLANATION-END id=function:_is_valid_qc

Function ``def _missing_qc_coverage``
-------------------------------------

.. CG-BLOCK id=function:_missing_qc_coverage lines=56-138

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 56-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:_missing_qc_coverage

**What this does.** Measures how much of a segment lacks valid qc and returns
two numbers: the single longest continuous run of bad readings, in metres, and
the fraction of the segment thickness that carries no reading, accumulated one
logging interval per invalid sample. When no sample is valid at all it reports
the segment as fully missing.

**Why it is here.** The two review rules measure different things, so the two
numbers are derived independently. Measuring the run's own span — first bad
sample to last — rather than the distance between the good samples bracketing
it is what makes the owner's rule "one isolated bad point never flags a unit"
hold at any sample spacing. The fraction is summed per invalid sample so that
scattered dropouts are not free. Only samples the cone actually wrote and the
validator rejected count; ground the cone never sampled contributes nothing,
because nothing there is corrupt (audit F12: the old code skipped leading bad
runs and never flushed trailing ones, so a bottom-of-unit sensor failure
classified confidently where the >40 % rule demanded review).

.. CG-EXPLANATION-END id=function:_missing_qc_coverage

Function ``def _persistence_filter``
------------------------------------

.. CG-BLOCK id=function:_persistence_filter lines=139-179

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 139-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:_persistence_filter

**What this does.** Scans a per-sample true/false mask and flips any interior
run shorter than a given length to the value of the run before it; the first
and last runs are never flipped. A mask here is a list of true/false, one per
sample, and a run is a stretch of equal values.

**Why it is here.** This is the "ignore a small dip or spike" rule: a brief
excursion across a qc threshold no longer moves a band boundary. An edge run
has no preceding run to adopt, so it is left alone.

.. CG-EXPLANATION-END id=function:_persistence_filter

Function ``def _median_increment``
----------------------------------

.. CG-BLOCK id=function:_median_increment lines=180-188

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 180-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:_median_increment

**What this does.** Returns the median spacing between consecutive depths — the
middle value once the gaps are sorted — falling back to 0.02 m for a degenerate
series with no positive gaps.

**Why it is here.** The median spacing is the honest nominal sample interval:
it is immune to the rod-change depth jumps and electric-to-mechanical method
switches that a mean would smear across the whole unit. It is used both to turn
a count of invalid samples into a depth and to size the persistence length.

.. CG-EXPLANATION-END id=function:_median_increment

Function ``def _sustained_threshold_cuts``
------------------------------------------

.. CG-BLOCK id=function:_sustained_threshold_cuts lines=189-249

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 189-249
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sustained_threshold_cuts

**What this does.** For every finite qc upper-bound of the soil's NAD column it
builds the "qc at least this bound" mask, persistence-filters it, and adds a
cut depth at each surviving transition; the window top and bottom are always
cuts. It returns the sorted, de-duplicated cut depths.

**Why it is here.** A crossing must hold for HALF the minimum band thickness to
place a cut (owner ruling 2026-08-11, audit F05). Half, not the whole: with
full-thickness persistence a coherent run just under the minimum — a real 0.34
m dense seam at the 0.35 m setting — was erased at the cutter and its material
silently upgraded whatever band swallowed it, with no decision point anywhere.
At half, such a seam becomes a cut candidate and the no-silent-upgrade merge
decides its fate. Features shorter than half the minimum stay noise, filtered
here. The variant override forces which soil column's thresholds are read,
honouring the engineer's persisted clean-versus-secondary answer.

.. CG-EXPLANATION-END id=function:_sustained_threshold_cuts

Function ``def _conservative_merge``
------------------------------------

.. CG-BLOCK id=function:_conservative_merge lines=250-328

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 250-328
   :lineno-match:

.. CG-EXPLANATION-START id=function:_conservative_merge

**What this does.** Absorbs every sub-minimum band into a neighbour, trying the
weaker (lower-numbered) neighbour first, but only when the re-derived union
does NOT come out denser than that neighbour's own class; when every neighbour
would be upgraded, the sliver stands as its own sub-minimum band. It works on a
copy of the bands.

**Why it is here.** Within one soil family the NAD class number runs
loose-to-dense, so the lower number is the weaker class and trying it first is
the conservative placement the owner asked for. The no-upgrade rule is his
verbatim ruling (audit F05): *"this would make a matig zand jump to a dense
one, i don't like this, in this case i'd rather get a smaller sliver and make
the user choose."* Going LOOSER stays automatic, because that is the
conservative direction the weaker-neighbour rule exists for. A union that
cannot be classified counts as non-upgrading, since no class claim is being
made.

.. CG-EXPLANATION-END id=function:_conservative_merge

Function ``def _weld_same_class_bands``
---------------------------------------

.. CG-BLOCK id=function:_weld_same_class_bands lines=329-341

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 329-341
   :lineno-match:

.. CG-EXPLANATION-START id=function:_weld_same_class_bands

**What this does.** Welds adjacent bands of equal NAD class into one contiguous
band.

**Why it is here.** Two touching bands of one class are one band; welding keeps
the output honest after any step that could leave same-class neighbours side by
side.

.. CG-EXPLANATION-END id=function:_weld_same_class_bands

Function ``def _gradient_snap``
-------------------------------

.. CG-BLOCK id=function:_gradient_snap lines=342-418

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 342-418
   :lineno-match:

.. CG-EXPLANATION-START id=function:_gradient_snap

**What this does.** Snaps each interior boundary toward a nearby sharp gradient
peak — a peak in how fast cone resistance changes with depth, the absolute
value of dqc/dz computed by central differences — but only when the move does
not make the boundary less conservative: a densifying boundary may move deeper,
a softening one only shallower. It then re-runs the conservative merge and the
weld.

**Why it is here.** The gradient peaks are the real contacts, so a snap
sharpens a boundary onto the sharpest local change in cone resistance; the
conservative constraint means a snap can only ever let the weaker class hold
longer, never shorter. Smoothing is skipped because the 92nd-percentile peak
threshold on raw qc already suppresses single-sample spikes, and the owner's
validated prototype used raw qc. The trailing merge uses the same
no-silent-upgrade rule, so a snap can never swallow a standing sliver back
(audit F05).

.. CG-EXPLANATION-END id=function:_gradient_snap

Class ``GeotechSplit``
----------------------

.. CG-BLOCK id=class:GeotechSplit lines=419-441

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 419-441
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechSplit

**What this does.** A frozen dataclass for one suggested NAD sub-unit within a
litho segment: its top and base depths (metres, positive down, clamped to the
parent segment), and its NAD packing class 1-31 — or ``None`` when the qc is
missing over a material span and the unit is flagged "needs review" instead.

**Why it is here.** Answering ``None`` rather than a guessed class is the
owner's 2026-07-25 rule: with no trustworthy qc the model states "needs review"
instead of asserting a packing class from nothing.

.. CG-EXPLANATION-END id=class:GeotechSplit

Function ``def _class_over``
----------------------------

.. CG-BLOCK id=function:_class_over lines=442-510

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 442-510
   :lineno-match:

.. CG-EXPLANATION-START id=function:_class_over

**What this does.** Classifies one half-open depth interval from the cone
readings inside it, and — when given the segment's raw samples — first applies
the same per-interval coverage thresholds the hand-edit path uses. It returns
the derived class, a caller-supplied fallback for an empty interval, or
``None`` (needs review) when the interval's own coverage fails.

**Why it is here.** Gating per interval rather than once per segment is what
stops a build and a later edit of the same interval from disagreeing (audit
F14: a band classified over locally-thin coverage was irrecoverably downgraded
to needs-review by any touch — merge it, undo, and the restored band came back
unanswerable). An interval with nothing in it returns the fallback, because an
empty interval is not evidence that the previous answer was wrong.

.. CG-EXPLANATION-END id=function:_class_over

Function ``def suggest_geotech_subdivision``
--------------------------------------------

.. CG-BLOCK id=function:suggest_geotech_subdivision lines=511-783

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision.py
   :language: python
   :lines: 511-783
   :lineno-match:

.. CG-EXPLANATION-START id=function:suggest_geotech_subdivision

**What this does.** The public entry point. It filters the CPT series to the
segment, refuses to guess when there are no readings at all or when the
missing/invalid qc spans a material fraction, then runs the pipeline: sustained
cuts, classify each band by its representative qc, conservative min-thickness
merge, weld, optional gradient snap, reach the segment bounds honestly, and
finally re-derive every class over the interval each band actually ends up
with, to a fixed point. It returns one :class:`GeotechSplit` per surviving band
and is never empty.

**Why it is here.** This ties every helper above into the one conservative
pipeline the module docstring names. Reaching the fixed litho bounds honestly
is the owner's audit-F32 ruling: ground the cone never sampled is not silently
claimed — an unread head or tail longer than the minimum thickness becomes its
own needs-review band, and the engineer decides what it is by correlating the
packing density across columns under the same 2/1/0 rule the litho stage uses
(owner: *"the 2/1/0 will stand in geotech stage also"*). The closing re-derive
is his 2026-08-10 ruling: because the merge, weld and snap all move boundaries,
a stored class could belong to an interval the band no longer had — 33 of 519
bands on his model, each off by exactly one class — so re-deriving over the
final rounded interval makes an undo an exact inverse by construction. NAD
classes come from NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=function:suggest_geotech_subdivision

