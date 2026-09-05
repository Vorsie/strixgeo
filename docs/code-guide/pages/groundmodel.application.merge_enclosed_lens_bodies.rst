groundmodel.application.merge_enclosed_lens_bodies
==================================================

.. CG-PAGE source=src/groundmodel/application/merge_enclosed_lens_bodies.py complete=true

*Source file:* ``src/groundmodel/application/merge_enclosed_lens_bodies.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../src/groundmodel/application/merge_enclosed_lens_bodies.py
   :language: python
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the merge-enclosed-lens file: a long docstring plus imports (the partition lock, the section-projection helper, the litho-instance resolver, the scope guard, the domain merge planner, and the row types). The docstring explains the rule — a lithology split on one column only by a LOCAL lens should read as one body — and the two cases (a different-lithology lens whose bracketing hosts join the neighbour's continuous host, and a same-lithology lens that merges into its enclosing matrix). It also carries a prominent warning that NOTHING calls this today (debt #243).

**Why it is here.** The owner directives are cited in the docstring: 'the big sand is one body' (2026-06-05) and the same-lithology merge (2026-07-13). The docstring is unusually long on purpose: it corrects an earlier wording that made two investigations wrongly assume the merge had already run, and it records the non-negotiable order for any future caller — merge, reload the layers, recompute the partition, then build — because the merge re-stamps body ids in the database while the 3-D voxel build takes body identity from the frontend payload, so building first would leave the two disagreeing.

.. CG-EXPLANATION-END id=module-header

Class ``MergeEnclosedLensResult``
---------------------------------

.. CG-BLOCK id=class:MergeEnclosedLensResult lines=86-101

.. literalinclude:: ../../../src/groundmodel/application/merge_enclosed_lens_bodies.py
   :language: python
   :lines: 86-101
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeEnclosedLensResult

**What this does.** A dataclass reporting the pass: how many net-new correlation edges were created and how many planned edges already existed and were skipped.

**Why it is here.** The skipped count is what makes a re-run visibly *idempotent* — running the merge again creates nothing new. The constant above it marks the edges as ``manual`` + user-approved so the resolver groups them and an automatic cleanup never sweeps them.

.. CG-EXPLANATION-END id=class:MergeEnclosedLensResult

Class ``MergeEnclosedLensBodies`` — header
------------------------------------------

.. CG-BLOCK id=class:MergeEnclosedLensBodies lines=102-104

.. literalinclude:: ../../../src/groundmodel/application/merge_enclosed_lens_bodies.py
   :language: python
   :lines: 102-104
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeEnclosedLensBodies

**What this does.** Opens the use-case class with a one-line docstring: merge same-lithology host halves split by a local lens into one body.

**Why it is here.** Same use-case shape as its neighbours; it inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:MergeEnclosedLensBodies

Method ``MergeEnclosedLensBodies``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:MergeEnclosedLensBodies.__init__ lines=105-109

.. literalinclude:: ../../../src/groundmodel/application/merge_enclosed_lens_bodies.py
   :language: python
   :lines: 105-109
   :lineno-match:

.. CG-EXPLANATION-START id=method:MergeEnclosedLensBodies.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:MergeEnclosedLensBodies.__init__

Method ``MergeEnclosedLensBodies``. ``async def execute``
---------------------------------------------------------

.. CG-BLOCK id=method:MergeEnclosedLensBodies.execute lines=110-268

.. literalinclude:: ../../../src/groundmodel/application/merge_enclosed_lens_bodies.py
   :language: python
   :lines: 110-268
   :lineno-match:

.. CG-EXPLANATION-START id=method:MergeEnclosedLensBodies.execute

**What this does.** Plans and creates the merge edges for one section, then re-resolves. It scope-guards the model; takes the body-partition lock; loads the accepted layers with their lithology; loads the surface elevations so cross-column depth is compared in metres TAW; reads the section's along-order (the column adjacency the user sees); builds per-column elevation stacks; asks the domain planner for the merge edges; if none, commits and returns zero; otherwise inserts the edges as user-approved manual edges (canonical order, skipping any that already exist), re-runs the resolver so the split halves join into one body, commits once, and returns the counts.

**Why it is here.** The comments cite the reasons. The lock is taken before the first write, not at the resolver's later call, because the edge inserts otherwise race the debounced background body-recompute in a different lock order and deadlocked (owner dogfeed 2026-08-23); the lock is re-entrant, so the resolver's later take is free. The insert uses 'skip on conflict' on the canonical triple for idempotency, and it always stamps the section id because a merge is a section verb and omitting it once caused an integrity error. The merge is section-scoped — only the columns the user sees participate — per the docstring.

.. CG-EXPLANATION-END id=method:MergeEnclosedLensBodies.execute

