groundmodel.api.main
====================

.. CG-PAGE source=src/groundmodel/api/main.py complete=true

*Source file:* ``src/groundmodel/api/main.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file ("FastAPI application entry point") and pulls
in its tools: ``FastAPI`` and its middleware for the web layer, ``sqlalchemy``
for talking to the database, the engine's own routers and helpers, and the
shared logging and settings. It also sets one constant,
``_DB_PROBE_TIMEOUT_SECONDS``, the few seconds it will wait when it checks the
database on boot.

**Why it is here.** This is the file that defines *the web application itself* —
the set of URLs the desktop app calls, plus the start-up and shut-down routine
around them. Everything the app is wired from is imported here in one place. See
the architecture note in :doc:`../start-here`: this is the top "API layer", the
front door of the engine.

.. CG-EXPLANATION-END id=module-header

Function ``async def _sweep_stale_bodies``
------------------------------------------

.. CG-BLOCK id=function:_sweep_stale_bodies lines=54-114

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 54-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sweep_stale_bodies

**What this does.** On boot, walks every lithostratigraphic model in the
database and re-runs the "resolver" on each, which keeps the *body* rows
(connected masses of soil) in step with the correlation lines the engineer has
drawn. Each model is handled in its own database transaction so one bad model
cannot spoil the rest, and any failure is logged but never stops start-up. The
``async def`` marks this as a function that can pause while it waits for the
database and let other work continue meanwhile.

**Why it is here.** Between sessions the correlation picture can change; this
brings the stored bodies back into agreement at start-up. The long docstring
explains a deliberate limit: it runs *only* the resolver, never body-extent
detection, because extents are tied to the section the engineer was looking at,
and re-deriving them here — with no active section — once silently overwrote
work the user had committed (a bug caught in dogfeeding on 3 June 2026). See
``docs/design/body-model.md``.

.. CG-EXPLANATION-END id=function:_sweep_stale_bodies

Function ``async def _probe_database``
--------------------------------------

.. CG-BLOCK id=function:_probe_database lines=115-147

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 115-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:_probe_database

**What this does.** Tries a single trivial query (``SELECT 1``) against the
configured database, with a short timeout. It logs success when the database
answers, and a clear error with a hint ("Is the docker compose stack up?") when
it does not. It deliberately does **not** crash on failure.

**Why it is here.** The desktop app decides the engine is "ready" by polling one
URL; if this probe threw an exception, that readiness check could hang forever.
So instead it just reports. The log names the actual database it reached
(host, port and name, with the password stripped) — that one line would have
turned an evening of forensics on 25 June 2026, when a stray backend had
connected to the wrong database, into a 30-second diagnosis.

.. CG-EXPLANATION-END id=function:_probe_database

Function ``async def lifespan``
-------------------------------

.. CG-BLOCK id=function:lifespan lines=148-246

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 148-246
   :lineno-match:

.. CG-EXPLANATION-START id=function:lifespan

**What this does.** The application's start-up and shut-down routine, timed in
six labelled phases: arm the crash logging, bring the database to the right
schema version, load the DOV parse worker, create a small pool of worker
processes for parsing, probe the database, and reconcile the bodies. It logs
"engine READY" — the moment the app can answer requests — and only *then* kicks
off the background warm-up of the heavy libraries. After ``yield`` (which is
where the app runs and serves) the ``finally`` block shuts the worker pool down
cleanly.

**Why it is here.** The ``@asynccontextmanager`` decorator (the ``@`` line just
above) turns this one function into a paired "do this on the way up, do that on
the way down" block that FastAPI runs around the whole app's life. The phase
timings exist because a packaged cold start took minutes and the owner needed to
see *where* the seconds went. Crucially the database migration happens here,
before anything touches the database, and the heavy warm-up is started *after*
READY so it never delays the first click. See ``api/boot_migration.py`` and
``api/heavy_library_warmup.py``.

.. CG-EXPLANATION-END id=function:lifespan

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=247-249

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 247-249
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Sets ``_MAX_BODY_BYTES`` — the largest request body the
engine will accept, 256 MiB.

**Why it is here.** It is a coarse safety cap so a runaway or malicious upload
cannot make the engine try to buffer an unbounded amount of data. 256 MiB sits
far above any real project (even a 500-CPT import is a few MB), and finer
per-field caps guard the layer below it. This is debt item #38.

.. CG-EXPLANATION-END id=module-statements

Class ``BodySizeLimitMiddleware`` — header
------------------------------------------

.. CG-BLOCK id=class:BodySizeLimitMiddleware lines=250-260

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 250-260
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySizeLimitMiddleware

**What this does.** Declares a piece of *middleware* — code that sits in front of
every request and can inspect or reject it before the app proper sees it. This
one's job is to refuse any request whose body is bigger than the cap above,
answering "413 Payload Too Large".

**Why it is here.** It is the enforcement of the size cap. A *class* groups the
setting (the maximum) with the behaviour (the check) in one object. The two
short methods below are how it stores the limit and how it runs on each
request.

.. CG-EXPLANATION-END id=class:BodySizeLimitMiddleware

Method ``BodySizeLimitMiddleware``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:BodySizeLimitMiddleware.__init__ lines=261-264

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 261-264
   :lineno-match:

.. CG-EXPLANATION-START id=method:BodySizeLimitMiddleware.__init__

**What this does.** The set-up method (``__init__`` runs once when the middleware
is created). It just remembers the app it wraps and the maximum byte count.

**Why it is here.** Middleware is built once at start-up; this stores the two
things every later request-check needs. ``self`` is the object itself — the
place those two values are kept.

.. CG-EXPLANATION-END id=method:BodySizeLimitMiddleware.__init__

Method ``BodySizeLimitMiddleware``. ``async def __call__``
----------------------------------------------------------

.. CG-BLOCK id=method:BodySizeLimitMiddleware.__call__ lines=265-349

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 265-349
   :lineno-match:

.. CG-EXPLANATION-START id=method:BodySizeLimitMiddleware.__call__

**What this does.** Runs on every request. It does two checks. First, if the
request announces its size up front (the ``Content-Length`` header) and that is
over the cap, it refuses immediately, before reading a single byte. Second, for
requests that stream their body without announcing a size, it counts the bytes
as they arrive and refuses the moment the running total passes the cap. Non-web
traffic is passed straight through untouched.

**Why it is here.** Two checks are needed because not every client announces its
size honestly (or at all). The up-front check is the cheap common case; the
streaming counter is the backstop for chunked uploads. ``__call__`` is the
special method that makes an object behave like a function — FastAPI calls the
middleware object as if it were one, once per request.

.. CG-EXPLANATION-END id=method:BodySizeLimitMiddleware.__call__

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=350-353

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 350-353
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** Sets the allowed browser *origins*: ``"null"`` (the packaged
app's own origin) and a development-only pattern that matches the local Vite dev
server.

**Why it is here.** The engine listens only on this computer, so the real danger
is not the network — it is another browser tab the user has open (say
``evil.com``) trying to read their imported data through the local port. The long
comment lays out that threat. These origins pin *who* is allowed to talk to the
engine; a companion token check (loaded elsewhere) makes the allowance safe,
because a hostile page can claim an origin but cannot prove it. This is a
security-critical block.

.. CG-EXPLANATION-END id=module-statements~2

Function ``def _cors_origin_regex_for``
---------------------------------------

.. CG-BLOCK id=function:_cors_origin_regex_for lines=354-376

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 354-376
   :lineno-match:

.. CG-EXPLANATION-START id=function:_cors_origin_regex_for

**What this does.** Returns the localhost pattern only in development, and
nothing (``None``) in any other environment.

**Why it is here.** The Vite dev server only exists while a developer runs
``npm run dev``; a packaged build serves its window from a file and never needs
it. Allowing localhost in a shipped build would let any local web server read
the engine, so the allowance is gated to development only.

.. CG-EXPLANATION-END id=function:_cors_origin_regex_for

Function ``def _docs_enabled_for``
----------------------------------

.. CG-BLOCK id=function:_docs_enabled_for lines=377-404

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 377-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:_docs_enabled_for

**What this does.** Returns ``True`` only when the environment is exactly
``"development"``. It decides whether the interactive API documentation pages
are served.

**Why it is here.** The browsable API docs (``/docs`` and ``/redoc``) are a
developer convenience with no place in a shipped installer, so they are turned
off everywhere except local development. The machine-readable ``/openapi.json``
is left on in every environment, because the desktop app uses it as its
"is the engine up yet?" signal.

.. CG-EXPLANATION-END id=function:_docs_enabled_for

Function ``def create_app``
---------------------------

.. CG-BLOCK id=function:create_app lines=405-511

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 405-511
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_app

**What this does.** Builds the finished FastAPI application: it decides whether
the docs are on, stacks the middleware (size limit, the local-client token
check, cross-origin rules, and a trusted-host guard), installs two custom error
handlers, and registers every router (CPT, borehole, project, geology, and the
rest). It hands back the wired-up app.

**Why it is here.** Building the app inside a function (rather than as one bare
line) means both the docs-on and docs-off behaviours can be tested in one run by
passing a fake environment. The comments record hard-won reasons: the token
check is installed *inside* the CORS layer so preflight requests still work; the
trusted-host guard blocks a DNS-rebinding trick; and the custom 500 handler
exists because an un-handled error used to reach the browser without the
cross-origin headers and got mis-reported as a CORS failure (dogfeed,
15 August 2026). The order of the middleware is deliberate and load-bearing.

.. CG-EXPLANATION-END id=function:create_app

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~3 lines=512-512

.. literalinclude:: ../../../src/groundmodel/api/main.py
   :language: python
   :lines: 512-512
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~3

**What this does.** Creates the one application object, ``app``, using the real
runtime environment.

**Why it is here.** This is the object uvicorn serves (the ``APP_IMPORT_STRING``
back in ``serve.py`` points right at it), and the same object the test suite and
the e2e harness import. One module-level ``app`` is the single thing the whole
outside world attaches to.

.. CG-EXPLANATION-END id=module-statements~3

