desktop.main.diagnosticsPayload
===============================

.. CG-PAGE source=desktop/src/main/diagnosticsPayload.ts complete=false

*Source file:* ``desktop/src/main/diagnosticsPayload.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file that defines the *shape* of an uploaded
diagnostics bundle — the block of data sent to the server when transmission is
allowed — and the one function that assembles it and trims it to a size limit.
The imports pull in ``randomUUID`` (a maker of one-off unique ids) and two
values from the uploader's constants file: a feature flag and the maximum
payload size.

**Why it is here.** As the docstring says, this was split out of the uploader
(``diagnosticsUploader.ts``, which owns the disk queue and the network side) so
the *pure* parts — the data shapes and the size-cap trimming, which touch no
files or network — live in one small place that is easy to test on its own. The
bundle matches the agreed ``POST /v1/diagnostics`` contract: build facts, the
already-redacted log records, a flag saying whether the oldest records were
dropped, and optional identity fields that are only ever attached when a
separate flag is switched on.

.. CG-EXPLANATION-END id=module-header

``interface DiagnosticsBuildFacts``
-----------------------------------

.. CG-BLOCK id=interface:DiagnosticsBuildFacts lines=20-35

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 20-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticsBuildFacts

**What this does.** Describes the three facts stamped on every bundle: the app
version, the platform (the operating system it ran on), and — only when the build
carries one — a beta build stamp.

**Why it is here.** A crash report is far more useful when the server knows which
build and which operating system it came from. This is the same trio of facts
the local log stamps, kept in one named shape.

.. CG-EXPLANATION-END id=interface:DiagnosticsBuildFacts

``interface DiagnosticsIdentity``
---------------------------------

.. CG-BLOCK id=interface:DiagnosticsIdentity lines=36-48

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 36-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticsIdentity

**What this does.** Describes the optional pair of identifying values a bundle
*may* carry — the activation licence key and the device id — both optional.

**Why it is here.** The whole diagnostics design promises that a record carries
no device id, so identity is normally absent. This shape exists for the future
day the owner decides otherwise: it is attached only when a flag is on and a
licence exists. The comment stresses the licence key is a *credential*, so it
must never end up in an ordinary log line — it belongs, if anywhere, only in this
deliberate, gated payload.

.. CG-EXPLANATION-END id=interface:DiagnosticsIdentity

``interface DiagnosticsPayload``
--------------------------------

.. CG-BLOCK id=interface:DiagnosticsPayload lines=49-72

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 49-72
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticsPayload

**What this does.** The full shape of what gets uploaded: a unique ``bundleId``,
a ``createdAt`` timestamp (as milliseconds since 1970, the contract's
convention), the build facts, an ``events`` count, a ``truncated`` flag, the
``ndjson`` records themselves (one JSON object per line — "NDJSON"), and the two
optional identity fields.

**Why it is here.** This is the exact body the server's ``POST /v1/diagnostics``
endpoint expects. The ``ndjson`` records are already redacted, because the local
log they come from was redacted before it was ever written; ``truncated`` tells
the server that some of the *oldest* records had to be dropped to fit the size
limit, so it knows the bundle is only the tail of a longer story.

.. CG-EXPLANATION-END id=interface:DiagnosticsPayload

``function byteLength``
-----------------------

.. CG-BLOCK id=function:byteLength lines=73-95

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 73-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:byteLength

**What this does.** Measures how many bytes a piece of text takes up when written
as UTF-8. The comment below it belongs to the next function, explaining the
identity gate.

**Why it is here.** The size cap is measured in bytes, not characters — an accent
or an emoji is one character but several bytes — so the trimming logic needs the
true byte size to know when a payload actually fits.

.. CG-EXPLANATION-END id=function:byteLength

``function diagnosticsIdentityFor``
-----------------------------------

.. CG-BLOCK id=function:diagnosticsIdentityFor lines=96-122

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 96-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:diagnosticsIdentityFor

**What this does.** Decides whether a bundle should carry identity. It returns
the licence key and device id *only* when the feature flag is on **and** an
activation licence with a key is present; in every other case it returns
"nothing".

**Why it is here.** The docstring names the reason it is its own small function:
the shipped promise is "no device id in a diagnostics record", and this one gate
is the single seam the owner's future ruling would flip. Keeping the whole
decision in one pure, testable place means the privacy posture cannot quietly
change in some far corner of the code — it changes here or nowhere.

.. CG-EXPLANATION-END id=function:diagnosticsIdentityFor

``function buildDiagnosticsPayload``
------------------------------------

.. CG-BLOCK id=function:buildDiagnosticsPayload lines=123-177

.. literalinclude:: ../../../desktop/src/main/diagnosticsPayload.ts
   :language: typescript
   :lines: 123-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildDiagnosticsPayload

**What this does.** Builds a finished payload from a block of NDJSON records,
shrinking it if needed so the whole thing fits under the byte cap. First it
assigns the bundle its unique id. A small inner helper (``make``) turns a block
of records into a complete payload, counting the lines. It tries the *full* set
of records first; if that already fits the cap, it is returned untouched. If it
is too big, it keeps only the trailing (newest) portion that can fit — slicing
from the end, then discarding a half-cut first line so the tail starts on a whole
record — and then, line by line, drops the oldest remaining records until the
payload fits. In that case ``truncated`` is marked ``true``.

**Why it is here.** The docstring explains why the id is a random UUID rather
than something built from the time and version: two bundles assembled in the very
same millisecond (a burst of crashes) would otherwise get the same id and defeat
the server's ability to tell them apart. The trimming keeps the *newest* records
because they are the ones nearest the crash and most worth reading. The comment
notes a subtlety: turning text into JSON can nearly double its size through
escaping, so the code keeps only about half the byte budget as raw text up front
and then trims whole lines until the escaped result truly fits. The function is
*pure* — it reads and writes no files — which is exactly why it can live here,
apart from the uploader.

.. CG-EXPLANATION-END id=function:buildDiagnosticsPayload

