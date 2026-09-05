desktop.main.betaExpiryStore
============================

.. CG-PAGE source=desktop/src/main/betaExpiryStore.ts complete=false

*Source file:* ``desktop/src/main/betaExpiryStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the opening note and toolbox for the file that saves
and loads the clock anchor. The anchor is one tiny file,
``<userData>/beta-anchor.json`` (``userData`` is the private folder Electron gives
every app for its own settings), holding the first and highest moments this
installation has ever seen. The note draws a clean line: the neighbouring
``betaExpiry.ts`` owns the *rules*, this file owns the *bytes* — the actual
reading and writing. The imports bring in the basic file tools (does a file exist,
make a folder, read a file), a path joiner, a helper that writes a file *safely*
(``writeFileAtomic``), and the ``advanceAnchor`` rule plus the anchor's shape from
``betaExpiry.ts``.

**Why it is here.** The note explains two deliberate choices. First, the folder
path is handed in from outside rather than fetched from Electron here, so this
file never has to ``import 'electron'`` and the test suite can drive it on any
machine. Second, the trust posture: the anchor is plain, unsigned text in a folder
the user controls, and deleting or editing it is *not* treated as an error — it
simply degrades to "no anchor", and the expiry decision still has the build stamp
and the recent-projects timestamps to work from. The note is candid that signing
the file would only look like security (the key would have to ship inside the app
anyway); the real protection is server-issued licences, described in the
activation memo.

.. CG-EXPLANATION-END id=module-header

``const BETA_ANCHOR_FILENAME``
------------------------------

.. CG-BLOCK id=const:BETA_ANCHOR_FILENAME lines=38-43

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 38-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_ANCHOR_FILENAME

**What this does.** Names the anchor file: ``beta-anchor.json``.

**Why it is here.** The name is written once, in one place, so the read side and
the write side can never disagree about which file to touch.

.. CG-EXPLANATION-END id=const:BETA_ANCHOR_FILENAME

``const BETA_ANCHOR_KIND``
--------------------------

.. CG-BLOCK id=const:BETA_ANCHOR_KIND lines=44-46

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_ANCHOR_KIND

**What this does.** Sets a fixed label, ``strixgeo.beta-anchor``, that every
genuine anchor file must carry inside it.

**Why it is here.** It is a nameplate. When the file is read back, the code checks
for exactly this label; a file that does not carry it is treated as foreign — a
config someone hand-copied, or a same-named file left by a different app — and is
ignored rather than trusted.

.. CG-EXPLANATION-END id=const:BETA_ANCHOR_KIND

``const BETA_ANCHOR_FORMAT_VERSION``
------------------------------------

.. CG-BLOCK id=const:BETA_ANCHOR_FORMAT_VERSION lines=47-53

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 47-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_ANCHOR_FORMAT_VERSION

**What this does.** Records the version number of the file's layout — currently
``1``.

**Why it is here.** If the set of fields inside the anchor ever changes shape, this
number is bumped so a future build can tell an old file from a new one and handle
each correctly. Stamping a version now is cheap insurance against a confusing
mismatch later.

.. CG-EXPLANATION-END id=const:BETA_ANCHOR_FORMAT_VERSION

``const BETA_ANCHOR_CAP_BYTES``
-------------------------------

.. CG-BLOCK id=const:BETA_ANCHOR_CAP_BYTES lines=54-56

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 54-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_ANCHOR_CAP_BYTES

**What this does.** Sets the largest file this code will bother to read — 4
kilobytes.

**Why it is here.** A real anchor holds just two numbers, so it is tiny. If the
file on disk is much bigger than that, it is not ours, and pulling a large
untrusted file into the app's memory is pointless risk. The cap is a cheap
guard-rail matching the same caps used elsewhere in the app.

.. CG-EXPLANATION-END id=const:BETA_ANCHOR_CAP_BYTES

``interface BetaExpiryStoreConfig``
-----------------------------------

.. CG-BLOCK id=interface:BetaExpiryStoreConfig lines=57-61

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 57-61
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BetaExpiryStoreConfig

**What this does.** Describes the one piece of configuration this file needs from
outside: ``userDataDir``, the full path to Electron's private ``userData`` folder.

**Why it is here.** This is the seam that keeps the file testable. Rather than
reaching into Electron to find that folder, the file is *told* the folder at
startup — so a test can point it at a temporary directory and the file itself
never depends on Electron.

.. CG-EXPLANATION-END id=interface:BetaExpiryStoreConfig

``let config``
--------------

.. CG-BLOCK id=let:config lines=62-71

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 62-71
   :lineno-match:

.. CG-EXPLANATION-START id=let:config

**What this does.** Sets aside one slot, ``config``, that starts empty
(``null``) and later holds the configuration once it is handed in. ``let`` marks a
value that is allowed to change (unlike the fixed ``const`` values above).

**Why it is here.** The folder path is not known when the file first loads — only
once the app has started. This slot is where it is remembered, so every function
below can find it without being passed it each time.

.. CG-EXPLANATION-END id=let:config

``function configureBetaExpiryStore``
-------------------------------------

.. CG-BLOCK id=function:configureBetaExpiryStore lines=72-76

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 72-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureBetaExpiryStore

**What this does.** Fills the ``config`` slot with the folder path it is given.

**Why it is here.** This is the one call the startup code makes, once, to point
the store at the real ``userData`` folder before anything tries to read or write
the anchor.

.. CG-EXPLANATION-END id=function:configureBetaExpiryStore

``function resetBetaExpiryStoreForTests``
-----------------------------------------

.. CG-BLOCK id=function:resetBetaExpiryStoreForTests lines=77-81

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 77-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetBetaExpiryStoreForTests

**What this does.** Empties the ``config`` slot again — a test-only helper, as its
name says.

**Why it is here.** Tests run one after another in the same program. Clearing the
configuration between them stops the folder set by one test from silently leaking
into the next and hiding a bug.

.. CG-EXPLANATION-END id=function:resetBetaExpiryStoreForTests

``function requireConfig``
--------------------------

.. CG-BLOCK id=function:requireConfig lines=82-101

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 82-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:requireConfig

**What this does.** Hands back the configuration if it has been set, and otherwise
stops with a clear error that names the call which was skipped
(``configureBetaExpiryStore()``).

**Why it is here.** It turns "the folder was never set up" from a confusing,
far-off crash into an immediate, self-explaining failure at startup. Better to
fail loudly, at the right spot, than to write the anchor into the wrong place.

.. CG-EXPLANATION-END id=function:requireConfig

``function clockAnchorPath``
----------------------------

.. CG-BLOCK id=function:clockAnchorPath lines=102-106

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 102-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:clockAnchorPath

**What this does.** Joins the configured folder and the filename to give the full
path of the anchor file, ``<userData>/beta-anchor.json``.

**Why it is here.** Building the path in one small helper means the read and write
functions both ask the same question and can never end up looking at two different
files.

.. CG-EXPLANATION-END id=function:clockAnchorPath

``function isUsableInstant``
----------------------------

.. CG-BLOCK id=function:isUsableInstant lines=107-119

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 107-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:isUsableInstant

**What this does.** The same tiny yes/no check seen in ``betaExpiry.ts``: is this
value a real, finite number safe to treat as a moment in time?

**Why it is here.** The anchor is read back from a file that could be corrupt or
hand-edited, so each stored number is checked before it is trusted. (The check is
repeated here, rather than shared, because this file is written to stay
independent and importable on its own.)

.. CG-EXPLANATION-END id=function:isUsableInstant

``function readClockAnchor``
----------------------------

.. CG-BLOCK id=function:readClockAnchor lines=120-151

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 120-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:readClockAnchor

**What this does.** Reads the anchor back from disk and returns it — or returns
nothing (``null``) if anything is off. It bails out and returns ``null`` when the
file is absent, when it is bigger than the 4 KB cap, when the text will not parse
as valid data, when it is not actually a labelled object, when it lacks the
``strixgeo.beta-anchor`` nameplate, when either timestamp is not a usable number,
or when it is internally inconsistent (a last-seen time earlier than the
first-seen time). Only a file that clears every one of those checks is handed
back as a trusted anchor.

**Why it is here.** Every damaged-file path lands on ``null`` on purpose, and the
module note spells out the two-sided reason: a corrupt anchor must never be the
reason a legitimate tester is locked out, and it must never become a way to make
the app *skip* the expiry check either. Returning ``null`` — "no anchor" — is the
cautious answer to both, because the expiry rules treat a missing anchor safely
(they still have the build stamp and other timestamps to lean on).

.. CG-EXPLANATION-END id=function:readClockAnchor

``function writeClockAnchor``
-----------------------------

.. CG-BLOCK id=function:writeClockAnchor lines=152-181

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 152-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeClockAnchor

**What this does.** Writes the anchor to disk. It makes sure the folder exists,
wraps the two timestamps in the labelled envelope (nameplate plus version
number), and saves it using the "atomic" writer.

**Why it is here.** An *atomic* write means the file is written whole or not at
all — it writes to a temporary file and swaps it into place — so a crash or power
cut mid-write can never leave a half-written, corrupt anchor behind. Stamping the
nameplate and version on the way out is what lets the read side above recognise
its own file later.

.. CG-EXPLANATION-END id=function:writeClockAnchor

``function recordLaunch``
-------------------------

.. CG-BLOCK id=function:recordLaunch lines=182-191

.. literalinclude:: ../../../desktop/src/main/betaExpiryStore.ts
   :language: typescript
   :lines: 182-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:recordLaunch

**What this does.** The one call the startup code makes each launch: it reads the
current anchor, moves it forward to now (never backward), writes it back, and
returns the updated anchor. If the write fails, the failure is quietly ignored and
the in-memory anchor is still returned.

**Why it is here.** This is the moment the app records "I am running right now",
feeding the ever-climbing high-water mark the expiry check relies on. Swallowing a
write failure is deliberate: a read-only user-data folder must not stop the app
from starting, and the expiry decision for *this* launch is already made from the
value held in memory — so a failed save costs nothing this session.

.. CG-EXPLANATION-END id=function:recordLaunch

