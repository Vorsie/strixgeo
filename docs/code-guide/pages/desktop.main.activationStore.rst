desktop.main.activationStore
============================

.. CG-PAGE source=desktop/src/main/activationStore.ts complete=false

*Source file:* ``desktop/src/main/activationStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the *store* — the code that owns the licence file
on disk. It reads and writes one file, ``activation.json``, inside the folder
Electron gives each app for its own data. That file holds the device's current
licence, a small clock "anchor" reused from the beta-expiry code (to catch a
wound-back clock), and a stable id for this installation. The decision code owns
the rules; this file owns the bytes.

**Why it is here.** Splitting "the rules" from "the bytes" mirrors the
beta-expiry store and, crucially, means this file must never import Electron
directly — so the tests can drive it, and the app hands in the actual folder
from outside. Every path through it that meets a damaged, oversized or foreign
file returns a safe empty state rather than crashing, so a corrupt file can
neither brick the app nor sneak past the check. The docstring is honest about
trust: today the file is plain, unsigned text in a folder the user controls; the
finished product would store a cryptographically signed licence here and verify
it before trusting the dates — the shape is the contract, the signature is the
to-do.

.. CG-EXPLANATION-END id=module-header

``const ACTIVATION_FILENAME``
-----------------------------

.. CG-BLOCK id=const:ACTIVATION_FILENAME lines=33-35

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:ACTIVATION_FILENAME

**What this does.** The name of the file — ``activation.json`` — inside the
user-data folder.

**Why it is here.** Naming it once means the read and write paths cannot drift
onto different filenames.

.. CG-EXPLANATION-END id=const:ACTIVATION_FILENAME

``const ACTIVATION_KIND``
-------------------------

.. CG-BLOCK id=const:ACTIVATION_KIND lines=36-38

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:ACTIVATION_KIND

**What this does.** A fixed marker string stored inside the file that identifies
it as ours; a file not carrying this value is treated as foreign and skipped.

**Why it is here.** The user-data folder holds many apps' files; this stamp lets
the reader tell "this is a StrixGeo activation file" from "this is something else
that happens to be JSON", and refuse the latter.

.. CG-EXPLANATION-END id=const:ACTIVATION_KIND

``const ACTIVATION_FORMAT_VERSION``
-----------------------------------

.. CG-BLOCK id=const:ACTIVATION_FORMAT_VERSION lines=39-41

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 39-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:ACTIVATION_FORMAT_VERSION

**What this does.** A version number stamped into the file, currently 1.

**Why it is here.** If the set of fields ever changes shape, bumping this number
lets a future reader tell an old file from a new one and upgrade it — the same
forward-compatibility habit the project uses for its project files.

.. CG-EXPLANATION-END id=const:ACTIVATION_FORMAT_VERSION

``const ACTIVATION_CAP_BYTES``
------------------------------

.. CG-BLOCK id=const:ACTIVATION_CAP_BYTES lines=42-44

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:ACTIVATION_CAP_BYTES

**What this does.** A size limit — 16 kilobytes — above which the file is
refused as "not ours".

**Why it is here.** The real file holds one licence and two numbers, so it is
tiny; anything much bigger is either corrupt or a hostile plant, and reading it
would be wasteful at best. Refusing an oversized file up front is a cheap guard.

.. CG-EXPLANATION-END id=const:ACTIVATION_CAP_BYTES

``interface ActivationState``
-----------------------------

.. CG-BLOCK id=interface:ActivationState lines=45-54

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 45-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationState

**What this does.** The in-memory shape of what the store holds: the current
licence (or none), the clock anchor (or none), and the device id.

**Why it is here.** This is the single shape the read returns and the write
takes, so the service above never has to know how the bytes are laid out on
disk. Licence and anchor are allowed to be empty so a partial or older file
degrades gracefully to "not activated" rather than failing.

.. CG-EXPLANATION-END id=interface:ActivationState

``interface ActivationStoreConfig``
-----------------------------------

.. CG-BLOCK id=interface:ActivationStoreConfig lines=55-68

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 55-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationStoreConfig

**What this does.** The settings handed to the store: the absolute path of
Electron's user-data folder, and an optional stable device id to seed a
brand-new store with instead of a random one.

**Why it is here.** Handing the folder in (rather than importing Electron) is
what lets the tests run this file. The optional seed matters for a real
subtlety: if the id were always a fresh random value, wiping ``activation.json``
— or reinstalling — would change the device's identity and break the "one
device" binding. Seeding it from a hardware-derived id means the same machine
keeps the same identity across a reinstall.

.. CG-EXPLANATION-END id=interface:ActivationStoreConfig

``let config``
--------------

.. CG-BLOCK id=let:config lines=69-78

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 69-78
   :lineno-match:

.. CG-EXPLANATION-START id=let:config

**What this does.** A single private slot that remembers the store's settings
once they are provided; it starts empty. The comment block below it is the note
for the next function.

**Why it is here.** The folder is not known until the app starts, so the store
begins empty and is "configured" once at start-up; keeping that one value here
lets every function below reach it.

.. CG-EXPLANATION-END id=let:config

``function configureActivationStore``
-------------------------------------

.. CG-BLOCK id=function:configureActivationStore lines=79-83

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 79-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureActivationStore

**What this does.** Records the store's settings (the folder, and any device-id
seed) for every later read and write to use.

**Why it is here.** It is the one call the app makes at start-up to point the
store at the right folder; until it is called, the store has nowhere to read or
write.

.. CG-EXPLANATION-END id=function:configureActivationStore

``function resetActivationStoreForTests``
-----------------------------------------

.. CG-BLOCK id=function:resetActivationStoreForTests lines=84-88

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 84-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetActivationStoreForTests

**What this does.** Forgets the settings again.

**Why it is here.** It exists only for the tests, so one test's configuration
cannot leak into the next and quietly change its result.

.. CG-EXPLANATION-END id=function:resetActivationStoreForTests

``function requireConfig``
--------------------------

.. CG-BLOCK id=function:requireConfig lines=89-96

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 89-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:requireConfig

**What this does.** Hands back the settings, or throws a clear error naming the
start-up call that was skipped if they were never provided.

**Why it is here.** Reading the file before the store is pointed at a folder is
a programming mistake; failing loudly with a message that names the missing
``configureActivationStore`` call turns a confusing "undefined" crash into an
obvious one.

.. CG-EXPLANATION-END id=function:requireConfig

``function activationStatePath``
--------------------------------

.. CG-BLOCK id=function:activationStatePath lines=97-101

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 97-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:activationStatePath

**What this does.** Joins the configured folder and the filename into the full
path of the activation file.

**Why it is here.** Both the read and the write need that path; computing it in
one place keeps them agreed on exactly one location.

.. CG-EXPLANATION-END id=function:activationStatePath

``function isUsableInstant``
----------------------------

.. CG-BLOCK id=function:isUsableInstant lines=102-115

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 102-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:isUsableInstant

**What this does.** A yes/no helper: is this a real, finite number we are
willing to treat as a time value? The comment below it is the manual for the
read function.

**Why it is here.** The numbers in the file (dates, the clock anchor) could be
missing or garbage after a hand-edit or corruption; checking each is actually a
usable number before trusting it stops bad data slipping through.

.. CG-EXPLANATION-END id=function:isUsableInstant

``function readActivationState``
--------------------------------

.. CG-BLOCK id=function:readActivationState lines=116-153

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 116-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:readActivationState

**What this does.** Reads and validates the file, returning the stored state. It
starts from a fresh empty state (no licence, no anchor, a newly-minted device
id) and returns that fresh state at every failure: the file is missing, too big,
unreadable, not valid JSON, not an object, or does not carry our marker. Only
when all those pass does it pull out the device id, the licence (if it survives
the shape check) and the anchor (if it survives its check).

**Why it is here.** This is the front line against a corrupt or tampered file.
Every failure resolves to a safe empty state and never throws, so a broken file
can neither crash the app nor be mistaken for a valid seat. The device id
prefers the configured hardware-derived seed over a random one, so a reinstall
re-derives the same identity rather than silently minting a new device.

.. CG-EXPLANATION-END id=function:readActivationState

``function isPlausibleLicence``
-------------------------------

.. CG-BLOCK id=function:isPlausibleLicence lines=154-170

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 154-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:isPlausibleLicence

**What this does.** A shape check on a licence read from disk: every field must
be the right type, and the tier must be one of the three the product actually
sells.

**Why it is here.** Because the file is plain, unsigned text in a folder the
user owns, this is the stand-in for the real cryptographic signature that is
still to come. It is what makes a hand-edit — changing ``tier`` to ``"gold"``,
or flipping the trial flag to text — read back as "no licence" instead of a
trusted seat. The docstring is honest that this is only a shape check, not proof
that the file really came from us.

.. CG-EXPLANATION-END id=function:isPlausibleLicence

``function isPlausibleAnchor``
------------------------------

.. CG-BLOCK id=function:isPlausibleAnchor lines=171-182

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 171-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:isPlausibleAnchor

**What this does.** A shape check on the clock anchor: both timestamps must be
usable numbers, and the "last seen" must not come before the "first seen".

**Why it is here.** The anchor is the defence against a wound-back clock, so a
nonsensical anchor — one whose last-seen predates its first-seen — is rejected
rather than trusted. A garbage anchor must never be able to either rescue an
expired licence or wrongly block a live one.

.. CG-EXPLANATION-END id=function:isPlausibleAnchor

``function writeActivationState``
---------------------------------

.. CG-BLOCK id=function:writeActivationState lines=183-212

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 183-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeActivationState

**What this does.** Writes the state back to disk *atomically* — as one
all-or-nothing replacement — wrapping it in the marker, the version number and
the fields.

**Why it is here.** An atomic write means the file is never left half-written if
the app is killed mid-save; a reader always sees either the complete old file or
the complete new one, never a truncated mixture. Unlike the launch-recording
path below, this function lets a write failure surface, so the tests can check
that a real write happened.

.. CG-EXPLANATION-END id=function:writeActivationState

``function recordActivationLaunch``
-----------------------------------

.. CG-BLOCK id=function:recordActivationLaunch lines=213-222

.. literalinclude:: ../../../desktop/src/main/activationStore.ts
   :language: typescript
   :lines: 213-222
   :lineno-match:

.. CG-EXPLANATION-START id=function:recordActivationLaunch

**What this does.** Marks that the app is running right now: it reads the
current state, moves the clock anchor forward to the current time, tries to save
it, and returns the updated state.

**Why it is here.** Advancing the anchor on every launch is what builds the
"highest time ever seen" high-water mark that catches a clock wound backwards
later. The save is best-effort — a read-only user-data folder must never stop
the app from opening — and it returns the in-memory updated state either way,
because this launch's decision is correctly made from that state whether or not
the save reached disk.

.. CG-EXPLANATION-END id=function:recordActivationLaunch

