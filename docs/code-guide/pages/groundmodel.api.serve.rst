groundmodel.api.serve
=====================

.. CG-PAGE source=src/groundmodel/api/serve.py complete=true

*Source file:* ``src/groundmodel/api/serve.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-77

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 1-77
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This top section is the file's introduction and its
toolbox. The long block of text in triple quotes at the very top is the *module
docstring* — a plain note to whoever reads the file. Below it, the ``import``
lines pull in the ready-made tools the rest of the file uses: ``argparse`` reads
options typed on the command line, ``asyncio`` is Python's engine for juggling
jobs that have to wait, ``sys`` and ``time`` are basic system and clock helpers.
The last line makes one ``logger`` — the object every function here uses to
write messages to the log file.

**Why it is here.** This file is the little program that actually starts the
Python engine's web server. An *event loop* is the scheduler that lets one
thread handle many waiting jobs (network, database) at once. The docstring
records a real bug seen live on 2 August 2026: on Windows, one momentary network
hiccup could permanently retire the server's listening socket while the process
kept running — so the app looked alive but refused every single click. Windows
offers two kinds of event loop, the *proactor* (its default, which has this
fatal flaw) and the *selector* (which recovers). Everything below exists to make
sure the engine runs on the safe selector loop, and to shout loudly in the log
if the failure ever happens anyway.

.. CG-EXPLANATION-END id=module-header

Function ``def engine_uptime_ms``
---------------------------------

.. CG-BLOCK id=function:engine_uptime_ms lines=78-99

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 78-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:engine_uptime_ms

**What this does.** A tiny helper that answers one question: "how many
milliseconds ago did this engine process start?" It does no work itself — it
just forwards to a shared stopwatch that lives in ``groundmodel.shared.timing``.

**Why it is here.** The startup logs print how long each phase of the boot took.
For those numbers to add up, every phase must be measured against the *same*
stopwatch. The stopwatch deliberately lives in the shared module, not here,
because the command ``python -m groundmodel.api.serve`` loads this very file
twice under two different names — an anchor kept here would give two different
"start" times and make the boot total read shorter than it really was. One
shared stopwatch avoids that.

.. CG-EXPLANATION-END id=function:engine_uptime_ms

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=100-114

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 100-114
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** A handful of fixed values the functions below reuse:
``DEFAULT_HOST`` and ``DEFAULT_PORT`` (the address ``127.0.0.1`` and port
``8765`` to listen on), ``APP_IMPORT_STRING`` (where the real web application
lives), ``SELECTOR_LOOP_FACTORY`` (the address of the safe-loop builder further
down), and ``_ACCEPT_FAILED_MESSAGE`` (the exact wording of the failure this
file watches for).

**Why it is here.** ``127.0.0.1`` means "this computer only" — the engine is
never reachable from the network. ``8765`` is the port the desktop app always
expects. The values sit together in one spot because the project keeps constants
grouped and named, never buried inside a function. The error text is stored
verbatim because that exact string is the only marker asyncio gives when the
listener dies.

.. CG-EXPLANATION-END id=module-statements

Function ``def selector_event_loop``
------------------------------------

.. CG-BLOCK id=function:selector_event_loop lines=115-132

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 115-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:selector_event_loop

**What this does.** Builds the "selector" kind of event loop — the one that
survives an accept hiccup on Windows — and immediately arms the extra crash
logging on it before handing it back.

**Why it is here.** ``uvicorn`` (the web server this engine runs on) only lets
you pick the event loop by pointing it at a small builder function like this
one. This is that function. Building the selector loop here is what actually
dodges the proactor bug described at the top of the file; arming the diagnostics
inside it means the loud warning is ready from the loop's very first tick.

.. CG-EXPLANATION-END id=function:selector_event_loop

Function ``def windows_selector_loop_needed``
---------------------------------------------

.. CG-BLOCK id=function:windows_selector_loop_needed lines=133-149

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 133-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:windows_selector_loop_needed

**What this does.** A one-line yes/no: it returns ``True`` only on Windows.

**Why it is here.** The accept bug is Windows-only — Linux and macOS loops keep
accepting connections — so the loop swap should happen only on Windows. Pulling
this test into its own named function means it can be checked in a test by
passing in a fake platform string, without the test actually having to run on
Windows.

.. CG-EXPLANATION-END id=function:windows_selector_loop_needed

Function ``def build_config``
-----------------------------

.. CG-BLOCK id=function:build_config lines=150-192

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 150-192
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_config

**What this does.** Assembles uvicorn's configuration object: which app to
serve, which host and port to bind, whether to log every request, and — the
important part — which event loop to use. On Windows it points uvicorn at the
safe-loop builder; on every other system it lets uvicorn pick for itself.

**Why it is here.** The ``loop`` setting is the *only* lever uvicorn actually
reads for choosing the loop (the docstring at the top explains that the
"obvious" way — setting a global asyncio policy — does nothing since uvicorn
0.36). The ``platform`` argument, written after the ``*`` (which means
"everything after here must be passed by name, not by position"), can be handed
a fake value in a test so the Windows and non-Windows branches are both testable
on one machine. The ``-> uvicorn.Config`` at the end is a *type hint*: a note
that this function hands back a uvicorn config object.

.. CG-EXPLANATION-END id=function:build_config

Function ``def install_accept_failure_diagnostics``
---------------------------------------------------

.. CG-BLOCK id=function:install_accept_failure_diagnostics lines=193-227

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 193-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:install_accept_failure_diagnostics

**What this does.** Wraps whatever error handler the event loop already has.
When the specific listener-killing failure occurs, it writes a CRITICAL log line
that spells out what happened and says "restart the backend" in plain words —
then still calls the original handler, so no other diagnostic is lost.

**Why it is here.** Someone might start the server a different way (by hand, or
through the test harness) and bypass the safe-loop setup above. This makes sure
that even then, the failure is never a quiet one-line hiccup buried in the log —
it is impossible to miss and it says exactly what to do.

.. CG-EXPLANATION-END id=function:install_accept_failure_diagnostics

Function ``def _parse_args``
----------------------------

.. CG-BLOCK id=function:_parse_args lines=228-251

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 228-251
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_args

**What this does.** Reads the ``--host``, ``--port`` and ``--access-log``
options from the command line, filling in the defaults from the constants above
when they are not given.

**Why it is here.** The desktop launcher starts this program with those options
on the command line; providing defaults means it can also just be run by hand
during development with no options at all. The leading underscore in the name is
a convention meaning "private helper — only used inside this file".

.. CG-EXPLANATION-END id=function:_parse_args

Function ``def main``
---------------------

.. CG-BLOCK id=function:main lines=252-292

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 252-292
   :lineno-match:

.. CG-EXPLANATION-START id=function:main

**What this does.** The real starting point. It reads the options, logs three
startup milestones, builds the configuration, deliberately loads the heavy
application module, and finally starts the web server.

**Why it is here.** Loading the application module here, on its own line, is on
purpose: that import drags in the whole heavy scientific stack (numba, polars,
scipy, shapely, geolib, ezdxf), and doing it here makes its cost show up as its
own clearly-labelled phase in the log instead of hiding inside the server start.
On the packaged app this import is the slowest single part of the boot, so
seeing its cost separately matters. The import is harmless to repeat — a moment
later uvicorn finds the already-loaded module for free.

.. CG-EXPLANATION-END id=function:main

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=293-294

.. literalinclude:: ../../../src/groundmodel/api/serve.py
   :language: python
   :lines: 293-294
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** The standard Python line that says "if this file was run
directly, call ``main()``".

**Why it is here.** It lets the command ``python -m groundmodel.api.serve`` start
the server, while still allowing other files to import pieces of this one (the
test suite does) without launching a server as a side effect.

.. CG-EXPLANATION-END id=module-statements~2

