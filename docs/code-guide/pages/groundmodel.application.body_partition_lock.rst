groundmodel.application.body_partition_lock
===========================================

.. CG-PAGE source=src/groundmodel/application/body_partition_lock.py complete=true

*Source file:* ``src/groundmodel/application/body_partition_lock.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-88

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 1-88
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the body-partition lock file. It imports the lock-error helper, the model row, the model-kind constants and the contention error, and its long docstring explains the mutual exclusion the module provides.

**Why it is here.** Every body-partition write for one model ends in the same read-then-rewrite of its body rows, and two of them at once produced three different failures (a unique violation, a foreign-key violation, a deadlock), all reproduced live (owner dogfeed 2026-08-15). A single per-model transaction-scoped advisory lock (a named database lock that releases at commit and can be re-taken free within the same transaction) removes all three: the read and the rewrite happen under it. The docstring states the one multi-model rule — lock the litho parent before the geotech child — and why the child's lock must be taken up front, before a write that reaches the child through a foreign-key cascade (audit BP-3).

.. CG-EXPLANATION-END id=module-header

Class ``_BodyPartitionLockLogger`` — header
-------------------------------------------

.. CG-BLOCK id=class:_BodyPartitionLockLogger lines=89-91

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 89-91
   :lineno-match:

.. CG-EXPLANATION-START id=class:_BodyPartitionLockLogger

**What this does.** A tiny logger class for the module-level lock helpers.

**Why it is here.** The free functions are not classes, so they borrow a logger to keep their lines named after this module.

.. CG-EXPLANATION-END id=class:_BodyPartitionLockLogger

Method ``_BodyPartitionLockLogger``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:_BodyPartitionLockLogger.__init__ lines=92-96

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 92-96
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BodyPartitionLockLogger.__init__

**What this does.** Sets up the module-named logger.

**Why it is here.** So the contention log lines read as coming from this module.

.. CG-EXPLANATION-END id=method:_BodyPartitionLockLogger.__init__

Function ``def body_partition_lock_key``
----------------------------------------

.. CG-BLOCK id=function:body_partition_lock_key lines=97-114

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 97-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:body_partition_lock_key

**What this does.** Returns the lock key string for one model's body partition.

**Why it is here.** One key per model, shared by every writer, so the background recompute and a manual correlate contend on the SAME lock rather than two different ones.

.. CG-EXPLANATION-END id=function:body_partition_lock_key

Function ``async def lock_body_partition``
------------------------------------------

.. CG-BLOCK id=function:lock_body_partition lines=115-209

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 115-209
   :lineno-match:

.. CG-EXPLANATION-START id=function:lock_body_partition

**What this does.** Serialises this transaction's body-partition rewrite for a model: it tries the lock without waiting first, and if held, waits (logging the contention) and raises a contention error if the wait exceeds the timeout.

**Why it is here.** The lock is transaction-scoped and releases on commit or rollback. The non-blocking try makes real contention visible in the log. The timeout aborts the wait rather than hanging forever behind a wedged holder, and is re-raised as the domain error the API maps to a 409. Both lock queries run without auto-flushing so acquiring a lock never issues the first row write before the lock guarding it — belt and braces on the take-locks-before-writes rule.

.. CG-EXPLANATION-END id=function:lock_body_partition

Function ``async def lock_sibling_geotech_partitions``
------------------------------------------------------

.. CG-BLOCK id=function:lock_sibling_geotech_partitions lines=210-273

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 210-273
   :lineno-match:

.. CG-EXPLANATION-START id=function:lock_sibling_geotech_partitions

**What this does.** Locks every geotech child of a litho model's body partition in a canonical sorted order, returning the sibling ids.

**Why it is here.** Deleting a litho body fires a set-null cascade that hidden-writes the geotech child rows, so the child lock must be held before that delete, not after — the ABBA deadlock the module docstring describes (audit BP-3). It is the single shared copy of resolve-and-lock-sorted, and a no-op on a geotech model (which has no geotech children), so a caller holding a possibly-geotech model may call it unconditionally.

.. CG-EXPLANATION-END id=function:lock_sibling_geotech_partitions

Function ``async def lock_project_body_partitions``
---------------------------------------------------

.. CG-BLOCK id=function:lock_project_body_partitions lines=274-334

.. literalinclude:: ../../../src/groundmodel/application/body_partition_lock.py
   :language: python
   :lines: 274-334
   :lineno-match:

.. CG-EXPLANATION-START id=function:lock_project_body_partitions

**What this does.** Locks every body partition a project-wide restore will touch, up front, over the union of the models the project has now and the models the bundle carries, in the litho-then-geotech order.

**Why it is here.** A replace-restore wipes and re-inserts a project's litho and geotech rows then resolves every model, and taking each lock only at resolve time (after thousands of row locks) deadlocked with a concurrent recompute (BP-5). The rule every writer follows — lock before the first write — applies to the restore as a whole, and this is that up-front pass, ordered so two restores can never acquire in opposite orders.

.. CG-EXPLANATION-END id=function:lock_project_body_partitions

