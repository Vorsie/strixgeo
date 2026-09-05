desktop.renderer.src.api.clients.shared
=======================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/shared.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/shared.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports for the shared HTTP layer. The comment names what this one file provides for every other client: the current backend address, the ``setBaseUrl`` function that sets it, the single ``request`` core that every call funnels through, and five short typed wrappers (``get``, ``del``, ``patch``, ``put``, ``post``). The imports pull in a diagnostics recorder, the logger, the two network-health counters, and a helper that turns a server refusal code into readable text.

**Why it is here.** This is the app's *HTTP client* — the code that sends a request over the local web connection to the Python engine and hands back the reply. (A *request* is one message asking the engine to read or change something; *HTTP* is the everyday web protocol the browser already speaks.) It is written once, in one place, so that every subject client — CPT, borehole, geology and the rest — shares exactly the same address, the same failure handling and the same reachability tracking. The comment's last line records the boundary: nothing in this file knows about any particular endpoint; it only knows how to make a call and how to react when one fails.

.. CG-EXPLANATION-END id=module-header

``let _base``
-------------

.. CG-BLOCK id=let:_base lines=18-27

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 18-27
   :lineno-match:

.. CG-EXPLANATION-START id=let:_base

**What this does.** Holds the backend's web address, starting at ``http://127.0.0.1:8765``. Every call in the app is built by sticking a path onto the end of this value.

**Why it is here.** ``127.0.0.1`` is *localhost* — this same machine — and ``8765`` is the port the bundled Python engine listens on, so all traffic stays inside the computer and never touches the internet. It is a changeable value rather than a fixed constant because the packaged engine can be told to use a different port at start-up; the very next function exists to overwrite it.

.. CG-EXPLANATION-END id=let:_base

``function setBaseUrl``
-----------------------

.. CG-BLOCK id=function:setBaseUrl lines=28-34

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 28-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:setBaseUrl

**What this does.** Replaces the stored backend address with a new one.

**Why it is here.** At boot the main Electron process starts the Python engine, learns which port it actually bound to, and calls this once to point the whole client layer at the live address. Centralising the address in one setter means one call reconfigures every request in the app.

.. CG-EXPLANATION-END id=function:setBaseUrl

``const stripQuery``
--------------------

.. CG-BLOCK id=const:stripQuery lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:stripQuery

**What this does.** A tiny helper that cuts a URL path off at the ``?``, keeping only the part before the query string.

**Why it is here.** It is used only when writing to the local log. The comment explains the reason: a future licence key or session token could one day travel in a query parameter, and cutting the query off before logging keeps such secrets out of the renderer's log stream. The full path is still kept in the thrown error text, which is for developer diagnostics and not persisted.

.. CG-EXPLANATION-END id=const:stripQuery

``const MUTATING_METHODS``
--------------------------

.. CG-BLOCK id=const:MUTATING_METHODS lines=38-48

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 38-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:MUTATING_METHODS

**What this does.** A fixed set of the four HTTP verbs that change data on the engine: ``POST``, ``PUT``, ``PATCH`` and ``DELETE``.

**Why it is here.** An HTTP *verb* (or method) says what kind of action a request is: ``GET`` only reads, while these four create, replace, edit or remove something. The set is named so the timeout logic below can treat state-changing calls differently from harmless reads — only a change that never answers leaves a button spinning forever.

.. CG-EXPLANATION-END id=const:MUTATING_METHODS

``const MUTATION_TIMEOUT_MS``
-----------------------------

.. CG-BLOCK id=const:MUTATION_TIMEOUT_MS lines=49-61

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 49-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:MUTATION_TIMEOUT_MS

**What this does.** Sets the time budget for a state-changing request to 60 000 milliseconds — one minute.

**Why it is here.** The docstring records the decision: a create, update or delete that never answers leaves the caller stuck in its busy state forever (the button keeps spinning). Sixty seconds is far longer than any healthy round-trip on this machine — even a large GEF file parse — so the limit only ever trips on a genuinely wedged engine, where showing a visible error is better than an endless hang.

.. CG-EXPLANATION-END id=const:MUTATION_TIMEOUT_MS

``const SLOW_MUTATION_HINTS``
-----------------------------

.. CG-BLOCK id=const:SLOW_MUTATION_HINTS lines=62-79

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 62-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:SLOW_MUTATION_HINTS

**What this does.** A list of URL fragments that mark the long-running jobs: rebuilding surfaces, the voxel build, recomputing bodies, building the ground surface, geotech subdivision, dividing boreholes, auto-correlation, every export, a bundle restore, a multi-file CPT import and the build report.

**Why it is here.** The docstring explains that these compute, build and export jobs legitimately run for minutes on a real model, and each already shows its own progress UI, so cutting them off at 60 seconds would be a far worse regression than the hung button the timeout is meant to fix. They are matched as pieces of the URL because the timeout code only ever sees the URL. The warning in the comment is load-bearing: any new long-running POST endpoint MUST be added to this list or it will be killed after a minute.

.. CG-EXPLANATION-END id=const:SLOW_MUTATION_HINTS

``function isSlowMutation``
---------------------------

.. CG-BLOCK id=function:isSlowMutation lines=80-107

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 80-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:isSlowMutation

**What this does.** Answers true when the given URL contains any of the long-running fragments listed above.

**Why it is here.** It is the one test the timeout logic uses to let a legitimate multi-minute build opt out of the one-minute guillotine. Keeping the check in a named function keeps the intent readable at the call site.

.. CG-EXPLANATION-END id=function:isSlowMutation

``function withMutationTimeout``
--------------------------------

.. CG-BLOCK id=function:withMutationTimeout lines=108-130

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 108-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:withMutationTimeout

**What this does.** Decides whether to attach an automatic one-minute cut-off to a request. It leaves a request untouched when it is a read (``GET``/``HEAD``), when the caller already supplied its own cancellation control, or when the URL is one of the long-running jobs; otherwise it returns a copy of the request settings carrying a 60-second timeout signal.

**Why it is here.** The docstring lays out the three carve-outs: a hung read is merely annoying rather than a stuck busy state, a caller that brought its own cancellation keeps full ownership of it, and the slow compute jobs must never be cut off. ``AbortSignal.timeout`` makes the browser reject the call with a timeout error after the budget, so a wedged mutation surfaces as a visible failure instead of a promise that never settles.

.. CG-EXPLANATION-END id=function:withMutationTimeout

``function detailCode``
-----------------------

.. CG-BLOCK id=function:detailCode lines=131-163

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 131-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:detailCode

**What this does.** Looks at the parsed ``detail`` the server sent back on a failure and, if it is an object carrying a non-empty ``code`` text, returns that code; otherwise returns nothing.

**Why it is here.** The docstring notes that around twenty refusal routes send their ``detail`` as an object with a short machine code (for example ``cpt_refresh_refused``). Lifting that code out lets the local diagnostics line record a searchable token, so a 4xx refusal can be found in the log without reading the prose.

.. CG-EXPLANATION-END id=function:detailCode

``class ApiError``
------------------

.. CG-BLOCK id=class:ApiError lines=164-218

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 164-218
   :lineno-match:

.. CG-EXPLANATION-START id=class:ApiError

**What this does.** Defines a special failure value, ``ApiError``, thrown whenever the engine answers with a non-success status. Alongside the human message it carries four typed fields: ``status`` (the HTTP status number), ``detail`` (whatever structured reason the server sent), ``method`` (the verb used) and ``path`` (the address called).

**Why it is here.** An *error class* is a labelled failure value that code can inspect by its fields instead of by reading its message text. The docstring records why that matters here: callers used to detect "the project row is gone" by string-matching the message for ``→ 404``, but that text is only produced when the server sends no detail — and the engine's 404s always send one — so the match was dead code and the ``.strix`` disaster-recovery restore behind it never fired. The rule the class enforces is that a decision made across the app boundary must read a field, never an incidental string. The ``status`` field carries the HTTP status code, which falls into three bands the app meets constantly: 2xx means success (200 OK for a read, 201 Created for a new record, 204 No Content for a delete that returns nothing); 4xx means the engine understood the request but refused it (400 a malformed request, 404 the thing was not found, 409 a conflict — the code used for the consented CPT-refresh guard, 422 a validation refusal); and 5xx means the engine itself failed (500 an internal error whose traceback stays in the backend log, and 502/503/504 the engine being unreachable, unavailable, or too slow to answer). The ``message`` text is kept identical to the plain error it replaced, so every existing toast that shows ``err.message`` keeps its exact wording.

.. CG-EXPLANATION-END id=class:ApiError

``function isApiStatus``
------------------------

.. CG-BLOCK id=function:isApiStatus lines=219-243

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 219-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:isApiStatus

**What this does.** A yes/no test: true only when a caught failure is an ``ApiError`` carrying exactly the status number asked about.

**Why it is here.** It is the safe way to branch on a status — ``isApiStatus(err, 404)`` instead of matching text. The docstring carries an important limit: it can only ever be true for failures raised by the shared ``request`` core, so a handful of clients that make a bare ``fetch`` by hand (listed in the docstring — multipart CPT upload, several litho editing calls) never produce an ``ApiError`` and always test false. Until those are routed through ``request`` it is debt, and code must not gate behaviour on their status.

.. CG-EXPLANATION-END id=function:isApiStatus

``function apiErrorDetail``
---------------------------

.. CG-BLOCK id=function:apiErrorDetail lines=244-277

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 244-277
   :lineno-match:

.. CG-EXPLANATION-START id=function:apiErrorDetail

**What this does.** Pulls the structured ``detail`` object off a caught failure, returning it only when the failure is an ``ApiError`` whose detail is a genuine object; in every other case it returns nothing.

**Why it is here.** The docstring explains that around twenty routes attach an object to the refusal carrying a machine code plus whatever the app needs to offer a retry — a suggested spacing, a layer id, and so on. A caller that wants to react to the code must read the object, never the sentence: sending a number instead of prose is the whole point of the structured detail.

.. CG-EXPLANATION-END id=function:apiErrorDetail

``function detailMessage``
--------------------------

.. CG-BLOCK id=function:detailMessage lines=278-331

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 278-331
   :lineno-match:

.. CG-EXPLANATION-START id=function:detailMessage

**What this does.** Works out the best human sentence for a server ``detail`` of any shape: if it is already text, use it; if it is an object with a ``message`` field, use that; otherwise write it out as JSON text rather than lose it.

**Why it is here.** The docstring records a real incident: turning an object straight into text produces the useless string ``[object Object]``, and on 2026-08-02 that swallowed a ``voxel_grid_too_large`` refusal whole — the reason, the retry spacing and the fact that nothing had been written all reached the app on the wire, yet none of it reached the engineer. Serialising as a last resort guarantees an object detail is never silently destroyed; unlovely text beats a toast that says nothing. It is exported because the bare-``fetch`` clients hit the same object details and reuse this rule rather than re-deriving it.

.. CG-EXPLANATION-END id=function:detailMessage

``function fetchTracked``
-------------------------

.. CG-BLOCK id=function:fetchTracked lines=332-381

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 332-381
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetchTracked

**What this does.** Wraps the browser's built-in ``fetch`` and, around every call, updates the backend-reachability signal. It tries the fetch; if the fetch is rejected it counts a network failure (unless the app itself aborted the call) and re-throws; if any answer comes back it records a success and returns the response.

**Why it is here.** *fetch* is the browser's own request function, and it returns a *Promise* — a stand-in for an answer that will arrive later. This is the single transport boundary of the whole renderer: the typed wrappers reach it through ``request``, and the hand-rolled clients call it directly, so reachability is measured in exactly one place. The docstring explains why that matters: the signal used to live inside ``request`` only, and nine everyday editing gestures used a bare ``fetch``, so a whole session editing against a dead engine could rack up failures without ever moving the counter and the warning banner never appeared. The semantics are precise: a *rejected* fetch means nothing answered (the engine is down), but *any* response — even a 500 — proves the engine is alive; and an abort the app asked for (a screen closing, a superseded fetch) is the app's own doing and never counts against reachability.

.. CG-EXPLANATION-END id=function:fetchTracked

``function request``
--------------------

.. CG-BLOCK id=function:request lines=382-463

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 382-463
   :lineno-match:

.. CG-EXPLANATION-START id=function:request

**What this does.** The single core every typed call funnels through. It builds the request settings for the verb, and when a body is supplied it marks the request as JSON and packs the body into JSON text. It sends the call through ``fetchTracked``. If the answer is a success it hands the raw response back. If it is a failure it reads the server's ``detail``, writes a log line, records a diagnostic — a 5xx as an error, a 4xx as a warning carrying the machine code — and throws an ``ApiError`` carrying the status, the detail, the verb and the path.

**Why it is here.** *JSON* is the plain-text format the app and the engine use to exchange structured data, and *async/await* lets this function pause for the network answer without freezing the interface — it is marked ``async`` and it ``await``s the fetch, so the window stays responsive while the engine works. Putting the whole send-and-check sequence in one place means every call in the app fails the same way, logs the same way and is recorded the same way. The comments record the deliberate choices: the server's own ``detail`` is surfaced instead of an opaque ``→ 409`` so a refusal like "delete the dependent model first" reaches the engineer; a 5xx is captured because it is a bug nobody else witnesses (its traceback stays in the backend log on the user's own machine); a 4xx is the engine refusing something the user did, still worth a file trace, captured at warning severity with its code. Query strings are stripped from the logged path so a future token cannot leak into the log.

.. CG-EXPLANATION-END id=function:request

``function getBytes``
---------------------

.. CG-BLOCK id=function:getBytes lines=464-500

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 464-500
   :lineno-match:

.. CG-EXPLANATION-START id=function:getBytes

**What this does.** A read helper for the binary export endpoints: it runs a ``GET`` through ``request`` and returns the raw bytes of the answer instead of parsing them.

**Why it is here.** The docstring explains that export answers are files, not data to read on screen — the caller pipes the bytes straight to a save dialog and writes them to disk, so nothing is parsed on success. It uses the shared ``request`` core introduced above, so a failed export still throws an ``ApiError`` that surfaces through the caller's toast.

.. CG-EXPLANATION-END id=function:getBytes

``function postBytes``
----------------------

.. CG-BLOCK id=function:postBytes lines=501-527

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 501-527
   :lineno-match:

.. CG-EXPLANATION-START id=function:postBytes

**What this does.** The send-and-receive-bytes sibling of ``getBytes``: it ``POST``s a JSON body through ``request`` and returns the raw bytes of the answer.

**Why it is here.** The docstring gives the reason it exists separately: some exports need an input too large for a query string — the Deltares D-Series targets need the section's drawn partition fill, which can run to thousands of polygons — so the input goes in the body while the output is still a file. It reuses the shared ``request`` core, so the engine's ``detail.message`` (for example the 422 "draw the section fill first" refusal) reaches the toast verbatim.

.. CG-EXPLANATION-END id=function:postBytes

``function get``
----------------

.. CG-BLOCK id=function:get lines=528-549

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 528-549
   :lineno-match:

.. CG-EXPLANATION-START id=function:get

**What this does.** The everyday typed read: it runs a ``GET`` through ``request`` and parses the JSON answer into a value.

**Why it is here.** The ``<T>`` is a *generic type* — a placeholder the caller fills in, so this one function returns whatever shape the endpoint promises and the rest of the app knows the answer's fields. It is the thin wrapper most reads go through, all failure handling already done by the shared ``request`` core introduced above.

.. CG-EXPLANATION-END id=function:get

``function del``
----------------

.. CG-BLOCK id=function:del lines=550-574

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 550-574
   :lineno-match:

.. CG-EXPLANATION-START id=function:del

**What this does.** A typed delete for endpoints that return nothing: it runs a ``DELETE`` through ``request`` and ignores the answer.

**Why it is here.** The shared ``request`` core introduced above already throws on any non-success status, so this wrapper only needs to fire the delete; a 204 No Content answer carries no body to read.

.. CG-EXPLANATION-END id=function:del

``function delReturning``
-------------------------

.. CG-BLOCK id=function:delReturning lines=575-601

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 575-601
   :lineno-match:

.. CG-EXPLANATION-START id=function:delReturning

**What this does.** A typed delete for endpoints that do answer with data: it runs a ``DELETE`` through ``request`` and parses the JSON answer.

**Why it is here.** The docstring notes it is for deletes that return a result — such as a deleted-count summary — rather than an empty 204; it reuses the same shared ``request`` core introduced above.

.. CG-EXPLANATION-END id=function:delReturning

``function patch``
------------------

.. CG-BLOCK id=function:patch lines=602-628

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 602-628
   :lineno-match:

.. CG-EXPLANATION-START id=function:patch

**What this does.** The typed edit: it sends a JSON body with the ``PATCH`` verb through ``request`` and parses the JSON answer.

**Why it is here.** ``PATCH`` changes part of an existing record; this wrapper carries an optional fallback label for older error copy but otherwise leans entirely on the shared ``request`` core introduced above.

.. CG-EXPLANATION-END id=function:patch

``function put``
----------------

.. CG-BLOCK id=function:put lines=629-655

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 629-655
   :lineno-match:

.. CG-EXPLANATION-START id=function:put

**What this does.** The typed replace: it sends a JSON body with the ``PUT`` verb through ``request`` and parses the JSON answer.

**Why it is here.** ``PUT`` replaces a record wholesale where ``PATCH`` edits part of it; like the others it is a thin wrapper over the shared ``request`` core introduced above.

.. CG-EXPLANATION-END id=function:put

``function post``
-----------------

.. CG-BLOCK id=function:post lines=656-659

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/shared.ts
   :language: typescript
   :lines: 656-659
   :lineno-match:

.. CG-EXPLANATION-START id=function:post

**What this does.** The typed create-or-command: it sends an optional JSON body with the ``POST`` verb through ``request`` and parses the JSON answer.

**Why it is here.** ``POST`` creates a record or triggers an action; the body is optional because some commands need no payload. It closes the family of five typed wrappers, all sharing the ``request`` core introduced above.

.. CG-EXPLANATION-END id=function:post

