desktop.main.backendProbe
=========================

.. CG-PAGE source=desktop/src/main/backendProbe.ts complete=true

*Source file:* ``desktop/src/main/backendProbe.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a comment explaining the file for the reader. It describes how the main process (Electron's full-access half of the app) checks port ``8765`` — the fixed numbered network channel the backend listens on — to decide whether a backend answering there is one it is allowed to adopt as its own. In development and in the automated tests any listener on that port is fine, because the backend is started by hand or by the test harness and the security check is switched off. In a shipped (*packaged*) build it is not fine: a leftover backend from a crashed previous launch may still hold the port while carrying a DIFFERENT per-launch secret, and adopting it would make every real request fail from then on.

**Why it is here.** The trap this file avoids is a stale backend on the port. Each launch mints its own secret *token* (a short secret string a request carries to prove it comes from this launch), and the backend is told the same token. So a packaged probe sends this launch's token together with a special ``Origin`` marker — the one request shape the backend's guard inspects. Our own backend recognises the token and answers with a success code; a foreign leftover backend compares the token against its own different value, rejects it, and answers with a refused code. That refusal is the signal that this is not our backend and must not be adopted. The file is pure and free of Electron so both the packaged and development branches can be unit-tested.

.. CG-EXPLANATION-END id=module-header

``const NULL_ORIGIN``
---------------------

.. CG-BLOCK id=const:NULL_ORIGIN lines=27-44

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 27-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:NULL_ORIGIN

**What this does.** Defines the one ``Origin`` value the backend's guard requires the token to arrive with — the literal text ``null``. (``Origin`` is a header, a labelled field attached to a web request, that says where the request came from.)

**Why it is here.** The backend's security middleware only checks the token on requests carrying this exact origin marker, so the probe must send the same one for its token to be inspected at all. Naming it once here keeps the value in step with the backend.

.. CG-EXPLANATION-END id=const:NULL_ORIGIN

``function backendProbeHeaders``
--------------------------------

.. CG-BLOCK id=function:backendProbeHeaders lines=45-50

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 45-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:backendProbeHeaders

**What this does.** Returns the extra header fields the readiness probe should attach to its request. In a packaged build it returns the ``Origin: null`` marker together with this launch's token under the token header; in development it returns nothing at all.

**Why it is here.** Development is handled as the empty case on purpose: there the security guard is inactive and any listener on the port is adopted, so no token is needed. Only the packaged build carries the token, which is exactly where telling our backend apart from a stranger's actually matters.

.. CG-EXPLANATION-END id=function:backendProbeHeaders

``type ProbeVerdict``
---------------------

.. CG-BLOCK id=type:ProbeVerdict lines=51-69

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 51-69
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProbeVerdict

**What this does.** Names the three possible outcomes of a probe: ``reachable`` (a backend we own answered), ``foreign`` (something answered but refused our token — not ours), and ``unreachable`` (nothing usable answered). A *type* here is a note that a value must be exactly one of these words.

**Why it is here.** Reducing the raw numeric web response to three named verdicts gives the rest of the app one small, clear vocabulary to act on, instead of scattering checks for specific status numbers through the code.

.. CG-EXPLANATION-END id=type:ProbeVerdict

``function classifyBackendProbe``
---------------------------------

.. CG-BLOCK id=function:classifyBackendProbe lines=70-76

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 70-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyBackendProbe

**What this does.** Turns a probe's numeric HTTP status into one of the three verdicts. (An HTTP status is the numeric result code a web server returns; the 200-range means success and 403 means refused.) A success code is ``reachable``; a 403 in a packaged build is ``foreign``; anything else is ``unreachable``.

**Why it is here.** A 403 counts as ``foreign`` only in a packaged build, because that is the only place the token guard is switched on — in development a 403 would mean something else entirely. Folding that condition into one small, testable function keeps the packaged-versus-dev distinction correct and in a single place.

.. CG-EXPLANATION-END id=function:classifyBackendProbe

``const BACKEND_READY_POLL_MS``
-------------------------------

.. CG-BLOCK id=const:BACKEND_READY_POLL_MS lines=77-88

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 77-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKEND_READY_POLL_MS

**What this does.** Sets how often the readiness loop re-checks the backend — every 500 milliseconds, i.e. twice a second.

**Why it is here.** Twice a second notices a backend that has just come up almost at once, without checking so furiously that the polling itself becomes a burden while the app is still starting.

.. CG-EXPLANATION-END id=const:BACKEND_READY_POLL_MS

``function backendReadyDeadlineMs``
-----------------------------------

.. CG-BLOCK id=function:backendReadyDeadlineMs lines=89-93

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 89-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:backendReadyDeadlineMs

**What this does.** Returns how long the app is willing to wait for the backend to answer: three minutes in a packaged build, thirty seconds in development.

**Why it is here.** A packaged first launch is genuinely slow — the freshly installed compiled modules are scanned by antivirus on their first read, the import worker pool spins up, and the database has only just been created; the owner's installer test needed 33 seconds and the old 30-second limit wrongly declared it dead. Three minutes covers a slow laptop, while the loop's separate did-the-process-die bail-out still returns early on a real crash. A development restart keeps the short limit because none of that first-launch cost applies.

.. CG-EXPLANATION-END id=function:backendReadyDeadlineMs

``function backendReadyAttempts``
---------------------------------

.. CG-BLOCK id=function:backendReadyAttempts lines=94-96

.. literalinclude:: ../../../desktop/src/main/backendProbe.ts
   :language: typescript
   :lines: 94-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:backendReadyAttempts

**What this does.** Works out how many 500-millisecond checks fit inside the deadline, rounding up, so the polling loop knows how many times to try.

**Why it is here.** Deriving the attempt count from the deadline and the poll interval means the two are always consistent — changing either the deadline or the interval automatically produces the right number of attempts, with no hand-kept number to fall out of step.

.. CG-EXPLANATION-END id=function:backendReadyAttempts

