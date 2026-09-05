groundmodel.application.batch_create_sections
=============================================

.. CG-PAGE source=src/groundmodel/application/batch_create_sections.py complete=true

*Source file:* ``src/groundmodel/application/batch_create_sections.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/application/batch_create_sections.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the batch section-creation use case. It imports the flexible mapping type, the section row, the section repository and the logger.

**Why it is here.** The docstring records why it exists: the single create-section endpoint commits once per call, so "Accept all tie-sections" firing one request per section would cost N commits and N round-trips. This loops the repository's create with flush-only (no per-row commit) and issues one commit at the end, so the whole batch is one transaction — one disk sync — through a single endpoint call.

.. CG-EXPLANATION-END id=module-header

Class ``BatchCreateSections`` — header
--------------------------------------

.. CG-BLOCK id=class:BatchCreateSections lines=26-35

.. literalinclude:: ../../../src/groundmodel/application/batch_create_sections.py
   :language: python
   :lines: 26-35
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchCreateSections

**What this does.** Declares the use-case class that creates several cross-sections atomically in one commit, documenting that the caller must not commit before calling it.

**Why it is here.** Why: recorded in the class + module docstrings — the caller owns the session and this class owns the single batch commit.

.. CG-EXPLANATION-END id=class:BatchCreateSections

Method ``BatchCreateSections``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:BatchCreateSections.__init__ lines=36-41

.. literalinclude:: ../../../src/groundmodel/application/batch_create_sections.py
   :language: python
   :lines: 36-41
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchCreateSections.__init__

**What this does.** Stores the session and builds the section repository over it, and names the logger.

**Why it is here.** Standard session-owned setup; the repository does the per-row create.

.. CG-EXPLANATION-END id=method:BatchCreateSections.__init__

Method ``BatchCreateSections``. ``async def execute``
-----------------------------------------------------

.. CG-BLOCK id=method:BatchCreateSections.execute lines=42-90

.. literalinclude:: ../../../src/groundmodel/application/batch_create_sections.py
   :language: python
   :lines: 42-90
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchCreateSections.execute

**What this does.** Creates every section from its keyword-argument dict, flushing (not committing) each through the repository with a per-row progress log, commits once, refreshes the rows so their server-set timestamps are populated, and returns them in input order.

**Why it is here.** Flushing rather than committing each row lets all the rows share one transaction, and the single commit makes the batch all-or-nothing (a *flush* sends the pending rows to the database without ending the transaction). The rows are refreshed after the commit so the caller can serialise their created and updated timestamps. The ``[i/total]`` prefix on each row is the loop-logging rule.

.. CG-EXPLANATION-END id=method:BatchCreateSections.execute

