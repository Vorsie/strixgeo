desktop.main.diagnosticsConsent
===============================

.. CG-PAGE source=desktop/src/main/diagnosticsConsent.ts complete=false

*Source file:* ``desktop/src/main/diagnosticsConsent.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's introduction and its toolbox. The block
of text in ``/** ... */`` at the top is the file's own note to a reader. It
explains the one idea the whole file exists to hold: two very different things
are kept apart. *Capturing* diagnostics — writing a crash/error log to a file in
the user's own app folder — is local, always on, and needs no permission.
*Transmitting* them — sending that log anywhere — needs a recorded, deliberate
"yes". This file is where that yes-or-no answer is stored. The ``import`` lines
below pull in the tools it uses: a few file-reading helpers from Node's ``fs``,
the ``join`` helper for building file paths, the project's own
``writeFileAtomic`` (a safe way to write a file, from ``atomicWrite.ts``), and
``diagnosticsDirPath`` (where the diagnostics folder lives, from
``diagnosticsStore.ts``).

**Why it is here.** This whole group of files is the Electron *main process* —
the part of the desktop app that runs on Node.js with full access to the
computer (files, windows, child programs), as opposed to the *renderer* (the web
page the user sees, which is sandboxed and cannot touch the disk directly). The
firm using this app is a geotechnical consultancy, and their rule is that a
crash log must never leave the building without a person choosing to send it. So
the default here is NO, and — as the docstring stresses — *every* failure reads
as NO too: an unreadable file, a file left by some other app, a value that is
the wrong type. A consent record is the one place where guessing "yes" when in
doubt is never acceptable.

.. CG-EXPLANATION-END id=module-header

``const CONSENT_FILENAME``
--------------------------

.. CG-BLOCK id=const:CONSENT_FILENAME lines=29-31

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONSENT_FILENAME

**What this does.** Fixes the name of the consent file: ``consent.json``. It
lives inside the diagnostics folder in the user's app directory.

**Why it is here.** Naming it once, in a named constant, means every function
that reads or writes the answer points at the same file — the project's rule of
never burying such values inside a function.

.. CG-EXPLANATION-END id=const:CONSENT_FILENAME

``const CONSENT_KIND``
----------------------

.. CG-BLOCK id=const:CONSENT_KIND lines=32-34

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONSENT_KIND

**What this does.** Sets a fixed label, ``strixgeo.diagnostics-consent``, that
gets written inside the file. When the file is read back, code checks for this
exact label first.

**Why it is here.** It is a "this file is really ours" stamp. If some other
program (or a leftover from a different app) happened to leave a ``consent.json``
in the same spot, it would not carry this label, and the reader treats it as "no
answer recorded" rather than trusting whatever it found. The comment calls it an
*envelope discriminator* — the marker that tells apart our envelope from someone
else's.

.. CG-EXPLANATION-END id=const:CONSENT_KIND

``const CONSENT_FORMAT_VERSION``
--------------------------------

.. CG-BLOCK id=const:CONSENT_FORMAT_VERSION lines=35-37

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONSENT_FORMAT_VERSION

**What this does.** Records the version number of the file's layout — currently
``1`` — which is written into the file.

**Why it is here.** If the shape of this record ever needs to change in a future
release, an older file can still be recognised by its version and upgraded
rather than misread. It is cheap insurance stamped in from day one.

.. CG-EXPLANATION-END id=const:CONSENT_FORMAT_VERSION

``const CONSENT_CAP_BYTES``
---------------------------

.. CG-BLOCK id=const:CONSENT_CAP_BYTES lines=38-40

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 38-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONSENT_CAP_BYTES

**What this does.** Sets a small ceiling — 4 kilobytes — on how big the consent
file is allowed to be before the reader gives up on it.

**Why it is here.** The real file holds only one true/false answer and one
timestamp, which is tiny. Anything vastly larger is not a genuine consent file,
so refusing to read it (and reading it as "no answer") is safer than trying to
parse a suspicious blob.

.. CG-EXPLANATION-END id=const:CONSENT_CAP_BYTES

``interface ConsentRecord``
---------------------------

.. CG-BLOCK id=interface:ConsentRecord lines=41-55

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 41-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ConsentRecord

**What this does.** Describes the two-field answer this module stores:
``transmissionOptIn`` (a plain true/false — true only if the user explicitly
opted in) and ``decidedAt`` (when the answer was recorded, as an ISO-8601 date
text). An ``interface`` in TypeScript is just a note about what shape a value
has; it writes no code by itself.

**Why it is here.** Keeping *when* the answer was given alongside the answer
itself lets a future settings screen show "you allowed this on such-and-such
date", and makes an audit of the decision possible. The shape is written down so
every function that hands one of these around agrees on what is inside.

.. CG-EXPLANATION-END id=interface:ConsentRecord

``function consentFilePath``
----------------------------

.. CG-BLOCK id=function:consentFilePath lines=56-68

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 56-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:consentFilePath

**What this does.** Builds and returns the full path to the consent file —
``<userData>/diagnostics/consent.json`` — by joining the diagnostics directory
with the file name.

**Why it is here.** One helper that answers "where is the consent file?" so the
reader and the writer never disagree about the location.

.. CG-EXPLANATION-END id=function:consentFilePath

``function readConsentRecord``
------------------------------

.. CG-BLOCK id=function:readConsentRecord lines=69-109

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 69-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:readConsentRecord

**What this does.** Reads the stored answer back and hands out a
``ConsentRecord``, or ``null`` when there is no trustworthy answer. It works
through a chain of guards: if the diagnostics location is not set up yet it
returns ``null`` instead of crashing; if the file is missing, ``null``; if
reading or parsing fails, or the file is over the size cap, ``null``; if the
content is not an object, or lacks the ``strixgeo.diagnostics-consent`` label,
or its opt-in value is not strictly a true/false, ``null``. Only a file that
passes every guard yields a record.

**Why it is here.** This is the "fail closed" promise in code. The one comment
worth reading twice is on the boolean check: a text value like ``"false"`` is,
confusingly, treated as "truthy" by JavaScript, so the code insists the opt-in
be a real boolean — a stray string can never be mistaken for a yes. Every doubt
resolves to ``null`` (no answer), which the layer above reads as "do not
transmit".

.. CG-EXPLANATION-END id=function:readConsentRecord

``function readTransmissionConsent``
------------------------------------

.. CG-BLOCK id=function:readTransmissionConsent lines=110-124

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 110-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:readTransmissionConsent

**What this does.** The simple yes/no the rest of the app asks for: it reads the
record and returns ``true`` only when the recorded opt-in is exactly ``true``,
and ``false`` in every other case (no file, damaged file, an opt-out).

**Why it is here.** The uploader (``diagnosticsUploader.ts``) calls this one
function before it ever queues or sends anything. Boiling the whole decision
down to a single guaranteed true/false means the transmit code never has to
reason about missing or broken files — a "no" is the answer to all of them.

.. CG-EXPLANATION-END id=function:readTransmissionConsent

``function setTransmissionConsent``
-----------------------------------

.. CG-BLOCK id=function:setTransmissionConsent lines=125-134

.. literalinclude:: ../../../desktop/src/main/diagnosticsConsent.ts
   :language: typescript
   :lines: 125-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:setTransmissionConsent

**What this does.** Records the user's answer. It makes sure the diagnostics
folder exists, builds the record (the label, the format version, the true/false
answer, and the moment it was decided), and writes it safely to
``consent.json``. The optional ``nowIso`` argument lets a test pin the
timestamp; in normal use the current time is stamped.

**Why it is here.** A "no" is *written*, not represented by deleting the file —
the comment notes this lets a settings screen tell "the user declined" apart
from "the user was never asked". The write goes through ``writeFileAtomic`` so
an interrupted save can never leave a half-written answer that reads as the
wrong choice. (Note: as the module docstring says, there is no settings screen
wired up to call this yet, so in practice a user cannot opt in through the app
today.)

.. CG-EXPLANATION-END id=function:setTransmissionConsent

