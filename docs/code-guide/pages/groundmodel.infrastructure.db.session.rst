groundmodel.infrastructure.db.session
=====================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/session.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/session.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/session.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Creates the one async database engine and the session factory the whole app shares: it builds the engine from the configured address with the shared per-connection timeout settings and connection health-checking, and makes a session factory from it.

**Why it is here.** An *engine* holds a reusable *pool* of open database connections, and a *session* is one unit of database conversation. The comments record two deliberate choices: statement echo is gated on its own flag, never the general debug flag, because echo would print the address and leak the password into the log; and the per-connection timeout settings mean a request fails loudly (and becomes a clean "busy" answer) instead of hanging on a contended lock, while an abandoned transaction is reaped rather than pinning a connection forever. Health-checking a pooled connection on checkout replaces one whose transport died (for example after the embedded database restarted).

.. CG-EXPLANATION-END id=module-header

Function ``def get_queue``
--------------------------

.. CG-BLOCK id=function:get_queue lines=32-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/session.py
   :language: python
   :lines: 32-42
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_queue

**What this does.** Returns a synchronous job queue wired to the shared session factory, importing the queue type lazily.

**Why it is here.** It is offered as a *dependency* — a value FastAPI supplies to a request handler on demand. The late import avoids a start-up loop between the session module and the queue module.

.. CG-EXPLANATION-END id=function:get_queue

Function ``async def get_session``
----------------------------------

.. CG-BLOCK id=function:get_session lines=43-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/session.py
   :language: python
   :lines: 43-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_session

**What this does.** Hands a request handler a database session, then — after the handler finishes or fails — rolls back any uncommitted work and returns the connection to the pool.

**Why it is here.** FastAPI calls this before each request and closes it after (this is the *generator* dependency pattern, where the code after the yield is the clean-up). The automatic rollback-and-return guarantees no request leaks a connection or leaves a half-finished transaction behind, whether it succeeded or raised.

.. CG-EXPLANATION-END id=function:get_session

