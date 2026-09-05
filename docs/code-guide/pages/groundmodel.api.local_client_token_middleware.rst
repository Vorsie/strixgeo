groundmodel.api.local_client_token_middleware
=============================================

.. CG-PAGE source=src/groundmodel/api/local_client_token_middleware.py complete=true

*Source file:* ``src/groundmodel/api/local_client_token_middleware.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/api/local_client_token_middleware.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** One line of documentation naming the file's job, then the imports it needs: the tools to read an environment variable and to compare two secrets safely, the reply type for a refusal, the ASGI plumbing types, the two shared names from the constants file, and the shared logger base class.

**Why it is here.** *ASGI* is the standard way a Python web application and its server pass a request back and forth; *middleware* is code that sits in front of every request and may inspect or reject it before the application proper sees it. This file is the middleware that enforces the launch token. It reuses the two names from the constants file rather than re-typing them so the two ends of the contract cannot drift apart.

.. CG-EXPLANATION-END id=module-header

Class ``LocalClientTokenMiddleware`` — header
---------------------------------------------

.. CG-BLOCK id=class:LocalClientTokenMiddleware lines=18-66

.. literalinclude:: ../../../src/groundmodel/api/local_client_token_middleware.py
   :language: python
   :lines: 18-66
   :lineno-match:

.. CG-EXPLANATION-START id=class:LocalClientTokenMiddleware

**What this does.** Opens the middleware class and, in a long docstring, states the rule it enforces: any request that carries an ``Origin`` header must also present the correct launch token. The docstring also spells out exactly what is deliberately NOT guarded — requests with no origin at all, cross-origin preflight checks, and every request when no token is configured.

**Why it is here.** This is the security reasoning, quoted from the docstring. The engine listens only on this computer and has no login, so the only identity a request can offer is its origin — and any page on the web can claim any origin, so an origin alone is no identity at all. Without this guard, another browser tab the engineer happens to have open could read a whole project bundle, import a file, or delete a model. The token fixes this because a hostile page cannot present a value it was never given. The three carve-outs are safe: a request with no origin cannot be the browser attack this closes (the browser always attaches an origin to a request whose reply a page could read); preflight checks are handled by the layer outside this one and carry no data; and with no token set the engine keeps its old open behaviour so developer and test runs need no knowledge of the mechanism.

.. CG-EXPLANATION-END id=class:LocalClientTokenMiddleware

Method ``LocalClientTokenMiddleware``. ``def __init__``
-------------------------------------------------------

.. CG-BLOCK id=method:LocalClientTokenMiddleware.__init__ lines=67-70

.. literalinclude:: ../../../src/groundmodel/api/local_client_token_middleware.py
   :language: python
   :lines: 67-70
   :lineno-match:

.. CG-EXPLANATION-START id=method:LocalClientTokenMiddleware.__init__

**What this does.** The set-up method, run once when the middleware is built. It registers the logger under this module's name and remembers the application it wraps.

**Why it is here.** Middleware is constructed once at start-up and then runs on every request; this stores the single thing each later request needs — the downstream application to hand an accepted request on to.

.. CG-EXPLANATION-END id=method:LocalClientTokenMiddleware.__init__

Method ``LocalClientTokenMiddleware``. ``async def __call__``
-------------------------------------------------------------

.. CG-BLOCK id=method:LocalClientTokenMiddleware.__call__ lines=71-132

.. literalinclude:: ../../../src/groundmodel/api/local_client_token_middleware.py
   :language: python
   :lines: 71-132
   :lineno-match:

.. CG-EXPLANATION-START id=method:LocalClientTokenMiddleware.__call__

**What this does.** Runs on every request. It lets non-web traffic straight through. It reads the expected token from the environment each time and, if none is set, admits the request unchanged. It then admits any request that carries no ``Origin`` header. For a request that does carry an origin, it compares the presented token against the expected one and, on a match, hands the request on; on a mismatch it logs a loud warning and answers ``403 Forbidden`` (the status code meaning "understood, but refused").

**Why it is here.** The token is read per request rather than once at construction so a test can flip it without rebuilding the whole stack, and because the environment is set before the engine imports this code in a packaged build. The comparison uses a *constant-time* check — one that always takes the same time whether the first, middle, or last character differs — because the attacker this guards against is a web page that can hammer the local port in a loop, and an ordinary ``==`` would leak the token one character at a time by how long it took to fail. The refusal is logged loudly on purpose: an attack and a broken header-injection in the desktop shell look identical from here, and both the engineer seeing "everything failed to fetch" and the engineer whose project was read need that one line in the log.

.. CG-EXPLANATION-END id=method:LocalClientTokenMiddleware.__call__

