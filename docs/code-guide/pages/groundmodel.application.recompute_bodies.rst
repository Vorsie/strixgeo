groundmodel.application.recompute_bodies
========================================

.. CG-PAGE source=src/groundmodel/application/recompute_bodies.py complete=true

*Source file:* ``src/groundmodel/application/recompute_bodies.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the recompute-bodies file. The triple-quoted text is the *docstring* — the file's own written description; here it records an owner ruling and lays out the six-step flow the file follows. Below it the ``import`` lines pull in the tools the work needs: the body-partition lock, the litho-instance resolver, the two domain planners that turn section drawings into connectivity evidence, and the database row types (``BodyGeometryFactOrm``, ``LithoLayerOrm``, plus the model and section rows) and the two error types it can raise.

**Why it is here.** This file is one *use case* — one complete unit of work, here 'recompute body identity for a model' — and it *orchestrates*: it lists the steps and hands each to a domain service or the database. A *body* is one connected mass of the same lithology; the owner ruling quoted in the docstring says every same-litho mass that is geometrically connected must share one *body id* so qc and sample data can be pulled out by body. The docstring records the key decision: the evidence is kept in LAYER-id space, not body-id space, because layer ids never change, so re-running gives the same answer (it is *idempotent* — running twice leaves the same result as running once), whereas an earlier body-id design oscillated because a merge erased its own evidence on the next run (dogfeed 2026-08-12).

.. CG-EXPLANATION-END id=module-header

Class ``RecomputeBodiesResult``
-------------------------------

.. CG-BLOCK id=class:RecomputeBodiesResult lines=62-92

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 62-92
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeBodiesResult

**What this does.** A small immutable data holder — a *frozen dataclass*, whose fields are set once and cannot change afterward — reporting what one recompute did: how many connectivity ``facts`` it wrote, how many it dropped as stale, how many bodies merged, how many split, and any names a merge displaced.

**Why it is here.** These numbers feed the on-screen 'diff toast' that tells the engineer what changed. The docstring explains each count is measured from the layer stamps taken before and after the resolve, so an ordinal renumbering that recycles rows without changing membership is treated as noise, not as a false merge or split.

.. CG-EXPLANATION-END id=class:RecomputeBodiesResult

Class ``RecomputeBodies`` — header
----------------------------------

.. CG-BLOCK id=class:RecomputeBodies lines=93-102

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 93-102
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeBodies

**What this does.** Opens the use-case class and states in its docstring that the caller supplies an active database *session* (the open connection plus its pending, not-yet-saved changes) and that this class *commits* once — makes its whole batch of changes permanent — at the very end.

**Why it is here.** Committing once at the end makes the whole recompute a single *transaction*: a unit of work that either fully happens or, on any error, fully undoes itself, so the database is never left half-rebuilt. The class inherits ``GroundModelLogger`` so its steps are logged under this module's name, the project's logging convention.

.. CG-EXPLANATION-END id=class:RecomputeBodies

Method ``RecomputeBodies``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:RecomputeBodies.__init__ lines=103-107

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 103-107
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeBodies.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session, so this use case takes it rather than opening its own — that is what lets the whole operation share one transaction with whatever called it. Passing ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:RecomputeBodies.__init__

Method ``RecomputeBodies``. ``async def execute``
-------------------------------------------------

.. CG-BLOCK id=method:RecomputeBodies.execute lines=108-279

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 108-279
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeBodies.execute

**What this does.** The one public step. It logs what it received; refuses an empty payload (the drawing data sent from the screen); looks up the model's project and every section id in that project and refuses unless the payload covers exactly those sections; takes the model's body-partition lock; turns the section drawings into connectivity ``facts`` in layer-id space; reads the current layer-to-body assignment as a 'before' picture; drops any planned fact whose layer has since left the model; deletes the model's old facts and writes the surviving ones; re-runs the litho-instance resolver to re-stamp each layer's body id; reads the 'after' picture; counts merges and splits; commits once; and returns the result.

**Why it is here.** Every guard is load-bearing and the comments cite each reason. An empty payload is refused because the replace is wholesale — an empty one is a screen that fired before its data loaded and would split every merged body. The coverage gate refuses a partial payload because the replace is model-wide, and a partially-loaded client used to silently erase the omitted sections' connectivity evidence (audit P1-3). The *advisory lock* — a cooperative 'only one writer at a time' marker keyed on the model — is taken before any write because two concurrent full-replaces would interleave and the stale one could land last (owner dogfeed 2026-08-15). Identity keys on the raw formation row, not the soil class, so two same-soil masses under different formations stay separate bodies for the engineer to join by hand (owner 2026-09-01); the docstring flags that the 3-D paint path deliberately keeps the class collapse — a decided divergence, not a miss.

.. CG-EXPLANATION-END id=method:RecomputeBodies.execute

Function ``def _partition_diff``
--------------------------------

.. CG-BLOCK id=function:_partition_diff lines=280-310

.. literalinclude:: ../../../src/groundmodel/application/recompute_bodies.py
   :language: python
   :lines: 280-310
   :lineno-match:

.. CG-EXPLANATION-START id=function:_partition_diff

**What this does.** A helper that compares the before and after layer-to-body maps and returns two counts, bodies merged and bodies split. It looks only at layers present in both maps, groups each side's prior and surviving bodies, and counts a merge as a surviving body that drew on more than one prior body, a split as the mirror image.

**Why it is here.** The docstring states the reason: measuring the change from the layer partition, not from body-row churn, is what stops an ordinal renumbering — which recycles body rows without changing which layers belong together — from being reported as a merge or split the engineer never made.

.. CG-EXPLANATION-END id=function:_partition_diff

