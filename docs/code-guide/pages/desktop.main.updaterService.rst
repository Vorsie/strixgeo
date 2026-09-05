desktop.main.updaterService
===========================

.. CG-PAGE source=desktop/src/main/updaterService.ts complete=false

*Source file:* ``desktop/src/main/updaterService.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening note and toolbox for the "doing" half of the
auto-updater — the part that actually listens to the ``electron-updater`` library,
relays what it hears to the on-screen page, and offers check / download / restart.
(The decision-making half is the neighbouring ``updaterPolicy.ts``.) The note
labels this prototype code (debt #6). Its imports bring in Electron itself, the
``autoUpdater`` object and its data shapes from ``electron-updater``, and the pure
helpers from the policy file.

**Why it is here.** The note's core promise is that a developer's daily session is
untouched: every automatic path is gated on whether the build is packaged. A
development launch never auto-checks; a manual "Check for updates" in development
politely reports "disabled" and does nothing (the library itself would otherwise
throw, because a development build has no update-feed file). The note also draws
the real-versus-mocked line: the event plumbing, the "let the user choose to
download" setting, the progress relay and the restart call are all real, and the
update feed is real GitHub Releases config — but until a draft release is actually
*published*, a packaged check simply finds nothing. The remaining production gap is
code-signing.

.. CG-EXPLANATION-END id=module-header

``const APP_IS_SIGNED``
-----------------------

.. CG-BLOCK id=const:APP_IS_SIGNED lines=47-49

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:APP_IS_SIGNED

**What this does.** A single true/false switch, currently ``false``, saying
whether this build is code-signed (carries a cryptographic seal proving it came
from the maker).

**Why it is here.** The closed beta ships unsigned (owner ruling, 2 September
2026), so this stays ``false`` until the signing certificate lands. The comment
notes that it should be flipped to ``true`` in the very same change that wires up
signing — so the silent install-on-quit only ever switches back on for a build
that is genuinely trusted.

.. CG-EXPLANATION-END id=const:APP_IS_SIGNED

``const UPDATER_EVENT_CHANNEL``
-------------------------------

.. CG-BLOCK id=const:UPDATER_EVENT_CHANNEL lines=50-52

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:UPDATER_EVENT_CHANNEL

**What this does.** Names the message channel — ``updater:event`` — that the page
listens on for every updater status change.

**Why it is here.** The main process and the on-screen page talk to each other by
sending messages on named channels (this is *inter-process communication*, or IPC).
Both sides must agree on the exact channel name; writing it once as a shared
constant is what guarantees the sender and the listener never drift apart.

.. CG-EXPLANATION-END id=const:UPDATER_EVENT_CHANNEL

``type UpdaterPhase``
---------------------

.. CG-BLOCK id=type:UpdaterPhase lines=53-63

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 53-63
   :lineno-match:

.. CG-EXPLANATION-START id=type:UpdaterPhase

**What this does.** Lists every stage the updater can be in as a fixed set of
words: ``idle``, ``checking``, ``available``, ``not-available``, ``downloading``,
``downloaded``, ``error`` and ``disabled``.

**Why it is here.** The page shows a different thing at each stage (a progress bar
while downloading, a "Restart" button once downloaded, a quiet line when there is
nothing new). Naming the stages as one closed set lets the page switch cleanly on
the current stage, and lets the compiler catch a mistyped stage name.

.. CG-EXPLANATION-END id=type:UpdaterPhase

``interface UpdaterEvent``
--------------------------

.. CG-BLOCK id=interface:UpdaterEvent lines=64-73

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 64-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpdaterEvent

**What this does.** Describes one status message sent to the page: a required
``phase`` (which stage), plus optional extras that only make sense at certain
stages — ``notice`` (what update is on offer) on "available" and "downloaded",
``progressPercent`` (a whole number 0 to 100) while downloading, and ``message``
(a short line of text) on "error" or "disabled".

**Why it is here.** One tidy shape carries everything the page needs for any stage,
with the optional fields present only when they apply. That keeps the messages
small and predictable, and matches the safe, string-or-number style the page is
built to receive.

.. CG-EXPLANATION-END id=interface:UpdaterEvent

``let targetWindow``
--------------------

.. CG-BLOCK id=let:targetWindow lines=74-74

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 74-74
   :lineno-match:

.. CG-EXPLANATION-START id=let:targetWindow

**What this does.** A slot holding the app window that should receive updater
messages — empty (``null``) until a window is attached.

**Why it is here.** The updater needs to know *which* window to push its status
messages to. Keeping that window in one place lets every function below send to it
without being handed it each time.

.. CG-EXPLANATION-END id=let:targetWindow

``let wired``
-------------

.. CG-BLOCK id=let:wired lines=75-77

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 75-77
   :lineno-match:

.. CG-EXPLANATION-START id=let:wired

**What this does.** A true/false flag remembering whether the updater's event
listeners have already been attached — starts ``false``.

**Why it is here.** Attaching the same listeners twice would make every status
message fire twice. This flag lets the setup below run its wiring once and quietly
skip it on any later call.

.. CG-EXPLANATION-END id=let:wired

``function emit``
-----------------

.. CG-BLOCK id=function:emit lines=78-93

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 78-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit

**What this does.** Sends one status message to the attached window on the shared
channel — but only if a window is actually attached (the ``?.`` means "do this
only if the thing before it exists").

**Why it is here.** It is the single place all the status updates go out through,
so the rest of the file just says ``emit(...)`` and never repeats the channel name
or the "is there a window?" guard. If no window is attached yet, the message is
harmlessly dropped rather than causing a crash.

.. CG-EXPLANATION-END id=function:emit

``function configureUpdater``
-----------------------------

.. CG-BLOCK id=function:configureUpdater lines=94-132

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 94-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureUpdater

**What this does.** The one-time setup. It remembers the window, and — only on the
first call — turns off automatic downloading, sets install-on-quit according to
whether the build is signed, and attaches a listener for each thing the updater
library can announce: checking, an update available, none available, download
progress, a finished download, and an error. Each listener turns that announcement
into a tidy status message and sends it to the page.

**Why it is here.** This is safe to call even in development, because it only sets
up listeners — no network happens until a check is actually run, and that is itself
gated on being packaged. Two settings are deliberate: automatic download is off so
the *user* decides when to pull an update (the "Download / Later" choice), and
install-on-quit is off for an unsigned build so an update is never silently swapped
in — the user's explicit "Install now" stays the only install path until signing
lands.

.. CG-EXPLANATION-END id=function:configureUpdater

``function checkForUpdates``
----------------------------

.. CG-BLOCK id=function:checkForUpdates lines=133-160

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 133-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:checkForUpdates

**What this does.** Asks the feed whether a newer version exists. In development
(not packaged) it does no real check: if the user asked for it by hand it sends a
friendly "disabled in development" message; on the silent launch check it stays
quiet. In a packaged build it asks the library to check, and if that request fails
it writes a warning to the log rather than letting the failure go unhandled.

**Why it is here.** The ``manual`` flag lets one function serve two callers — the
user pressing "Check for updates" and the automatic launch check — while showing
the "disabled" message only when a human is waiting for a response. Catching the
failure matters because a feed that has only *draft* releases (as the closed beta
does) legitimately rejects the check; that is a log warning, never a crash.

.. CG-EXPLANATION-END id=function:checkForUpdates

``function checkForUpdatesOnLaunch``
------------------------------------

.. CG-BLOCK id=function:checkForUpdatesOnLaunch lines=161-166

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 161-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:checkForUpdatesOnLaunch

**What this does.** The automatic check run shortly after the app starts. It first
asks the policy "should a launch even check?"; if not (a development run), it
returns straight away. Otherwise it runs a silent, non-manual check.

**Why it is here.** This is the wiring that ties the pure launch-gate rule from
``updaterPolicy.ts`` to the real check. Because it defers to that rule, the
developer's daily launch never reaches out to the feed at all.

.. CG-EXPLANATION-END id=function:checkForUpdatesOnLaunch

``function downloadUpdate``
---------------------------

.. CG-BLOCK id=function:downloadUpdate lines=167-172

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 167-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:downloadUpdate

**What this does.** Starts downloading the offered update — the action behind the
page's "Download" button. It does nothing in a development build.

**Why it is here.** Because automatic downloading was switched off, the download
only happens when the user asks for it, and this is the call that begins it. As
progress arrives, the "download-progress" listener set up earlier relays it to the
page.

.. CG-EXPLANATION-END id=function:downloadUpdate

``function quitAndInstall``
---------------------------

.. CG-BLOCK id=function:quitAndInstall lines=173-176

.. literalinclude:: ../../../desktop/src/main/updaterService.ts
   :language: typescript
   :lines: 173-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:quitAndInstall

**What this does.** Closes the app and installs the downloaded update — the action
behind the page's "Restart & install" button. It does nothing in a development
build.

**Why it is here.** This is the explicit, user-initiated install path. Because the
silent install-on-quit is switched off for the unsigned beta, this deliberate
button press is the only way an update gets installed — the user is always in
control of the restart.

.. CG-EXPLANATION-END id=function:quitAndInstall

