desktop.main.updaterPolicy
==========================

.. CG-PAGE source=desktop/src/main/updaterPolicy.ts complete=true

*Source file:* ``desktop/src/main/updaterPolicy.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening note for the "policy" half of the auto-updater —
the part that makes decisions and tidies up data, deliberately kept free of
Electron and of the ``electron-updater`` library so the test suite can drive it on
any machine. The note is clear that this is prototype code (debt #6). The
side-effecting half — the part that actually listens for updates and downloads
them — lives in the neighbouring ``updaterService.ts``.

**Why it is here.** The whole updater must never bother a developer's daily
``npm run dev`` session, so everything automatic is gated on whether the build is
packaged. This file expresses that gate once, as a plain yes/no function, so the
service reads as a statement of intent rather than as an inline check buried in the
wiring.

.. CG-EXPLANATION-END id=module-header

``interface UpdateAvailableNotice``
-----------------------------------

.. CG-BLOCK id=interface:UpdateAvailableNotice lines=18-30

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 18-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpdateAvailableNotice

**What this does.** Describes the small, safe summary of an available update that
gets sent to the on-screen page: ``version`` (always present), and ``releaseName``
and ``releaseNotes``, each of which is either a plain string or nothing.

**Why it is here.** The page (the renderer) is sandboxed and should only ever be
handed simple, predictable values. Defining a deliberately plain shape — strings
or nothing, never anything richer — means whatever the update feed sends is
flattened to something the page can safely display.

.. CG-EXPLANATION-END id=interface:UpdateAvailableNotice

``interface RawUpdateInfo``
---------------------------

.. CG-BLOCK id=interface:RawUpdateInfo lines=31-51

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 31-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawUpdateInfo

**What this does.** Describes the raw blob the ``electron-updater`` library hands
over when it finds an update — but only the few fields this prototype actually
reads. ``version`` is required; ``releaseName`` and ``releaseNotes`` are optional,
and the notes may arrive either as a single string or as a list of per-version
note blocks.

**Why it is here.** It is the "before" shape that the summariser below turns into
the tidy "after" shape. Writing down only the handful of fields the code cares
about keeps the rest of the library's richer blob out of the way, and captures the
awkward fact that release notes come in two different forms.

.. CG-EXPLANATION-END id=interface:RawUpdateInfo

``function shouldAutoCheckOnLaunch``
------------------------------------

.. CG-BLOCK id=function:shouldAutoCheckOnLaunch lines=52-75

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 52-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldAutoCheckOnLaunch

**What this does.** A one-line yes/no: should this launch quietly check for
updates? It says yes only for a packaged (shipped) build. (The block below also
shows the note that belongs to the next function, ``autoInstallOnQuit``.)

**Why it is here.** Only a packaged build carries the update-feed configuration and
points at a real release feed; a development run has neither. Naming this gate as
its own function means the service can say "check on launch only if
``shouldAutoCheckOnLaunch``" and read like plain intent, rather than hiding the
rule inside an ``if``.

.. CG-EXPLANATION-END id=function:shouldAutoCheckOnLaunch

``function autoInstallOnQuit``
------------------------------

.. CG-BLOCK id=function:autoInstallOnQuit lines=76-94

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 76-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:autoInstallOnQuit

**What this does.** Another one-line yes/no: may a downloaded update be installed
automatically when the app quits? It says yes only for a code-signed build.

**Why it is here.** Installing on quit silently swaps in a downloaded installer
with no further prompt. For an *unsigned* build (which the beta is), the only proof
that the installer is genuine is the encrypted connection to GitHub plus one
publishing account — not enough to run something silently. So this stays switched
off until a code-signing certificate lands (debt #6), and until then the user's
explicit "Install now" button in the page is the only install path.

.. CG-EXPLANATION-END id=function:autoInstallOnQuit

``function summariseUpdateInfo``
--------------------------------

.. CG-BLOCK id=function:summariseUpdateInfo lines=95-101

.. literalinclude:: ../../../desktop/src/main/updaterPolicy.ts
   :language: typescript
   :lines: 95-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:summariseUpdateInfo

**What this does.** Turns the raw update blob into the tidy notice the page
receives. It copies the version straight through, and keeps the release name and
notes only when each arrived as a plain string — when the notes come as a list of
blocks instead, it drops them to nothing rather than forwarding the raw list.

**Why it is here.** It is the "before to after" translation between the two shapes
defined above. Refusing to forward the list-of-blocks form keeps the promise that
the page only ever receives simple strings, so the display code never has to cope
with a surprise structure.

.. CG-EXPLANATION-END id=function:summariseUpdateInfo

