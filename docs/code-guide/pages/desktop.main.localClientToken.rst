desktop.main.localClientToken
=============================

.. CG-PAGE source=desktop/src/main/localClientToken.ts complete=true

*Source file:* ``desktop/src/main/localClientToken.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code) and its one import. The note explains a security problem and this file's answer to it. The desktop app runs a small local web server (the backend) that the app's own web page talks to; that server listens only on the machine itself and has no password. In an installed build the page is loaded from a ``file://`` address, which the browser reports as the origin ``null`` — and that same ``null`` origin is also sent by any stray sandboxed frame or ``data:`` document on any website the engineer happens to visit while StrixGeo is running. Without a further check, such a page could quietly ask the backend for a project's data or even delete parts of the model. The answer: identity stops being "where the request came from" and becomes a *secret*. At launch the main process makes a random *token* (an unguessable string that acts like a one-time password), hands it to the backend, and attaches it as a header on every request the app's page sends to the backend. A page on the open web can never attach a value it was never given.

**Why it is here.** It closes a real hole: a loopback server with no password plus a ``null`` origin that is not ours alone would let a hostile web page reach the backend. The token is attached in the *main process* (the part of the app with full computer access), not by the page's own code, on purpose — the page never holds the token, so even a page compromised inside our own window cannot steal and leak it, and no piece of code can forget to add it. Headers added there are also invisible to the page, so they do not disturb the browser's cross-site request checks. The names defined here must match the backend's own copy in ``local_client_token_constants.py``.

.. CG-EXPLANATION-END id=module-header

``const LOCAL_CLIENT_TOKEN_ENV_VAR``
------------------------------------

.. CG-BLOCK id=const:LOCAL_CLIENT_TOKEN_ENV_VAR lines=32-34

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOCAL_CLIENT_TOKEN_ENV_VAR

**What this does.** Defines the name ``STRIX_API_TOKEN`` — the *environment variable* through which the backend is told what the expected token is. An environment variable is a named value the app sets when it launches the backend program, which that program can then read.

**Why it is here.** The main process and the backend need to agree on the same secret. Passing it as an environment variable at launch hands the token to the backend directly, without ever writing it into a file on disk where it could linger or leak. Naming it once, here, keeps the two sides in step (the backend reads a variable of this exact name).

.. CG-EXPLANATION-END id=const:LOCAL_CLIENT_TOKEN_ENV_VAR

``const LOCAL_CLIENT_TOKEN_HEADER``
-----------------------------------

.. CG-BLOCK id=const:LOCAL_CLIENT_TOKEN_HEADER lines=35-45

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 35-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOCAL_CLIENT_TOKEN_HEADER

**What this does.** Defines the name ``X-StrixGeo-Token`` — the *HTTP header* the token travels in. A header is a labelled line of extra information attached to a web request alongside its address and body.

**Why it is here.** The token has to ride along with every request to the backend, and a custom header is the natural, unobtrusive place to carry it. Naming it once keeps the sender (the main process) and the checker (the backend) agreeing on the same label.

.. CG-EXPLANATION-END id=const:LOCAL_CLIENT_TOKEN_HEADER

``function mintLocalClientToken``
---------------------------------

.. CG-BLOCK id=function:mintLocalClientToken lines=46-69

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 46-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:mintLocalClientToken

**What this does.** Makes a fresh token for this launch: 32 random bytes produced by the operating system's cryptographic random-number generator, written out as a 64-character lowercase string of hex digits (hex being base-16, the digits 0–9 and a–f). A new one is made every time the app starts.

**Why it is here.** The token must be impossible to guess within a session, which is why it comes from a *cryptographic* random source rather than an ordinary one. Making a brand-new token on every launch means that even if a token somehow leaked into a log, it is worthless the moment the app is restarted.

.. CG-EXPLANATION-END id=function:mintLocalClientToken

``function localApiRequestFilter``
----------------------------------

.. CG-BLOCK id=function:localApiRequestFilter lines=70-80

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 70-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:localApiRequestFilter

**What this does.** Builds the rule that decides which outgoing requests get the token attached, given the backend's base address. It returns TWO address patterns: the exact backend address with everything under it, and the same host and protocol WITHOUT the port number, again with everything under it.

**Why it is here.** The token must be attached only to requests aimed at our own backend, never to map tiles, 3-D assets, or an external link. The two patterns exist because of a known trap: Electron matches these patterns with a grammar (borrowed from Chrome extensions) that does not allow a port number in the host part. A pattern that includes the port could silently match nothing — which would strip the token from every request and leave an installed app unable to talk to its own backend, with no error shown anywhere. The port-less second pattern is the safety net that matches regardless. The only cost is that the token could also be attached to another service on the same local host, of which there is none today.

.. CG-EXPLANATION-END id=function:localApiRequestFilter

``const TOKEN_OBSERVATION_GRACE_MS``
------------------------------------

.. CG-BLOCK id=const:TOKEN_OBSERVATION_GRACE_MS lines=81-83

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 81-83
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOKEN_OBSERVATION_GRACE_MS

**What this does.** Sets ``TOKEN_OBSERVATION_GRACE_MS`` to five thousand milliseconds (five seconds) — how long a request that was seen leaving is given to acquire its token header before the safety check below raises an alarm.

**Why it is here.** The point where a request is first observed fires a fraction of a moment before the point where the token is actually attached, for the same request. The grace period stops the check from racing ahead of the very injection it is auditing and crying wolf, while still being short enough to catch a genuine failure quickly.

.. CG-EXPLANATION-END id=const:TOKEN_OBSERVATION_GRACE_MS

``interface TokenInjectionAudit``
---------------------------------

.. CG-BLOCK id=interface:TokenInjectionAudit lines=84-122

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 84-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TokenInjectionAudit

**What this does.** Describes the shape of the little safety monitor returned below. An *interface* is a written description of the functions a value must provide. It lists two: ``noteInjection`` (call this every time the token was actually attached to a request) and ``noteApiRequestObserved`` (call this when a request to the backend was seen leaving, from a separate vantage point that cannot share the header-attaching machinery's blind spot). The second one starts a one-shot check: if no injection has been recorded by the end of the grace period, the token filter must have failed to match a request it should have caught — so it raises an alarm.

**Why it is here.** The header-attaching step has no failure the engineer can see: if the address filter matches nothing, the header is silently absent, the backend refuses every call, and the page just says "failed to fetch" with the real cause buried in a backend log an installed build never shows anyone. This monitor turns that silent absence into a visible signal by cross-checking, from an independent vantage point, that requests which left really did get their token.

.. CG-EXPLANATION-END id=interface:TokenInjectionAudit

``function createTokenInjectionAudit``
--------------------------------------

.. CG-BLOCK id=function:createTokenInjectionAudit lines=123-152

.. literalinclude:: ../../../desktop/src/main/localClientToken.ts
   :language: typescript
   :lines: 123-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:createTokenInjectionAudit

**What this does.** Builds the safety monitor described above. It is handed the address patterns the filter was built from (named in any alarm so the reader can see which patterns matched nothing), somewhere to send an error, and — for testing — a way to schedule the delayed check (defaulting to a five-second timer). It keeps private flags for "was a token ever attached", "has the check been armed", and "has an alarm already fired". ``noteInjection`` just records that a token was attached. ``noteApiRequestObserved`` arms the one-shot check on the first backend request seen, and after the grace period, if still no token was ever attached, prints one error line naming the request and the patterns that failed. The remembered flags are held in a *closure* — a function that keeps access to the variables it was created alongside.

**Why it is here.** The design was corrected after a real dogfeed miss: an earlier version armed on a fixed timer after the page loaded and cried wolf on any session where no project was opened (no project means no backend requests, so the filter was never even asked to match anything). Arming only on an actually-observed backend request — reported from a vantage point that cannot share the filter's own blind spot — fixes that. The alarm fires at most once because the page can reload (during development, or via the error screen's reload button), and an alarm repeated on every reload would train the reader to ignore it.

.. CG-EXPLANATION-END id=function:createTokenInjectionAudit

