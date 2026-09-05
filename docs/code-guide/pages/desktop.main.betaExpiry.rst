desktop.main.betaExpiry
=======================

.. CG-PAGE source=desktop/src/main/betaExpiry.ts complete=false

*Source file:* ``desktop/src/main/betaExpiry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's long opening note (a *docstring* — a
comment written for whoever reads the code). It explains that this file lives in
Electron's *main process* — the part of the desktop app that has full computer
access (files, windows, launching other programs), as opposed to the *renderer*,
the sandboxed web page the user actually sees. The note says this file is the
"decision half" of the beta-expiry feature: given three facts — the expiry date
baked into the build, a small saved record of the clock, and the current time —
it answers one yes/no question, "may the app open right now?". It does no reading
or writing of files itself, and it borrows nothing from Electron, so the test
suite can drive every possible outcome. The two tables in the note list, in plain
terms, the cheating tricks it does stop (running past the date, winding the clock
back) and the ones it deliberately does not (unpacking and editing the app, or a
determined wipe-everything-and-backdate attack).

**Why it is here.** A beta build is a free preview handed to a hand-picked group
of testers, and the owner's rule (the 26 August 2026 ballot) was blunt:
*"waterproof: beta builds must expire; a beta licence must not be usable for
years."* This file is the offline enforcement of that rule. Keeping it a pure
calculator — no files, no Electron — is a deliberate choice so every branch can be
tested on any machine without cutting a real build. A key design decision the note
records: if the build's own stamp is malformed (our packaging mistake), the file
treats the build as *unstamped* rather than *expired*, because accidentally
bricking a legitimate tester over our own bug is the worse outcome.

.. CG-EXPLANATION-END id=module-header

``const DAY_MS``
----------------

.. CG-BLOCK id=const:DAY_MS lines=36-46

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 36-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:DAY_MS

**What this does.** Defines one fixed number, ``DAY_MS`` — the count of
milliseconds in a day (24 hours × 60 minutes × 60 seconds × 1000). Computers keep
time in milliseconds; people think in days.

**Why it is here.** Every time window in the rest of the file (the warning window,
the days-remaining count) is expressed in days, so the day-to-milliseconds
conversion is written once, in one named place, instead of being retyped as a
mystery number each time it is needed.

.. CG-EXPLANATION-END id=const:DAY_MS

``const CLOCK_SKEW_TOLERANCE_MS``
---------------------------------

.. CG-BLOCK id=const:CLOCK_SKEW_TOLERANCE_MS lines=47-54

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 47-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLOCK_SKEW_TOLERANCE_MS

**What this does.** Sets ``CLOCK_SKEW_TOLERANCE_MS`` to ten minutes — how far the
computer's clock is allowed to sit *behind* the latest time the app has ever seen
before the file decides the clock has been tampered with.

**Why it is here.** Clocks legitimately jump backwards a little: a computer waking
from sleep and re-syncing over the internet, a virtual machine resuming from a
saved snapshot, a laptop with a mis-set clock crossing a time zone. Ten minutes
comfortably covers all of those honest cases. A tester actually trying to wind the
clock back to keep the beta alive has to move it by *days* for the trick to be
worth anything, so the ten-minute grace never helps a cheat while it stops the
honest jumps from being mistaken for one.

.. CG-EXPLANATION-END id=const:CLOCK_SKEW_TOLERANCE_MS

``const EXPIRY_WARNING_WINDOW_MS``
----------------------------------

.. CG-BLOCK id=const:EXPIRY_WARNING_WINDOW_MS lines=55-64

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 55-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:EXPIRY_WARNING_WINDOW_MS

**What this does.** Sets ``EXPIRY_WARNING_WINDOW_MS`` to seven days — how long
before the expiry date the app should start telling the tester "this build
expires in N days".

**Why it is here.** Seven days is the shortest heads-up that still reaches a
tester who only opens the app on working days, so a warning is never missed just
because someone did not launch it over a weekend.

.. CG-EXPLANATION-END id=const:EXPIRY_WARNING_WINDOW_MS

``type BetaExpiryState``
------------------------

.. CG-BLOCK id=type:BetaExpiryState lines=65-71

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 65-71
   :lineno-match:

.. CG-EXPLANATION-START id=type:BetaExpiryState

**What this does.** Lists the five possible verdicts as a *type* (a note to the
rest of the code that a value must be exactly one of these words):
``unstamped`` (this build has no expiry — a development run), ``active`` (fine,
plenty of time left), ``warning`` (fine, but expiring within a week),
``expired`` (the date has passed), and ``clock-rollback`` (the clock has been
moved backwards).

**Why it is here.** Naming the states in the order the checks run makes the logic
below easy to follow, and it lets the compiler catch a typo like ``"expierd"``.
The order matters: ``clock-rollback`` is deliberately ranked ahead of
``expired``, because when the machine's clock disagrees with the app's own memory
of time, the clock is the thing to distrust — the message should say the clock
looks wrong, not claim a date has passed that the calendar says has not.

.. CG-EXPLANATION-END id=type:BetaExpiryState

``interface BetaBuildStamp``
----------------------------

.. CG-BLOCK id=interface:BetaBuildStamp lines=72-86

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 72-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BetaBuildStamp

**What this does.** Describes the shape of the "stamp" — the three expiry facts
baked into a packaged build: ``buildId`` (a readable label like
``2026.08.26-beta``), ``builtAtMs`` (when the build was produced), and
``expiresAtMs`` (the first instant at which it refuses to open). An *interface* is
just a description of what fields a value must carry.

**Why it is here.** These three numbers are compiled straight into the shipped
program at build time (the neighbouring ``buildStamp.ts`` file does the baking),
so nobody can change the expiry date just by editing a settings file. A
development run has no stamp at all, which is why the checks upstream treat a
missing stamp as "no expiry".

.. CG-EXPLANATION-END id=interface:BetaBuildStamp

``interface ClockAnchor``
-------------------------

.. CG-BLOCK id=interface:ClockAnchor lines=87-94

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 87-94
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClockAnchor

**What this does.** Describes the small record the app keeps on disk to remember
the passage of time: ``firstSeenMs`` (the first moment this installation was ever
seen running) and ``lastSeenMs`` (the highest moment it has ever observed).

**Why it is here.** ``lastSeenMs`` is the trick that makes a backwards clock
detectable — it only ever moves forward. If the app has already seen "next
Tuesday" and the clock is then wound back to "last Monday", the mismatch between
the clock and this remembered high point is the giveaway. The file that actually
reads and writes this record is ``betaExpiryStore.ts``.

.. CG-EXPLANATION-END id=interface:ClockAnchor

``interface BetaVerdict``
-------------------------

.. CG-BLOCK id=interface:BetaVerdict lines=95-108

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 95-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BetaVerdict

**What this does.** Describes the answer the calculator hands back: ``state``
(which of the five words applies), ``blocked`` (a plain true/false — must the app
refuse to open?), ``daysRemaining`` (whole days left, or nothing when there is no
stamp), ``reason`` (a single line of text safe to write to the log and show on
screen), and ``expiresAtMs`` (the expiry instant, passed along for the display).

**Why it is here.** Bundling the whole verdict into one tidy object means the
startup code has a single thing to act on: read ``blocked`` to decide whether to
launch, read the rest to build the message. The ``reason`` line is deliberately
written to carry no personal data, so it is safe to log.

.. CG-EXPLANATION-END id=interface:BetaVerdict

``function isUsableInstant``
----------------------------

.. CG-BLOCK id=function:isUsableInstant lines=109-119

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 109-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:isUsableInstant

**What this does.** A tiny yes/no helper: is this value a real, finite number that
we are willing to compare against a clock? It rejects things that are not numbers
and rejects the special "not-a-number" and "infinity" values.

**Why it is here.** These timestamps come from files on disk that could be
corrupt or hand-edited. Checking that a value is a usable number *before* doing
date arithmetic on it stops a garbage value from producing a nonsensical verdict.

.. CG-EXPLANATION-END id=function:isUsableInstant

``function usableStamp``
------------------------

.. CG-BLOCK id=function:usableStamp lines=120-137

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 120-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:usableStamp

**What this does.** Checks a stamp and hands back either a stamp it trusts or
nothing (``null``). It rejects a stamp with no build or expiry time, and it
rejects a stamp that claims to expire *before* it was built — an impossible order
that could only be a mistake.

**Why it is here.** This is where the "malformed stamp is treated as unstamped,
never as expired" rule lives. A packaging slip that produces a broken stamp
should let the tester keep working (the app behaves as if there were no expiry at
all) rather than lock them out over our own bug — the module note calls bricking
a legitimate tester the worse failure.

.. CG-EXPLANATION-END id=function:usableStamp

``function observedHighWaterMs``
--------------------------------

.. CG-BLOCK id=function:observedHighWaterMs lines=138-174

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 138-174
   :lineno-match:

.. CG-EXPLANATION-START id=function:observedHighWaterMs

**What this does.** Works out the highest moment in time this installation is
known to have reached. It starts from the build's own creation date (nothing can
run before the build existed), then takes the larger of that and the saved anchor,
then compares against any extra "corroborating" timestamps the caller passes in —
today, the last-opened times recorded in the recent-projects list — keeping the
biggest of all of them.

**Why it is here.** All of these timestamps were written by the app itself at a
moment it was genuinely running, so together they form a memory of time that is
hard to fake. This is what makes deleting a single file not enough to cheat: wipe
the anchor and the recent-projects list still remembers a date past the expiry.
The module note is honest that this raises the cost of the rollback trick without
fully closing it — only a signed, server-issued licence could do that.

.. CG-EXPLANATION-END id=function:observedHighWaterMs

``function evaluateBetaExpiry``
-------------------------------

.. CG-BLOCK id=function:evaluateBetaExpiry lines=175-249

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 175-249
   :lineno-match:

.. CG-EXPLANATION-START id=function:evaluateBetaExpiry

**What this does.** The heart of the file — it produces the final verdict, running
its checks in a fixed order. First: if there is no usable stamp, it returns
``unstamped`` and does not block (a dev build always opens). Otherwise it works out
the highest moment ever observed and asks, in order: is the clock now sitting more
than the ten-minute tolerance *behind* that high point? Then it is
``clock-rollback`` and blocked. Has the expiry instant passed? Then ``expired``
and blocked. Otherwise it counts the days left (rounded *up*, so a build with four
hours left says "1 day", never "0"), and returns ``warning`` if that is within a
week or ``active`` if not — neither blocks.

**Why it is here.** This is the single decision the app's startup acts on. The
order is the safety design: the clock check comes first because, once the clock is
suspect, any date arithmetic built on that same clock is untrustworthy — so the
file refuses to even reason about the expiry date until it trusts the clock. The
rounding-up of days-remaining is a small honesty rule: a build that still opens
must never report zero days left.

.. CG-EXPLANATION-END id=function:evaluateBetaExpiry

``function advanceAnchor``
--------------------------

.. CG-BLOCK id=function:advanceAnchor lines=250-258

.. literalinclude:: ../../../desktop/src/main/betaExpiry.ts
   :language: typescript
   :lines: 250-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:advanceAnchor

**What this does.** Produces the updated clock anchor to save. On a first launch
(no anchor yet, or an unusable one) it seeds both fields from the current time.
Otherwise it keeps the *earliest* first-seen time and the *latest* last-seen time
— so ``lastSeenMs`` only ever climbs, never drops.

**Why it is here.** This is the other half of the rollback defence: launching on a
backdated clock must not overwrite the app's memory with the earlier time. By
refusing to let ``lastSeenMs`` move backwards, the anchor preserves exactly the
high-water mark that ``evaluateBetaExpiry`` relies on to catch a wound-back clock.

.. CG-EXPLANATION-END id=function:advanceAnchor

