desktop.main.rendererConsoleForwarding
======================================

.. CG-PAGE source=desktop/src/main/rendererConsoleForwarding.ts complete=true

*Source file:* ``desktop/src/main/rendererConsoleForwarding.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*). It explains that this module forwards the *renderer's* console output — the messages the web page logs, which normally live only in the separate DevTools window — into the *main process's* terminal, so they appear in one ordered stream alongside the backend and main-process lines.

**Why it is here.** When the owner reports a bug he pastes his terminal, which carried the backend (``[api ...]``) and main-process (``[main ...]``) lines but NOT the renderer's (``[ui ...]``) lines — those had to be opened, scrolled and copied by hand out of DevTools, so half of every UI bug report arrived with only the backend's side of the story. Forwarding puts the request and the click that caused it in a single paste. The note is emphatic that this is NEVER done in packaged builds: it is a development convenience with a real cost — renderer output is untrusted text and a shipped app has no terminal to write it to. The caller gates it on the app being unpackaged; this module holds only the pure decisions so they can be tested without an Electron window.

.. CG-EXPLANATION-END id=module-header

``type RendererConsoleLevel``
-----------------------------

.. CG-BLOCK id=type:RendererConsoleLevel lines=21-23

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 21-23
   :lineno-match:

.. CG-EXPLANATION-START id=type:RendererConsoleLevel

**What this does.** Names, as a *type*, the four console severities Electron reports for a renderer message: ``debug``, ``info``, ``warning`` and ``error``. The block also carries the note that leads into the next value.

**Why it is here.** Fixing the set of levels lets the rest of the file reason about severity — the level floor, the choice of print method — with the compiler catching any misspelling of a level.

.. CG-EXPLANATION-END id=type:RendererConsoleLevel

``interface RendererConsoleMessage``
------------------------------------

.. CG-BLOCK id=interface:RendererConsoleMessage lines=24-36

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 24-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RendererConsoleMessage

**What this does.** Describes just the parts of Electron's console-message report this module actually uses (an *interface* is a written description of the fields a value must carry): the ``level``, the ``message`` text, the ``sourceId`` (which URL produced it) and the ``lineNumber``. The block also carries the note that leads into the next value.

**Why it is here.** Naming only the handful of fields it needs keeps the module decoupled from the full Electron event shape, so the decisions can be tested with a small hand-made object rather than a real console event.

.. CG-EXPLANATION-END id=interface:RendererConsoleMessage

``const IGNORED_SOURCE_PREFIXES``
---------------------------------

.. CG-BLOCK id=const:IGNORED_SOURCE_PREFIXES lines=37-45

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 37-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:IGNORED_SOURCE_PREFIXES

**What this does.** The list of source-URL prefixes whose console output is noise rather than the app itself talking: ``devtools://`` (DevTools' own logging) and ``chrome-extension://`` (browser extensions). The block also carries the note that leads into the next value.

**Why it is here.** DevTools logs into the very page it is inspecting, so forwarding its output unfiltered would start a feedback loop of DevTools' own messages in the terminal the moment DevTools is opened. Filtering these prefixes out stops that loop.

.. CG-EXPLANATION-END id=const:IGNORED_SOURCE_PREFIXES

``const FORWARD_DEBUG_ENV_VAR``
-------------------------------

.. CG-BLOCK id=const:FORWARD_DEBUG_ENV_VAR lines=46-71

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 46-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:FORWARD_DEBUG_ENV_VAR

**What this does.** Names the environment variable, ``STRIX_FORWARD_RENDERER_DEBUG``, that opts a terminal in to also receiving the renderer's low-level ``debug`` messages. An *environment variable* is a named setting the operating system hands to a program when it launches. The block also carries the note that leads into the next function.

**Why it is here.** The debug stream is off by default because it is a flood, but the moment you want that detail is always after the interesting thing has already started happening; a simple environment-variable switch keeps it cheap to turn on without a rebuild, mirroring the renderer's own trace switch.

.. CG-EXPLANATION-END id=const:FORWARD_DEBUG_ENV_VAR

``function shouldForwardRendererMessage``
-----------------------------------------

.. CG-BLOCK id=function:shouldForwardRendererMessage lines=72-101

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 72-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldForwardRendererMessage

**What this does.** Decides whether a given renderer console message is worth putting in the terminal. It drops empty messages, drops anything coming from a DevTools or extension source, and drops ``debug`` messages unless the opt-in environment variable is set to ``1``; everything else — ``info``, ``warning``, ``error`` — passes. The block also carries the note that leads into the next function.

**Why it is here.** The level floor is the crucial filter: ``log.debug`` is used on nearly every call across the API and section clients, so mirroring all of it into the terminal would recreate exactly the flood that demoting the per-render line to ``trace`` was meant to end. Info, warning and error are the lines a bug report actually needs, so they always pass. The environment is passed in rather than read directly so the floor can be tested without changing the real process.

.. CG-EXPLANATION-END id=function:shouldForwardRendererMessage

``function formatRendererMessage``
----------------------------------

.. CG-BLOCK id=function:formatRendererMessage lines=102-121

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 102-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatRendererMessage

**What this does.** Produces the exact line to print for a renderer message: if the message already begins with the app's own ``[ui `` tag it is left untouched, and anything else is stamped with a ``[ui]`` prefix. The block also carries the note that leads into the next function.

**Why it is here.** Messages from the app's own logger already carry a ``[ui <time> <LEVEL> <scope>]`` prefix, so re-tagging them would double the tag and push the useful text further to the right. A bare React warning or a stray ``console.log`` gets the ``[ui]`` stamp so its origin is unmistakable next to the ``[main]`` and ``[api]`` lines around it.

.. CG-EXPLANATION-END id=function:formatRendererMessage

``function consoleMethodForLevel``
----------------------------------

.. CG-BLOCK id=function:consoleMethodForLevel lines=122-128

.. literalinclude:: ../../../desktop/src/main/rendererConsoleForwarding.ts
   :language: typescript
   :lines: 122-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:consoleMethodForLevel

**What this does.** Chooses which terminal print method a forwarded message should use: ``error`` for an error, ``warn`` for a warning, and plain ``log`` for everything else.

**Why it is here.** Preserving the severity means a renderer warning still shows up as a warning in the terminal instead of being flattened into the same plain stream as every ordinary log line, so the important lines stay visually distinct.

.. CG-EXPLANATION-END id=function:consoleMethodForLevel

