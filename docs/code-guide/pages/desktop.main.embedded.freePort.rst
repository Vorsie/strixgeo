desktop.main.embedded.freePort
==============================

.. CG-PAGE source=desktop/src/main/embedded/freePort.ts complete=false

*Source file:* ``desktop/src/main/embedded/freePort.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/main/embedded/freePort.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its one tool — Node's ``createServer`` from the ``net`` module, which can open a network (TCP) socket. The long comment at the top states the file's whole job: hand back a network port number that nothing else on the machine is using, so the bundled database can listen on it.

**Why it is here.** This is the *main* process — the part of the Electron app with full operating-system access (files, child programs, windows), as opposed to the *renderer*, which is the sandboxed web page the user sees. A packaged copy of the app cannot hard-code a port such as ``5433``, because the target user is often a coworker who already runs their own PostgreSQL on that exact port; the app would then quietly connect to somebody else's database and the user would never see the mistake. The comment also states the honest limit of the approach: it can only rule out a port THIS launch already took, not one another program grabs a split-second later — so it fixes the half of the problem that is predictable and therefore worth code.

.. CG-EXPLANATION-END id=module-header

``const DEFAULT_ATTEMPTS``
--------------------------

.. CG-BLOCK id=const:DEFAULT_ATTEMPTS lines=21-36

.. literalinclude:: ../../../desktop/src/main/embedded/freePort.ts
   :language: typescript
   :lines: 21-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_ATTEMPTS

**What this does.** Sets ``DEFAULT_ATTEMPTS`` to ``10`` — how many times the code will ask the operating system for a free port before giving up. The comment beneath it opens the description of the ``acquireFreePort`` function in the next block.

**Why it is here.** A single named value, kept out of the function body so the retry budget is easy to find and change. Ten tries is generous: a fresh port request almost always succeeds on the first attempt, so needing ten means something is badly wrong and giving up is the right answer.

.. CG-EXPLANATION-END id=const:DEFAULT_ATTEMPTS

``function acquireFreePort``
----------------------------

.. CG-BLOCK id=function:acquireFreePort lines=37-57

.. literalinclude:: ../../../desktop/src/main/embedded/freePort.ts
   :language: typescript
   :lines: 37-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:acquireFreePort

**What this does.** Asks for a free port up to ten times and returns the first one this launch has not already claimed. It is handed two things: ``probe``, a function that returns a port the operating system currently considers free, and ``taken``, the set of ports already reserved earlier in this same launch. If every attempt keeps handing back an already-claimed port it gives up with a clear error listing what was claimed; and if ``probe`` itself fails, that error is thrown straight away rather than retried.

**Why it is here.** The plain "ask the OS for a free port" trick has a gap: between the moment the OS names a port and the moment the database actually binds it, the port is free again, and two quick probes in one launch can name the SAME number — which would point two servers at one port. Rejecting a repeat and asking again closes that self-collision. ``probe`` is passed in rather than called directly (this is *dependency injection* — handing a function its helpers so they can be swapped) so the retry logic can be tested with a fake port source, without opening real sockets. A ``probe`` that fails outright means "cannot open any socket at all", which will not improve on a second try, so surfacing that real error at once is more useful than a vague "ran out of attempts".

.. CG-EXPLANATION-END id=function:acquireFreePort

``function probeEphemeralPort``
-------------------------------

.. CG-BLOCK id=function:probeEphemeralPort lines=58-74

.. literalinclude:: ../../../desktop/src/main/embedded/freePort.ts
   :language: typescript
   :lines: 58-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:probeEphemeralPort

**What this does.** Opens a throwaway server socket, asks the operating system to pick any free port (that is what ``listen(0, ...)`` means), reads back the number the OS chose, closes the socket, and returns that number. It hands the result back as a *promise* — a value that arrives a little later — because opening and closing a socket is not instant.

**Why it is here.** This is the real port source ``acquireFreePort`` uses in production. It binds on ``127.0.0.1`` — the loopback address, meaning "this computer only" — on purpose, so it tests the exact kind of address the database and backend will really listen on; a machine whose firewall blocks outward-facing binds still succeeds here. If the OS ever reports no usable address, it closes the socket and fails with a plain message instead of returning a bogus port.

.. CG-EXPLANATION-END id=function:probeEphemeralPort

