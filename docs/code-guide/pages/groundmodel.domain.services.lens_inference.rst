groundmodel.domain.services.lens_inference
==========================================

.. CG-PAGE source=src/groundmodel/domain/services/lens_inference.py complete=true

*Source file:* ``src/groundmodel/domain/services/lens_inference.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: the ``dataclass``
decorator (a shorthand that turns a class into a plain holder of named values),
the ``field`` helper (for giving such a value a default), and ``UUID`` (the type
of the long unique identifier the app gives every row). It also pulls in three
tuning tokens from the sibling constants file. The docstring writes out the whole
method as five numbered steps.

**Why it is here.** This is the "correlation-implies-absence" engine (issue #101,
round 2). When a formation is tied across two tests but a test *between* them logs
a **different** soil in the same depth band, that difference is positive evidence
the formation is not present there — a lens that pinches out. The docstring is
firm about scope: the file is pure domain knowledge with no database, no file
reading and no logging, so the application layer owns every side effect. That is
the one-directional layer rule in CLAUDE.md — pure knowledge is the easiest thing
to test and the hardest to break by a change elsewhere. It also fixes the line
between "unknown" and "absent": silence is never read as absence.

.. CG-EXPLANATION-END id=module-header

Class ``BodyContactRecord``
---------------------------

.. CG-BLOCK id=class:BodyContactRecord lines=57-79

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 57-79
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyContactRecord

**What this does.** Defines a small read-only record for one formation-contact:
which test hosts it (the investigation's unique id, and whether it is a borehole
or a CPT), and the depth of the formation top there. ``@dataclass(frozen=True)``
means "a bundle of named values that cannot be changed once it is made".

**Why it is here.** The engine needs only the test anchor and the top depth to
work out where the body is present and how deep it sits. Every spatial, source
and provenance field on the real contact row is irrelevant to this decision, so
this trimmed snapshot keeps the pure engine independent of the full database row
(the docstring: "the engine only needs the investigation anchor and the depth").

.. CG-EXPLANATION-END id=class:BodyContactRecord

Class ``ObservationLayerRecord``
--------------------------------

.. CG-BLOCK id=class:ObservationLayerRecord lines=80-108

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 80-108
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationLayerRecord

**What this does.** A read-only record for one logged soil layer at a test: the
test anchor, the layer's top and base depth (metres, positive downwards, base
deeper than top), and the list of main soil codes recorded there — for example
``['ZAND']``, where an empty list means nothing was logged. A "list" is just an
ordered collection of values.

**Why it is here.** The engine reads a middle test's layers to ask "does this
test show a *different* soil where the body should be?" Only the depth interval
and the soil codes answer that, so admixtures and free-text descriptions are left
out (the docstring says as much). ``field(default_factory=list)`` gives the
soil-code list a fresh empty list on every record — the standard way to stop all
records accidentally sharing one list.

.. CG-EXPLANATION-END id=class:ObservationLayerRecord

Class ``FormationAbsenceRecord``
--------------------------------

.. CG-BLOCK id=class:FormationAbsenceRecord lines=109-138

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 109-138
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationAbsenceRecord

**What this does.** A read-only snapshot of one absence row already saved in the
database: its own id, the test it concerns, and its ``source`` — one of
``'inferred'``, ``'manual'`` or ``'observed'``.

**Why it is here.** The engine compares what it infers *now* against what a
previous run wrote, so it needs each existing row's id (in case it must retract
one) and its source (to know whether the engine is allowed to touch it). The
source is the guard the whole "run me twice, get the same result" contract rests
on: engine-made rows may be replaced, but a mark the engineer made by hand is
never overwritten.

.. CG-EXPLANATION-END id=class:FormationAbsenceRecord

Class ``AbsenceToWrite``
------------------------

.. CG-BLOCK id=class:AbsenceToWrite lines=139-160

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 139-160
   :lineno-match:

.. CG-EXPLANATION-START id=class:AbsenceToWrite

**What this does.** A read-only record describing one absence row the engine
wants saved: the formation, the test, and a source that is always ``'inferred'``.

**Why it is here.** The engine never writes to the database itself; it hands the
application layer a list of these to UPSERT (an insert that updates the row
instead of failing if it already exists). Stamping every produced row
``'inferred'`` is what lets a later run recognise its own past output and leave
the engineer's ``'manual'`` and ``'observed'`` rows untouched.

.. CG-EXPLANATION-END id=class:AbsenceToWrite

Class ``InferenceResult``
-------------------------

.. CG-BLOCK id=class:InferenceResult lines=161-192

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 161-192
   :lineno-match:

.. CG-EXPLANATION-START id=class:InferenceResult

**What this does.** The bundle the engine returns, holding three lists:
``to_write`` (absence rows to save), ``to_retract`` (ids of stale inferred rows
to delete), and ``skipped_no_data`` (tests that had no overlapping layer, for
information only). Unlike the records above, this is a plain ``@dataclass`` that
is *not* frozen, so the engine can add to the lists as it works.

**Why it is here.** The three outcomes an absence engine can reach — write it,
retract it, or do nothing because the ground is unknown — are kept as three
separate named lists so the caller acts on each correctly. ``to_retract`` carries
only the ids of ``'inferred'`` rows, which is the engine's written promise never
to delete an absence the engineer marked by hand.

.. CG-EXPLANATION-END id=class:InferenceResult

Function ``def _intervals_overlap``
-----------------------------------

.. CG-BLOCK id=function:_intervals_overlap lines=193-228

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 193-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:_intervals_overlap

**What this does.** Answers yes or no for whether two depth intervals touch. It
takes the deeper of the two tops and the shallower of the two bases; if that base
sits above that top there is no overlap. With the minimum-overlap ratio set to
zero (the default) any shared point counts as overlap; otherwise it measures the
overlap as a fraction of the body's own thickness and compares it to the ratio.

**Why it is here.** The engine's core question — "does the middle test log soil
where the body sits?" — is an interval-overlap question. The endpoints are
treated as inclusive so that even a single shared depth counts (the docstring
says so), because a pinching lens can shrink to a point. The ratio knob is left
at zero today so the engine is as inclusive as possible, while the fraction path
stays ready in case the owner ever wants to demand more than a bare touch.

.. CG-EXPLANATION-END id=function:_intervals_overlap

Function ``def _has_different_lithology``
-----------------------------------------

.. CG-BLOCK id=function:_has_different_lithology lines=229-277

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 229-277
   :lineno-match:

.. CG-EXPLANATION-START id=function:_has_different_lithology

**What this does.** Returns yes when any of a test's layers that overlaps the
body's depth band records a soil code different from the formation's expected
code. A layer with nothing logged is skipped, and if the formation itself has no
expected code the function answers no.

**Why it is here.** This is the "positive evidence" gate. An absence is inferred
only when a test *actively shows a different soil* at that depth — never from a
gap or from silence. Without a reference soil code there is nothing to compare
against, so the engine declines rather than guess. This is the "unknown is not
absent" rule turned into a single decision.

.. CG-EXPLANATION-END id=function:_has_different_lithology

Function ``def infer_formation_absences``
-----------------------------------------

.. CG-BLOCK id=function:infer_formation_absences lines=278-447

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference.py
   :language: python
   :lines: 278-447
   :lineno-match:

.. CG-EXPLANATION-START id=function:infer_formation_absences

**What this does.** The public entry point. It splits the corridor's tests into
those that already carry a contact for this body (present) and those that do not
(absent). It works out the body's depth band from the present contacts' top
depths. Then, for each absent test, it looks for a differing soil in that band: a
match is queued as an inferred absence to write, a non-match is recorded as
"no data / unknown". Finally it compares the wanted set against the rows already
in the database to build the write and retract lists, always leaving ``'manual'``
and ``'observed'`` rows alone.

**Why it is here.** This is the method from the docstring gathered in one place,
and it is deliberately idempotent — the same inputs always give the same output —
so it is safe to re-run after every correlation or data edit. Two guards are
load-bearing. When the body has no contacts left (an "uncorrelate" gesture
collapsed it) every previously inferred row is retracted, closing the leak
recorded as debt #132. And a body whose contacts all sit at one depth is given a
half-metre band so a single-test body can still match an overlapping layer. The
engine never invents a base depth it does not have; it approximates the body's
extent from the range of contact tops, which is conservative and correct for the
overlap check.

.. CG-EXPLANATION-END id=function:infer_formation_absences

