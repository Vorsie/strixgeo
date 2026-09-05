8. Desktop — the Electron main process and preload bridge
=========================================================

.. CG-EXPLANATION-START id=intro

An Electron app is really two programs. The **main process** is the one in this
group: it runs on Node.js with full access to the computer — it can open files,
launch other programs, and create windows. The **renderer** (groups 9-13) is the
web page the user actually sees and clicks; it is sandboxed and cannot touch the
computer directly. Between them sits the **preload bridge** (``preload/index.ts``):
a small, guarded script that hands the web page a short, fixed list of safe
functions, so the page never gets raw operating-system power.

Read this group first, because it is what runs the instant the app launches.
The main process boots the app's own bundled PostgreSQL database and its Python
engine, waits for them, decides whether a beta build's licence lets the engine
start at all, opens the window, and wires up every request the window can make
back to it. If any of that goes wrong, this is also the code that shows an
honest error and shuts down cleanly.

The files fall into a few themes: the **boot sequence and embedded stack**
(``embedded/``, ``backend*``) that start and supervise Postgres and the engine;
the **activation and licence gate** (``activation*``, ``deviceIdentity``,
``localClientToken``) that guards a paid, time-limited beta; the **`.strix`
codec** (``strixCodec``) that wraps a saved project so it is not plaintext on
disk; **crash recovery** (``recoveryStore``); **window, quit and crash policy**;
consent-gated **diagnostics**; and the **auto-updater** wiring. ``index.ts`` is
the conductor that assembles all of it.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1


