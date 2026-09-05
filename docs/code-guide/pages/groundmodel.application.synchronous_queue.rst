groundmodel.application.synchronous_queue
=========================================

.. CG-PAGE source=src/groundmodel/application/synchronous_queue.py complete=true

*Source file:* ``src/groundmodel/application/synchronous_queue.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the CPT importer, the abstract queue, and the job types for the inline queue below.

**Why it is here.** A short header for the MVP queue.

.. CG-EXPLANATION-END id=module-header

Class ``SynchronousQueue`` — header
-----------------------------------

.. CG-BLOCK id=class:SynchronousQueue lines=14-32

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 14-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:SynchronousQueue

**What this does.** The MVP task queue: it runs each job right where it is submitted, with no separate worker process or broker, so the caller waits until the job finishes.

**Why it is here.** The docstring records the deliberate choice: this keeps the code queue-shaped (swappable for a real broker later) without the operational cost of one before it is needed. When a broker is added, only this class is replaced — nothing else changes (the queue-ready rule).

.. CG-EXPLANATION-END id=class:SynchronousQueue

Method ``SynchronousQueue``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:SynchronousQueue.__init__ lines=33-37

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 33-37
   :lineno-match:

.. CG-EXPLANATION-START id=method:SynchronousQueue.__init__

**What this does.** Stores a session factory used to open a fresh database session per job.

**Why it is here.** Each job opens and commits its own session, matching the one-session-per-use-case rule.

.. CG-EXPLANATION-END id=method:SynchronousQueue.__init__

Method ``SynchronousQueue``. ``async def enqueue``
--------------------------------------------------

.. CG-BLOCK id=method:SynchronousQueue.enqueue lines=38-58

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 38-58
   :lineno-match:

.. CG-EXPLANATION-START id=method:SynchronousQueue.enqueue

**What this does.** Runs the job inline: marks it running, executes it, marks it done, or on any failure marks it failed with the error and re-raises.

**Why it is here.** Because it runs inline, the caller blocks until completion, and the job's status and result are updated in place. Entry and outcome are logged (the Definition-of-Done logging rule).

.. CG-EXPLANATION-END id=method:SynchronousQueue.enqueue

Method ``SynchronousQueue``. ``async def get_status``
-----------------------------------------------------

.. CG-BLOCK id=method:SynchronousQueue.get_status lines=59-65

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 59-65
   :lineno-match:

.. CG-EXPLANATION-START id=method:SynchronousQueue.get_status

**What this does.** Always raises not-implemented.

**Why it is here.** The synchronous queue keeps no persistent job store — results come straight back from enqueue — so there is nothing to query later.

.. CG-EXPLANATION-END id=method:SynchronousQueue.get_status

Method ``SynchronousQueue``. ``async def _execute``
---------------------------------------------------

.. CG-BLOCK id=method:SynchronousQueue._execute lines=66-72

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 66-72
   :lineno-match:

.. CG-EXPLANATION-START id=method:SynchronousQueue._execute

**What this does.** Dispatches to the right use case based on the job's type, raising on an unknown type.

**Why it is here.** The single place that maps a job type to its handler; an unknown type fails loudly.

.. CG-EXPLANATION-END id=method:SynchronousQueue._execute

Method ``SynchronousQueue``. ``async def _run_import_cpt``
----------------------------------------------------------

.. CG-BLOCK id=method:SynchronousQueue._run_import_cpt lines=73-82

.. literalinclude:: ../../../src/groundmodel/application/synchronous_queue.py
   :language: python
   :lines: 73-82
   :lineno-match:

.. CG-EXPLANATION-START id=method:SynchronousQueue._run_import_cpt

**What this does.** Runs a CPT-import job: opens a session, imports the file at the job's path, and stores the resulting id in the job result.

**Why it is here.** The one job type wired today; it follows the one-session-per-job rule and returns the new CPT id to the caller.

.. CG-EXPLANATION-END id=method:SynchronousQueue._run_import_cpt

