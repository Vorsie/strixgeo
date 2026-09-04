groundmodel.domain.services.nad_classifier
==========================================

.. CG-PAGE source=src/groundmodel/domain/services/nad_classifier.py complete=true

*Source file:* ``src/groundmodel/domain/services/nad_classifier.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the pure NAD packing-class rules and imports the
band table (the cut-off numbers) plus the soil-type and admixture definitions.

**Why it is here.** The one-line summary at the top is the whole philosophy:
*lithology is hard truth* — the cone resistance can say a sand is loose or dense,
but it can never change a sand into a silt. This file takes a soil type, its
admixtures, and a cone resistance and returns a NAD packing class (a number from
1 to 31 from the Dutch norm). It is "pure": plain functions, no database, no
network — exactly the kind of knowledge the domain layer holds (see
:doc:`../start-here`). The thresholds were checked against the printed NBN EN
1997-1 national annex table.

.. CG-EXPLANATION-END id=module-header

Function ``def _variant_for``
-----------------------------

.. CG-BLOCK id=function:_variant_for lines=31-55

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 31-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:_variant_for

**What this does.** Decides whether a soil should be read in its "clean" column
or its "with-admixture" (secondary) column, by checking whether it carries an
admixture the norm recognises for that soil.

**Why it is here.** The norm splits each soil into two columns: a clean sand and a
silty/clayey sand read on different scales. This picks the column. The match is
exact: a sand with a silt admixture goes secondary, but a sand with a gravel
admixture — which the norm does not treat as a variant — stays clean.

.. CG-EXPLANATION-END id=function:_variant_for

Function ``def classify_nad``
-----------------------------

.. CG-BLOCK id=function:classify_nad lines=56-136

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 56-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:classify_nad

**What this does.** The main function. It takes one (soil, admixtures, cone
resistance) triple and returns a NAD packing class from 1 to 31. It picks the
right column, then walks that column's bands and returns the first class whose
upper cut-off the reading falls under.

**Why it is here.** This is the core packing look-up. Two design rules are baked
in. First, invalid input is *rejected*, never quietly mapped to a plausible
class: a missing, not-a-number, infinite or negative cone resistance raises an
error rather than returning the densest or loosest class (owner rule,
25 July 2026) — no code path may turn bad data into a design-facing number.
Second, the top and bottom of each column are open-ended: a reading below the
printed floor still belongs to the soil the litho model already fixed, so it
takes that soil's loosest class rather than being thrown out (owner ruling,
11 August 2026). It classifies on *raw* cone resistance — no normalisation — which
is the norm's own stated method for this table.

.. CG-EXPLANATION-END id=function:classify_nad

Function ``def loosest_class_for``
----------------------------------

.. CG-BLOCK id=function:loosest_class_for lines=137-177

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 137-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:loosest_class_for

**What this does.** Returns the loosest class of a soil's own column (clean or
secondary), or nothing for a soil the table does not know.

**Why it is here.** It is the fallback used when a borehole has no cone resistance
to classify from. It derives the floor from the *same* table and the *same*
column rule the main classifier uses, so the two can never disagree — an earlier
version used a separate constant and stamped a silty sand with the clean column's
floor, the right packing in the wrong column (audit F19).

.. CG-EXPLANATION-END id=function:loosest_class_for

Function ``def soil_family_of``
-------------------------------

.. CG-BLOCK id=function:soil_family_of lines=178-201

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 178-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:soil_family_of

**What this does.** Given a NAD class number, says which soil family it belongs to
(gravel, sand, silt, clay or peat), or nothing for an unclassified band or a
number the norm never printed.

**Why it is here.** It reads the soil family straight off the norm table rather
than a second hand-kept map, so the class-to-soil answer can never drift from the
soil-to-class answer. It is the building block for the two coupling checks
below.

.. CG-EXPLANATION-END id=function:soil_family_of

Function ``def class_belongs_to_soil``
--------------------------------------

.. CG-BLOCK id=function:class_belongs_to_soil lines=202-244

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 202-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:class_belongs_to_soil

**What this does.** Answers "may this packing class sit on a band of this soil?"
It returns false only when both soils are known and they differ.

**Why it is here.** The owner ruled (26 August 2026) that "a sand body can never
carry a silt packing class" and "the NAD coupling is absolute" — a packing class
is a statement about one soil column, so it is meaningless on another soil. Two
cases are deliberately *not* treated as violations: an unclassified band (there is
no foreign soil to convict) and a soil the norm gives no column at all (nothing
says the class is foreign). This keeps the rule from wiping a class an engineer
set by hand on an unusual unit.

.. CG-EXPLANATION-END id=function:class_belongs_to_soil

Function ``def clamp_class_to_soil``
------------------------------------

.. CG-BLOCK id=function:clamp_class_to_soil lines=245-272

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 245-272
   :lineno-match:

.. CG-EXPLANATION-START id=function:clamp_class_to_soil

**What this does.** Returns the class unchanged if it belongs to the soil, and
nothing at all if it belongs to a different soil family.

**Why it is here.** This is where "lithology is hard truth" is enforced. A class
from the wrong soil column is not nudged or rank-mapped into the right family — it
is dropped, and the band comes back unclassified. A silt's "moderately firm" is
evidence about a silt somewhere else; turning it into a same-rank sand class would
dress a guess up as a reading, which the no-guessing rule (Data Integrity Rule 3)
forbids.

.. CG-EXPLANATION-END id=function:clamp_class_to_soil

Function ``def hand_settable_classes_for``
------------------------------------------

.. CG-BLOCK id=function:hand_settable_classes_for lines=273-296

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classifier.py
   :language: python
   :lines: 273-296
   :lineno-match:

.. CG-EXPLANATION-START id=function:hand_settable_classes_for

**What this does.** Lists every NAD class an engineer is allowed to set *by hand*
on a band of a given soil — both the clean and the with-admixture classes.

**Why it is here.** Both columns are offered because a hand-set class is the
engineer's judgement, and that judgement may include "this stretch is the silty
variant". The admixture-derived column only decides what the *machine* picks
automatically; it never limits what the engineer may state.

.. CG-EXPLANATION-END id=function:hand_settable_classes_for

