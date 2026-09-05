desktop.preload.index
=====================

.. CG-PAGE source=desktop/src/preload/index.ts complete=true

*Source file:* ``desktop/src/preload/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/preload/index.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The single ``import`` line pulls in two tools from Electron. ``contextBridge`` is Electron's tool for handing the web page a short, fixed list of safe functions. ``ipcRenderer`` is the web page's end of *IPC* (inter-process communication) — the messaging system a sandboxed web page uses to ask the main process to do something on its behalf. The comment that follows introduces the first shape defined below.

**Why it is here.** This whole file is the *preload bridge*. Electron runs the app as two programs: the *main process* (full computer access — files, windows, launching other programs) and the *renderer* (the web page the user sees, deliberately sandboxed so it cannot touch the computer directly). A wall called *context isolation* keeps the page's own JavaScript and this preload script in separate worlds. This preload is the only place allowed to reach across that wall and expose a narrow, audited set of powers to the page, so the page never gets raw operating-system power.

.. CG-EXPLANATION-END id=module-header

``interface RecentProject``
---------------------------

.. CG-BLOCK id=interface:RecentProject lines=7-17

.. literalinclude:: ../../../desktop/src/preload/index.ts
   :language: typescript
   :lines: 7-17
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecentProject

**What this does.** Declares ``RecentProject`` — the shape of one entry in the recent-projects list: a file ``path``, a display ``name``, and a ``lastOpened`` timestamp, all text. An *interface* in TypeScript is just a written description of what fields a value must carry; it produces no running code, it only lets the tools check that the pieces match.

**Why it is here.** The comment states the reason: this shape is written out here rather than imported from a shared file so the preload stays *self-contained*. The preload bundle is loaded and run before the renderer's own web-page code graph exists, so it cannot borrow types from that graph — duplicating the small shape is the deliberate price of that isolation.

.. CG-EXPLANATION-END id=interface:RecentProject

``interface RecoveryDescriptor``
--------------------------------

.. CG-BLOCK id=interface:RecoveryDescriptor lines=18-32

.. literalinclude:: ../../../desktop/src/preload/index.ts
   :language: typescript
   :lines: 18-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryDescriptor

**What this does.** Declares ``RecoveryDescriptor`` — the shape of the summary the main process returns for one crash-recovery file: which project it belongs to, its name, where the copy lives, when it was written, which app version wrote it, how big it is, and a ``declined`` flag saying whether the user already chose once to open without restoring it. It carries no actual project data, only these facts about the copy.

**Why it is here.** The comment explains both choices: it mirrors the same shape in ``recoveryStore.ts`` but is duplicated here (not imported) for the same self-containment reason as ``RecentProject``; and it deliberately omits the payload because the start screen only needs enough to draw a banner offering to restore, never the contents themselves. The ``declined`` flag lets that banner word a repeat offer differently from fresh crash debris.

.. CG-EXPLANATION-END id=interface:RecoveryDescriptor

``function onMenuEvent``
------------------------

.. CG-BLOCK id=function:onMenuEvent lines=33-44

.. literalinclude:: ../../../desktop/src/preload/index.ts
   :language: typescript
   :lines: 33-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:onMenuEvent

**What this does.** A small helper that subscribes to one named channel of messages sent from the main process to the web page, and hands back a function that cancels that subscription. It wraps the raw listener so the page's *callback* (a function the page hands in to be run later, each time the event fires) receives just the message arguments, without Electron's internal event object.

**Why it is here.** The comment gives the reason: the exact subscribe-then-return-an-unsubscribe pattern repeats for every menu signal, so writing it once here removes about five lines of boilerplate from each one. This follows the project's rule to extract a shared helper once the same shape appears more than once.

.. CG-EXPLANATION-END id=function:onMenuEvent

``const launchFlags``
---------------------

.. CG-BLOCK id=const:launchFlags lines=45-322

.. literalinclude:: ../../../desktop/src/preload/index.ts
   :language: typescript
   :lines: 45-322
   :lineno-match:

.. CG-EXPLANATION-START id=const:launchFlags

**What this does.** First, ``launchFlags`` asks the main process once, and synchronously (waiting right there rather than returning a promise for later), for two yes/no facts: is this an automated end-to-end test run, and is this a packaged installed build? If that question ever fails it quietly answers "no" to both. Then the long ``contextBridge.exposeInMainWorld('electron', { ... })`` call is the bridge itself: it publishes one object, reachable in the page as ``window.electron``, holding every function the page is allowed to call. Almost every entry is a one-line forwarder that hands the request to an IPC channel the main process answers (a *promise* is returned for the answers that arrive later). Grouped by job they cover: the engine's address and readiness; file-open dialogs and reads; the project-file lifecycle (open, save, read, write) where ``readProjectFile`` returns a success-or-typed-failure result from the ``.strix`` reader rather than a bare string; generic export save-and-write (the DXF export); printing the cross-section sheet to PDF; the recent-projects list; crash-recovery reads and writes; the window title and visibility; the quit handshake; every application-menu signal; forwarding renderer errors and a single diagnostic capture; the beta-expiry notice; and the onboarding, tutorial, sample-project, licensing/activation and updater prototypes.

**Why it is here.** This object is the entire, fixed doorway between the sandboxed page and the powerful main process — nothing the page can do to the computer exists outside this list, which is the whole point of context isolation. Two design decisions in the comments are load-bearing. The crash-recovery calls take a project id but never a file path, because the main process owns where recovery files live and validates the id, so the page can neither read nor write an arbitrary file through this surface. And ``launchFlags`` is fetched synchronously so the renderer can decide boot-time screens (the onboarding auto-open, the packaged activation start screen) without an extra round-trip, degrading to "not a test, not packaged" if an older main process lacks the channel, so it can never crash the page's boot.

.. CG-EXPLANATION-END id=const:launchFlags

