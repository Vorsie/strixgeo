desktop.main.httpPostJson
=========================

.. CG-PAGE source=desktop/src/main/httpPostJson.ts complete=true

*Source file:* ``desktop/src/main/httpPostJson.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/main/httpPostJson.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code). It describes one small, shared helper: send a single web request that submits data and reads the reply, give up after a time limit, and NEVER crash. In web terms this is a *POST* (a request that sends a body of data up to a server) carrying *JSON* (a plain-text way of writing structured data). It lives in Electron's *main process* (the part of the desktop app with full computer access). The note explains the one clean rule it offers callers: a request that finished carries its status code (the three-digit number saying how it went) and its parsed reply; any thrown trouble — a failed connection, or the timeout firing — collapses into a single "no answer came back" marker the caller can check without wrapping the call in its own error handling.

**Why it is here.** It was pulled out of the activation file's private send-a-request code once the diagnostics uploader became a second thing needing the identical "request, with a timeout, that never throws" behaviour — so there is now one copy with one set of behaviours instead of two that could drift apart. It borrows only the built-in web-request function (which a test can swap for a fake), so it stays fully testable with no Electron machinery involved.

.. CG-EXPLANATION-END id=module-header

``type HttpPostResult``
-----------------------

.. CG-BLOCK id=type:HttpPostResult lines=17-21

.. literalinclude:: ../../../desktop/src/main/httpPostJson.ts
   :language: typescript
   :lines: 17-21
   :lineno-match:

.. CG-EXPLANATION-START id=type:HttpPostResult

**What this does.** Defines the shape of the answer this helper gives back. A *type* is a note to the rest of the code about what a value may be. Here the answer is one of exactly two things: either ``{ kind: 'response' }`` carrying the status code and the parsed body, or ``{ kind: 'network-failure' }`` — the flag meaning no answer came back at all.

**Why it is here.** Spelling out the two possibilities as a single named shape forces every caller to handle both — a real reply and a total failure — and gives the "no answer" case a clear, checkable marker rather than a crash or a confusing empty value.

.. CG-EXPLANATION-END id=type:HttpPostResult

``const DEFAULT_POST_TIMEOUT_MS``
---------------------------------

.. CG-BLOCK id=const:DEFAULT_POST_TIMEOUT_MS lines=22-24

.. literalinclude:: ../../../desktop/src/main/httpPostJson.ts
   :language: typescript
   :lines: 22-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_POST_TIMEOUT_MS

**What this does.** Sets ``DEFAULT_POST_TIMEOUT_MS`` to ten thousand milliseconds (ten seconds) — how long a request may run before it is abandoned, unless a caller overrides it.

**Why it is here.** Ten seconds tolerates a genuinely slow internet link while making sure a dead or unresponsive server cannot leave the app hanging: when the limit is reached the request is aborted and reported as a network failure.

.. CG-EXPLANATION-END id=const:DEFAULT_POST_TIMEOUT_MS

``interface PostJsonOptions``
-----------------------------

.. CG-BLOCK id=interface:PostJsonOptions lines=25-53

.. literalinclude:: ../../../desktop/src/main/httpPostJson.ts
   :language: typescript
   :lines: 25-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PostJsonOptions

**What this does.** Describes the optional settings a caller may pass. An *interface* is a written description of the fields a value may carry. The fields are ``fetchImpl`` (the web-request function to use — normally the built-in one, but a fake can be supplied in tests), ``timeoutMs`` (a different time limit), and ``headers`` (extra labelled lines to add to the request, layered on top of the default "this is JSON" labels).

**Why it is here.** Making the web-request function and the timeout injectable is what keeps the helper testable — a test hands it a fake server and a tiny timeout and checks every branch offline. The extra headers slot exists because the two callers differ slightly: the activation calls need nothing extra, while the diagnostics uploader adds its own header.

.. CG-EXPLANATION-END id=interface:PostJsonOptions

``function postJson``
---------------------

.. CG-BLOCK id=function:postJson lines=54-85

.. literalinclude:: ../../../desktop/src/main/httpPostJson.ts
   :language: typescript
   :lines: 54-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:postJson

**What this does.** The helper itself. It picks the web-request function and timeout (its own defaults unless overridden), then starts a countdown that will abort the request when the time limit is reached. It sends the POST with the data converted to JSON text and the JSON labels set, and *awaits* the reply (``await`` pauses this step until the reply arrives while letting other work continue). It tries to read the reply as JSON, and if the reply has no valid JSON it treats the body as empty rather than failing. It returns the status code and parsed body on a completed request, or the "network-failure" marker if anything at all was thrown, and it always cancels the countdown timer on the way out.

**Why it is here.** This is the single, careful implementation of "one timed POST that never throws" the whole app relies on. Wrapping the request in a countdown that aborts it is how a hung server is turned into a prompt, catchable failure. Catching every thrown error and returning the plain "network-failure" marker means callers get one simple thing to branch on — keep the stored licence, or queue the diagnostics for later — instead of each having to handle raw crashes. Always cancelling the timer prevents a stray abort from firing after the request already finished.

.. CG-EXPLANATION-END id=function:postJson

