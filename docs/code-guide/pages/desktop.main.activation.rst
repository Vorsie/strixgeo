desktop.main.activation
=======================

.. CG-PAGE source=desktop/src/main/activation.ts complete=false

*Source file:* ``desktop/src/main/activation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in the one tool it borrows. An
Electron app runs as two kinds of program at once: the *main* process (full
Node.js, with access to files, other programs and windows — this whole group of
files is the main process) and the *renderer* (the web page the user actually
sees, walled off from the computer). This is main-process code, and it is the
*decision half* of activation: given the licence stored on this computer, the
highest moment the app has ever seen on the clock, and the time right now, it
works out which "state" the licence is in and whether a real shipped build would
refuse to open. It touches no files and no network itself; the only thing it
imports is ``CLOCK_SKEW_TOLERANCE_MS`` from the beta-expiry code next door.

**Why it is here.** "Activation" is how a paid app checks it is allowed to run:
the user pastes a subscription key, the app confirms it, and only then does the
engine start. Keeping the pure decision-making in its own file — no files
touched, no network, nothing from Electron — means the test suite can drive
every possible outcome on any machine. The docstring records the owner rulings
this file obeys: a lapsed licence still opens for a 30-day offline grace (so a
month working on a site with no internet is a non-event); one device per Solo
seat; and a free trial travels the exact same path as a paid licence, differing
only in the word shown on screen. It is honest about its limits — the real
server and the cryptographic signature that would make a licence file
un-forgeable are still to come.

.. CG-EXPLANATION-END id=module-header

``const DAY_MS``
----------------

.. CG-BLOCK id=const:DAY_MS lines=37-45

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 37-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:DAY_MS

**What this does.** A single fixed number: how many milliseconds are in one day.
Every time window in this file is written in days and then multiplied by this.

**Why it is here.** Computers count time in milliseconds, but the rules here
("30 days of grace", "N days remaining") are spoken in days. Naming the
conversion once keeps those rules readable and stops the same long
multiplication being retyped — and possibly mistyped — in several places.

.. CG-EXPLANATION-END id=const:DAY_MS

``const DEFAULT_OFFLINE_GRACE_WINDOW_MS``
-----------------------------------------

.. CG-BLOCK id=const:DEFAULT_OFFLINE_GRACE_WINDOW_MS lines=46-54

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 46-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_OFFLINE_GRACE_WINDOW_MS

**What this does.** Sets the length of the *grace period* — the stretch of time
a licence keeps working after its official end date — to 30 days.

**Why it is here.** This is the owner's ruling 14 written into the code. Thirty
days is a deliberate balance: long enough that an engineer can spend a month on
a remote site with no internet and never be interrupted, yet short enough that a
cancelled subscription cannot be stretched out for close to a year. The value is
exported so other parts of the app read the same number rather than each guess
their own.

.. CG-EXPLANATION-END id=const:DEFAULT_OFFLINE_GRACE_WINDOW_MS

``const LICENCE_TIERS``
-----------------------

.. CG-BLOCK id=const:LICENCE_TIERS lines=55-55

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 55-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:LICENCE_TIERS

**What this does.** Lists the three subscription levels the product sells —
``solo``, ``pro`` and ``studio`` — as a fixed list the running program can check
against.

**Why it is here.** It is written as a real list (not merely a type note) on
purpose, so that when a licence is read back off the disk the app can ask "is
this tier one of the three we actually sell?". A file someone hand-edited to say
``tier: "gold"`` fails that check and is thrown out rather than granting a seat.

.. CG-EXPLANATION-END id=const:LICENCE_TIERS

``type LicenceTier``
--------------------

.. CG-BLOCK id=type:LicenceTier lines=56-64

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 56-64
   :lineno-match:

.. CG-EXPLANATION-START id=type:LicenceTier

**What this does.** Turns the list above into a *type* — a note to the rest of
the code that a "tier" value is only ever allowed to be ``solo``, ``pro`` or
``studio``, and nothing else. (In TypeScript a type is just such a note about
what kind of value is expected.) The comment block at the end of this section is
the lead-in to the list of licence states that follows next.

**Why it is here.** Deriving the type straight from the one real list means the
two can never drift apart: add a fourth tier to the list and the type updates
itself. It also lets the editor and the build catch a typo like ``"studo"``
before the app is ever run.

.. CG-EXPLANATION-END id=type:LicenceTier

``type LicenceState``
---------------------

.. CG-BLOCK id=type:LicenceState lines=65-80

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 65-80
   :lineno-match:

.. CG-EXPLANATION-START id=type:LicenceState

**What this does.** Names every state a licence can be in: ``unactivated`` (no
key yet), ``trial``, ``active`` (a paid, in-date licence), ``grace`` (lapsed but
still inside the 30-day window), ``expired``, ``clock-rollback`` (the computer's
clock was wound backwards) and ``device-mismatch`` (the licence belongs to a
different machine). Only one of these is ever true at a time.

**Why it is here.** Writing the states out as a closed list means the rest of
the app can only ever deal with a state that actually exists — a misspelt state
is caught by the build, not by a confused user. The docstring flags one
deliberate ordering point: ``clock-rollback`` is checked before the date-based
states, because once the clock is known to be lying no date sum based on it can
be trusted.

.. CG-EXPLANATION-END id=type:LicenceState

``interface Licence``
---------------------

.. CG-BLOCK id=interface:Licence lines=81-100

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 81-100
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Licence

**What this does.** Describes the shape of the licence a computer holds: the key
that was entered, the tier, whether it is a trial, which single device it is
tied to (and that device's readable name), when it was issued, when it
officially ends, and how long the grace window after that end lasts. Each line
is one field with a short note on what it means.

**Why it is here.** This is the *contract* — the agreed shape of a licence —
that the issuer writes and the decision code reads. The docstring is careful to
draw a line the reader should keep in mind: today this is plain text written by
a stand-in issuer, but in the finished product it would be a short-lived file
*signed* by the server so it cannot be forged. The shape stays the same either
way; the signature is the piece still to be added.

.. CG-EXPLANATION-END id=interface:Licence

``interface ActivationVerdict``
-------------------------------

.. CG-BLOCK id=interface:ActivationVerdict lines=101-122

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 101-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationVerdict

**What this does.** Describes the shape of the *answer* the decision code
produces: which state fired, whether a shipped build would block, the tier,
whether it is a trial, how many days are left, how many grace days are left, the
end date and the grace-end date echoed back for display, and one plain sentence
that is safe to write to the log. Fields that do not apply to the current state
are simply ``null`` (empty).

**Why it is here.** Everything downstream — the main process deciding whether to
open, and the screen the user sees — reads this one object, so packing the whole
outcome into a single tidy shape means nobody has to redo the reasoning. The
``reason`` line is written deliberately to carry no secret, so it is safe both
to show the user and to record in the log.

.. CG-EXPLANATION-END id=interface:ActivationVerdict

``function isUsableInstant``
----------------------------

.. CG-BLOCK id=function:isUsableInstant lines=123-152

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 123-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:isUsableInstant

**What this does.** A tiny yes/no helper: it returns true only when a value is a
real, finite number that we are willing to compare against the clock. The long
comment block below it is the instruction manual for the big function that comes
next.

**Why it is here.** The stored high-water clock reading, or a date field, could
be missing or garbage — a corrupted file, a hand-edit. Checking "is this
actually a usable number?" before doing any date arithmetic stops a bad value
from silently producing a nonsense verdict.

.. CG-EXPLANATION-END id=function:isUsableInstant

``function evaluateActivation``
-------------------------------

.. CG-BLOCK id=function:evaluateActivation lines=153-258

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 153-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:evaluateActivation

**What this does.** The heart of the file. It takes the stored licence, this
machine's own device id, the highest clock reading ever seen, and the current
time, and returns the one verdict. It checks the possibilities in a fixed order
and stops at the first that fits: no licence at all becomes ``unactivated`` and
blocked; a licence that belongs to another machine becomes ``device-mismatch``
and blocked; a clock wound back further than a small tolerance becomes
``clock-rollback`` and blocked; still before the end date is ``active`` (or
``trial``) with a day count; past the end but inside the grace window is
``grace`` with a grace-day count; anything else is ``expired`` and blocked. Day
counts are always rounded up, so a licence with a few hours left reads "1 day",
never "0".

**Why it is here.** This is where the owner's rulings actually take effect, and
the order is deliberate and load-bearing. The device-binding check and the
clock-rollback check both run before any date sum, because a copied licence file
or a lying clock must never be given the benefit of a date calculation. Reusing
the beta code's clock tolerance means the licence gate and the beta-expiry gate
behave identically against the same attempt to cheat the clock. Each branch also
hands back a plain-English ``reason`` that is safe to log.

.. CG-EXPLANATION-END id=function:evaluateActivation

``interface ActivationLaunchInputs``
------------------------------------

.. CG-BLOCK id=interface:ActivationLaunchInputs lines=259-294

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 259-294
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationLaunchInputs

**What this does.** Describes the three facts the launch gate weighs: whether
this is a packaged (shipped) build, whether the end-to-end test harness is
running, and the verdict from ``evaluateActivation`` (of which only "is it
blocked?" is consulted here). The long comment below it explains the rule the
next function applies.

**Why it is here.** Bundling exactly the inputs the decision needs — and nothing
more — keeps that decision a simple, testable function. The docstring spells out
the policy: a development build and the test harness never block, so the owner's
daily work and the automated suite are untouched, while a beta build is *not*
exempt — the owner ruled that a tester still enters a key before the engine
starts.

.. CG-EXPLANATION-END id=interface:ActivationLaunchInputs

``function activationBlocksLaunch``
-----------------------------------

.. CG-BLOCK id=function:activationBlocksLaunch lines=295-305

.. literalinclude:: ../../../desktop/src/main/activation.ts
   :language: typescript
   :lines: 295-305
   :lineno-match:

.. CG-EXPLANATION-START id=function:activationBlocksLaunch

**What this does.** The final yes/no the main process asks before starting the
engine: should this build refuse to open because of the licence? It answers "no"
for a development build, "no" while the test harness is running, and otherwise
passes through whatever the verdict said — blocked or not.

**Why it is here.** A packaged build must not spawn the backend or show a window
until a licence is accepted, but that must never happen during development or
during the automated tests. Keeping this as one tiny pure function (no files, no
Electron) means the test suite can prove every branch, and the real app calls it
in just one place, right before it would otherwise start the engine. The
comments record the owner's decision of 3 September 2026 that even a
time-limited beta still requires a key first — that is how the beta cohort shows
up in the "who is testing" readout on the server.

.. CG-EXPLANATION-END id=function:activationBlocksLaunch

