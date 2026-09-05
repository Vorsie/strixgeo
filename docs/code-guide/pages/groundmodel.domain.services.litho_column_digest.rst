groundmodel.domain.services.litho_column_digest
===============================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_column_digest.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_column_digest.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-63

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 1-63
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure helper that reduces one column's accepted litho stack to a short comparison tag, and imports the hashing tool and the digest's tuning constants.

**Why it is here.** The docstring frames debt #266: geotech packing bands have no link back to the litho stack they subdivide, so moving one litho contact leaves the bands silently describing ground that no longer exists. The chosen fix is a digest computed FROM the rows as they now stand, which the comments argue is safer than a counter each edit bumps, because over forty verbs mutate litho and database triggers rewrite neighbour rows behind them; a digest cannot be bypassed by a verb or a trigger that never knew geotech existed.

.. CG-EXPLANATION-END id=module-header

Class ``LithoColumnInterval``
-----------------------------

.. CG-BLOCK id=class:LithoColumnInterval lines=64-86

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 64-86
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoColumnInterval

**What this does.** A frozen data holder for one accepted litho interval on a column: its top and base depth below the collar, and the formation id it belongs to.

**Why it is here.** The docstring is careful that the formation id is identity, not label: renaming a formation or editing its admixtures leaves the id alone, so the bands stay correct, while re-classifying an interval to a DIFFERENT soil re-points the id and correctly marks the bands stale. This is exactly the distinction the staleness check must respect.

.. CG-EXPLANATION-END id=class:LithoColumnInterval

Function ``def _canonical_record``
----------------------------------

.. CG-BLOCK id=function:_canonical_record lines=87-101

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 87-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_record

**What this does.** Renders one interval to a single fixed-format string: top depth, base depth, and formation id, each rounded to millimetre precision and joined by a separator. It nudges a rounded negative zero back to positive zero.

**Why it is here.** A digest can only be compared if the same stack always renders to exactly the same text. The negative-zero fix stops two identical stacks from differing by a sign no depth actually carries. Millimetre rounding is deliberate: the base depth is a derived value that a database trigger can re-round through floating point without anyone moving anything, so sub-millimetre slack must not read as an edit.

.. CG-EXPLANATION-END id=function:_canonical_record

Function ``def litho_column_digest``
------------------------------------

.. CG-BLOCK id=function:litho_column_digest lines=102-129

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 102-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:litho_column_digest

**What this does.** Sorts the interval records, joins them into one canonical block of text, hashes it, and returns a version-tagged short string. Equal digests mean the same stack at millimetre resolution; different digests mean it moved, was reclassified, or gained or lost an interval.

**Why it is here.** Sorting before hashing makes the answer a fact about the stack, never about the order rows happened to arrive in. An empty stack is a legal reading with its own digest, which is what lets bands over a cleared column read as stale rather than merely unknown. The version prefix means a future change to what is digested announces itself instead of silently comparing against the old shape.

.. CG-EXPLANATION-END id=function:litho_column_digest

Function ``def stale_column_ids``
---------------------------------

.. CG-BLOCK id=function:stale_column_ids lines=130-162

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 130-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:stale_column_ids

**What this does.** Compares the digests recorded when each column's bands were built against the digests of the litho under those columns now, and returns the sorted ids of the columns that disagree, including columns whose litho is gone entirely.

**Why it is here.** The docstring makes one choice load-bearing: a column with NO recorded digest is not stale. Every project banded before this feature shipped is in that state, and flagging them would raise a false model-wide alarm and teach the engineer the indicator means nothing. This mirrors the codebase's compare-on-load pattern: stamp what a build used, derive staleness, never store a flag that must be cleared.

.. CG-EXPLANATION-END id=function:stale_column_ids

Function ``def next_stamp_map``
-------------------------------

.. CG-BLOCK id=function:next_stamp_map lines=163-211

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest.py
   :language: python
   :lines: 163-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:next_stamp_map

**What this does.** Folds one geotech press's results into the stored provenance map by three rules: a rebuilt column takes its fresh digest, an untouched but still-banded column keeps its old digest, and a column with no bands left is dropped.

**Why it is here.** The docstring ties each rule to a concrete need. Taking the fresh digest for rebuilt columns is what makes re-pressing the only way to clear the warning, with no dismiss button that would skip the work. Keeping old digests for untouched columns stops a borehole press from wrongly clearing CPT columns banded by a different press. Dropping columns with no bands avoids sending the engineer to rebuild something that is not there. A banded column in neither map stays unstamped, because guessing its provenance would be wrong exactly when the ground has moved.

.. CG-EXPLANATION-END id=function:next_stamp_map

