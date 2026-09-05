desktop.main.mockActivationRepository
=====================================

.. CG-PAGE source=desktop/src/main/mockActivationRepository.ts complete=true

*Source file:* ``desktop/src/main/mockActivationRepository.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code) and the list of other files it borrows from. The note explains that this file is a *mock* — a pretend, in-memory stand-in — for the strixgeo.com licence server. It lets the whole activation flow run with no internet and no real server behind it. It lives in Electron's *main process* (the part of the desktop app with full computer access, as opposed to the sandboxed web page the engineer sees). It is deliberately "behavioural, not cryptographic": it checks pasted keys against a fixed little table of demo keys, enforces the per-tier rule about how many devices a key may run on, and hands out plain (unsigned) licences. A section of the note lists, point by point, exactly what the real strixgeo.com server will replace: real network calls, a check against the Stripe payment subscription, a genuinely signed licence file, and a database lookup instead of the demo-key table.

**Why it is here.** This is the prototype's engine of activation so the owner could click through every licensing screen — enter a key, start a trial, hit the device limit, deactivate — long before any server existed, and while dogfeeding day to day with no network. Keeping the demo keys and the seat rules in memory is enough for a reaction prototype: it makes the rules observable within one run of the app. It stores nothing on its own across restarts; the licence that actually persists lives in a separate local-authority file (``activationStore.ts``).

.. CG-EXPLANATION-END id=module-header

``const SOLO_DEMO_KEY``
-----------------------

.. CG-BLOCK id=const:SOLO_DEMO_KEY lines=40-40

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 40-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:SOLO_DEMO_KEY

**What this does.** Defines the text ``STRIX-SOLO-DEMO`` under the name ``SOLO_DEMO_KEY`` — the pretend licence key that stands for the Solo tier in the prototype.

**Why it is here.** A fixed, memorable demo key the owner can paste into the licensing screen to see the Solo tier's screens without a real key or server. Naming it once means the same value is used both in the demo-key table below and anywhere a test needs it.

.. CG-EXPLANATION-END id=const:SOLO_DEMO_KEY

``const PRO_DEMO_KEY``
----------------------

.. CG-BLOCK id=const:PRO_DEMO_KEY lines=41-41

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 41-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:PRO_DEMO_KEY

**What this does.** Defines the text ``STRIX-PRO-DEMO`` under the name ``PRO_DEMO_KEY`` — the pretend licence key that stands for the Pro tier.

**Why it is here.** The Pro-tier counterpart of the Solo demo key, so the owner can paste it in to preview the Pro tier's behaviour (including its two-device limit) with no real key or server.

.. CG-EXPLANATION-END id=const:PRO_DEMO_KEY

``const STUDIO_DEMO_KEY``
-------------------------

.. CG-BLOCK id=const:STUDIO_DEMO_KEY lines=42-44

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:STUDIO_DEMO_KEY

**What this does.** Defines the text ``STRIX-STUDIO-DEMO`` under the name ``STUDIO_DEMO_KEY`` — the pretend licence key that stands for the Studio tier.

**Why it is here.** The Studio-tier counterpart of the other two demo keys, completing the set the owner can use to preview each tier's screens without a real key or server.

.. CG-EXPLANATION-END id=const:STUDIO_DEMO_KEY

``const DEMO_KEYS``
-------------------

.. CG-BLOCK id=const:DEMO_KEYS lines=45-51

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 45-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEMO_KEYS

**What this does.** A small lookup table that maps each of the three demo keys to its tier: ``STRIX-SOLO-DEMO`` to solo, ``STRIX-PRO-DEMO`` to pro, ``STRIX-STUDIO-DEMO`` to studio.

**Why it is here.** This is the mock's whole notion of "which keys are valid and what does each grant" — the single place a pasted key is recognised. The real service replaces exactly this table with a lookup in the strixgeo.com database, which is why the seam around it does not change when the server is built.

.. CG-EXPLANATION-END id=const:DEMO_KEYS

``const PAID_TERM_MS``
----------------------

.. CG-BLOCK id=const:PAID_TERM_MS lines=52-52

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:PAID_TERM_MS

**What this does.** Defines ``PAID_TERM_MS`` as one year expressed in milliseconds (365 days times 24 hours times 60 minutes times 60 seconds times 1000) — how long a paid demo licence lasts.

**Why it is here.** A prototype stand-in for a paid annual subscription's length, so a minted demo licence has a realistic far-off expiry date. The real server sets the true expiry from the actual subscription.

.. CG-EXPLANATION-END id=const:PAID_TERM_MS

``const TRIAL_TERM_MS``
-----------------------

.. CG-BLOCK id=const:TRIAL_TERM_MS lines=53-55

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRIAL_TERM_MS

**What this does.** Defines ``TRIAL_TERM_MS`` as thirty days expressed in milliseconds — how long a free trial licence lasts.

**Why it is here.** A prototype stand-in for the trial length, so a minted trial licence expires a month out. The real server issues the trial on the same path (owner ruling 16) with its own thirty-day term.

.. CG-EXPLANATION-END id=const:TRIAL_TERM_MS

``type NowFn``
--------------

.. CG-BLOCK id=type:NowFn lines=56-64

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 56-64
   :lineno-match:

.. CG-EXPLANATION-START id=type:NowFn

**What this does.** Defines a *type* named ``NowFn`` — a note to the rest of the code that a value must be "a function that returns the current time as a number of milliseconds". A *function* here is just a piece of code you can call to get a value.

**Why it is here.** So the clock can be handed in rather than hard-wired. In the running app it defaults to the computer's real clock, but the automated tests pass in a fixed clock so that a minted licence's issue and expiry dates come out the same every run and can be checked exactly — the same pattern the recovery store uses.

.. CG-EXPLANATION-END id=type:NowFn

``class MockActivationRepository``
----------------------------------

.. CG-BLOCK id=class:MockActivationRepository lines=65-144

.. literalinclude:: ../../../desktop/src/main/mockActivationRepository.ts
   :language: typescript
   :lines: 65-144
   :lineno-match:

.. CG-EXPLANATION-START id=class:MockActivationRepository

**What this does.** The main body of the file — the pretend server itself. A *class* is a template bundling data with the functions that act on it. It keeps two records in memory: which device ids are currently bound to each key, and which devices have already used up their one free trial. It offers three methods: ``activate`` looks the pasted key up in the demo table (rejecting an unknown key), and — unless this exact device is already bound (which counts as a refresh, not a new seat) — refuses if the key has hit its per-tier device cap, otherwise binds the device and mints a paid licence; ``startTrial`` refuses a device that has already trialled, otherwise records it and mints a thirty-day trial licence; ``deactivate`` frees this device from every key it was bound to. A private ``mintLicence`` helper builds each licence, stamping the issue time from the clock and the expiry from the term.

**Why it is here.** This makes the two rules the owner cares about visible without a server: the one-device-per-Solo-seat binding (ruling 15) and one-trial-per-device. Re-activating the same device is treated as a refresh so an honest re-launch never consumes a second seat. When a key or trial is refused, the entered key is deliberately never echoed back in the message — it is untrusted input that can end up in logs, and the renderer picks its wording from the reason code, not from this text. The whole class is the exact behaviour the real server will provide, plus the signing the client will only verify rather than mint.

.. CG-EXPLANATION-END id=class:MockActivationRepository

