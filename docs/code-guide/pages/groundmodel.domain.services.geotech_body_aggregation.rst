groundmodel.domain.services.geotech_body_aggregation
====================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_body_aggregation.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_body_aggregation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: ``defaultdict`` (a
dictionary — a name-to-value lookup — that starts any missing entry at a default,
here zero), the ``dataclass`` decorator, and the ``GeotechSplit`` record from the
subdivision module. It then sets one constant that ranks an unclassified
("needs review") band above every real NAD class in a tie-break. The file decides,
for a body seen on several CPTs, whether it splits into stacked sub-bodies or
carries one representative packing class.

**Why it is here.** A single litho body can read as several stacked packing bands
on one CPT and as one band on another. This module is the pure decision (no reading
or writing anything) that resolves the disagreement: if every CPT reads the same
ordered sequence of packing classes, the body splits into one sub-body per band;
if they disagree, the body carries one representative class instead. The constant
puts "needs review" above every class so that when a tie in the tie-break arises,
it resolves to the honest flag rather than to a packing class nobody actually
derived — a deliberate conservative choice explained under the dominant-class
helper below.

.. CG-EXPLANATION-END id=module-header

Class ``BandProfile``
---------------------

.. CG-BLOCK id=class:BandProfile lines=25-40

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 25-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:BandProfile

**What this does.** Defines a read-only record for one CPT member of a body group:
which CPT it is, and its ordered top-to-base list of packing bands.

**Why it is here.** The decision compares each CPT's band sequence against the
others, so it needs each member's bands in order along with the CPT they came
from. A borehole contributes no packing evidence, so it either carries an empty
band list or is simply left out of the group.

.. CG-EXPLANATION-END id=class:BandProfile

Class ``BodySubdivisionPlan``
-----------------------------

.. CG-BLOCK id=class:BodySubdivisionPlan lines=41-58

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 41-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySubdivisionPlan

**What this does.** Defines a read-only record for the decided plan: a flag saying
whether the body is consistent (should split into stacked sub-bodies), and the
list of NAD classes — one per band position when consistent, otherwise a single
representative class.

**Why it is here.** The caller needs both halves of the answer: whether to split,
and the class to give each resulting piece. When the body is not consistent the
list holds one class for the whole body; for a borehole-only group the single
entry is empty, because there was no CPT evidence to classify with.

.. CG-EXPLANATION-END id=class:BodySubdivisionPlan

Function ``def _sequences_consistent``
--------------------------------------

.. CG-BLOCK id=function:_sequences_consistent lines=59-82

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 59-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sequences_consistent

**What this does.** Takes the per-CPT sequences of packing classes and returns true
only when every shorter sequence exactly matches the start of the longest one.

**Why it is here.** "Consistent" means the CPTs agree on the same ordered stack of
classes, allowing a shallower test that stopped early to be a prefix of a deeper
one (the too-shallow case). The comparison is by exact equality, so an
unclassified position is treated as just another value: two CPTs that both read
"no usable tip resistance" at the same position agree there, while one that read a
class there does not. That keeps the honest "needs review" state a first-class part
of the agreement, not something quietly ignored.

.. CG-EXPLANATION-END id=function:_sequences_consistent

Function ``def _thickness_weighted_dominant``
---------------------------------------------

.. CG-BLOCK id=function:_thickness_weighted_dominant lines=83-124

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 83-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:_thickness_weighted_dominant

**What this does.** Adds up the total thickness of each packing class across the
given bands and returns the class with the most thickness. On an exact tie the
denser (higher) class wins among real classes, but the unclassified "needs review"
state wins over all of them.

**Why it is here.** The representative class of a body should be the class most of
its ground actually reads, so thickness — not band count — decides. The docstring
is careful that the unclassified state is a real member of the pool, the honest
answer where there was no usable tip resistance, not an absence: a thin
unclassified sliver never vetoes a much thicker classified band, but on an exact
tie the flag wins, because asserting a class over ground half of which has no
evidence would hide the gap from the engineer, and a flagged band is the cheaper
error to leave — he can confirm it, whereas a plausible-looking class is never
questioned again. The explicit rank also avoids a crash: without it, comparing the
empty state against a number would raise an error.

.. CG-EXPLANATION-END id=function:_thickness_weighted_dominant

Function ``def plan_body_subdivision``
--------------------------------------

.. CG-BLOCK id=function:plan_body_subdivision lines=125-165

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_body_aggregation.py
   :language: python
   :lines: 125-165
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_body_subdivision

**What this does.** Drops the members that carry no packing bands (the boreholes),
then checks whether the remaining CPT sequences agree. If they do, it splits at
every band position, giving each position the thickness-dominant class across the
CPTs that reach it. If they disagree, it returns one representative class for the
whole body. A group with no CPT members returns a consistent plan with a single
empty class.

**Why it is here.** This is the top-level decision the module exists for. A borehole
contributes no packing evidence, so it is excluded from the vote; only CPTs decide
the split. Choosing the dominant class per position (when consistent) or over the
whole body (when not) reuses the same thickness rule everywhere, so the class a
body carries is always the one most of its ground reads, and the honest
"needs review" flag survives wherever the evidence is missing.

.. CG-EXPLANATION-END id=function:plan_body_subdivision

