desktop.main.activationRepository
=================================

.. CG-PAGE source=desktop/src/main/activationRepository.ts complete=false

*Source file:* ``desktop/src/main/activationRepository.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the *issuer seam*: the thin, agreed set of
operations any activation server must offer, with none of the detail of how it
does them. (A "seam" here is a clean joint the code is built around, so one side
can be swapped for another.) This is main-process code — the full-power side of
an Electron app. The file itself defines only shapes and the interface; the
real work lives in separate files that plug into it.

**Why it is here.** The owner asked for exactly this: build the activation
service against a thin interface and defer the choice of database, so that
MySQL-versus-SQLite assumptions never leak into the app. Everything above this
line (the app) talks only to this interface; everything below it (a mock today,
the strixgeo.com service tomorrow) can be swapped without the app noticing. The
docstring lists what a real server adds that the mock does not — a network
round-trip that checks the Stripe subscription, a cryptographically *signed*
licence file, and a real device fingerprint — none of which change the shape
here, which is the whole point of a seam.

.. CG-EXPLANATION-END id=module-header

``interface DeviceIdentity``
----------------------------

.. CG-BLOCK id=interface:DeviceIdentity lines=30-37

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 30-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DeviceIdentity

**What this does.** The shape describing the computer that is asking to
activate: a stable, meaningless-to-humans id for the installation, and a
readable name to show the user on the deactivate/transfer screen. (An
"interface" is just an agreed shape a value must have.)

**Why it is here.** Because a licence is tied to one device, every request has
to say which device it comes from. Splitting the id (used by the machine) from
the label (shown to the person) keeps the two jobs clear.

.. CG-EXPLANATION-END id=interface:DeviceIdentity

``interface ActivateRequest``
-----------------------------

.. CG-BLOCK id=interface:ActivateRequest lines=38-48

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 38-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivateRequest

**What this does.** A paid-activation request: the device identity above plus
the licence key the user typed.

**Why it is here.** Activating needs both "who is asking" and "with what key".
Building this on top of ``DeviceIdentity`` rather than re-listing its fields
keeps the two shapes in step.

.. CG-EXPLANATION-END id=interface:ActivateRequest

``type IssueResult``
--------------------

.. CG-BLOCK id=type:IssueResult lines=49-53

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 49-53
   :lineno-match:

.. CG-EXPLANATION-START id=type:IssueResult

**What this does.** The two possible answers to a request: either success with a
licence attached, or failure with a machine-readable code and a message.

**Why it is here.** A failure carries a short *code* (such as ``unknown_key``)
rather than a finished sentence, so the screen — not the server — decides the
exact wording and its translation. Modelling success and failure as two clearly
different shapes forces the calling code to handle both cases instead of
assuming success.

.. CG-EXPLANATION-END id=type:IssueResult

``type IssueFailureCode``
-------------------------

.. CG-BLOCK id=type:IssueFailureCode lines=54-67

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 54-67
   :lineno-match:

.. CG-EXPLANATION-START id=type:IssueFailureCode

**What this does.** The closed list of reasons a request can be refused: the key
is not recognised (``unknown_key``), the key is already on as many devices as
its tier allows (``device_limit``), this device already used its one trial
(``already_trialled``), or the issuer could not be reached (``unreachable``).

**Why it is here.** A fixed list means the screen can map every possible refusal
to a clear message, and the build catches a typo. The comment notes that
``unreachable`` is a stand-in the mock never actually returns — only the real
network issuer can be out of contact.

.. CG-EXPLANATION-END id=type:IssueFailureCode

``interface ActivationRepository``
----------------------------------

.. CG-BLOCK id=interface:ActivationRepository lines=68-114

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 68-114
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationRepository

**What this does.** The seam itself — the operations an issuer offers:
``activate`` (turn a key into a licence for this device), ``startTrial`` (issue
a fresh time-limited trial), ``deactivate`` (release the device so the seat can
move to another machine), and an *optional* ``refresh`` (re-verify a still-bound
device and re-issue its licence with a new end date). Each returns a *promise* —
a value that arrives later — because talking to a server takes time.

**Why it is here.** This is the single contract the app depends on; swap the
mock for the real network service and nothing above it changes. Two design
choices are worth noticing. ``deactivate`` exists because the owner ruled one
device per Solo seat, which makes a self-service transfer necessary. And
``refresh`` is deliberately *optional*: only the network issuer implements it,
so when no server is configured the app simply skips it — which is exactly what
keeps the owner's daily work from ever silently re-checking a licence.

.. CG-EXPLANATION-END id=interface:ActivationRepository

``class DeactivateFailedError``
-------------------------------

.. CG-BLOCK id=class:DeactivateFailedError lines=115-134

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 115-134
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeactivateFailedError

**What this does.** A custom error used only when ``deactivate`` is refused,
carrying the server's HTTP status number — or ``null`` when no answer came back
at all, as in a network failure or timeout.

**Why it is here.** ``deactivate`` reports success just by finishing, so a
refusal has to be thrown as an error instead. Attaching the status lets the
layer above decide what to do without knowing anything about the HTTP machinery:
a ``404`` means the server already holds no record of this device, so the
transfer is effectively done and the local licence is cleared too; any other
status — or a network failure — means the seat might still be held, so the local
licence is *kept* and the error shown, because a half-finished transfer that
strands the seat is the worse outcome.

.. CG-EXPLANATION-END id=class:DeactivateFailedError

``const DEVICE_CAP_BY_TIER``
----------------------------

.. CG-BLOCK id=const:DEVICE_CAP_BY_TIER lines=135-139

.. literalinclude:: ../../../desktop/src/main/activationRepository.ts
   :language: typescript
   :lines: 135-139
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEVICE_CAP_BY_TIER

**What this does.** How many devices each tier may run on at once: Solo one, Pro
two, Studio twenty-five.

**Why it is here.** The owner's ruling fixes Solo at one device; the other two
numbers are prototype guesses to be confirmed. Keeping the caps in one named
table means the issuer checks a single source rather than scattering the numbers
through the code.

.. CG-EXPLANATION-END id=const:DEVICE_CAP_BY_TIER

