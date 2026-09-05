desktop.renderer.src.api.clients.apiCodeMessages
================================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/apiCodeMessages.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/apiCodeMessages.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the small file that turns a server refusal *code* into text in the app's own language. The comment explains it was added because the engine's English refusal text used to show verbatim inside a Dutch app; unknown codes fall through to the server's own message. It imports the language type and the two translation helpers.

**Why it is here.** This is *translate at the presentation boundary* (CLAUDE.md; Data Integrity Rule 2; ``docs/ux.md``): the engine sends a raw, machine-readable token, and the desktop owns the lookup that turns it into readable copy. The comment records that the mapping is additive — a brand-new backend code never breaks a toast, it simply stays in the server's words until a translation key is added here — which matches the additive-only API rule.

.. CG-EXPLANATION-END id=module-header

``const CODE_KEYS``
-------------------

.. CG-BLOCK id=const:CODE_KEYS lines=9-15

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 9-15
   :lineno-match:

.. CG-EXPLANATION-START id=const:CODE_KEYS

**What this does.** A small table mapping each known server code (for example ``dov_import_too_large`` or ``lock_timeout``) to a translation key the app can look up.

**Why it is here.** Listing only the codes an engineer can actually hit in normal use keeps the table small; everything else is left to fall through to the server's message.

.. CG-EXPLANATION-END id=const:CODE_KEYS

``type KnownCode``
------------------

.. CG-BLOCK id=type:KnownCode lines=16-17

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 16-17
   :lineno-match:

.. CG-EXPLANATION-START id=type:KnownCode

**What this does.** Names the type of "a code that appears as a key in the table above".

**Why it is here.** A *type* fixes the set of allowed values so the checker can prove a code is one of the handful in the table before the app runs, rather than trusting a loose string.

.. CG-EXPLANATION-END id=type:KnownCode

``function isKnownCode``
------------------------

.. CG-BLOCK id=function:isKnownCode lines=18-25

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 18-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:isKnownCode

**What this does.** A yes/no test: true when the given code is one of the keys in the table.

**Why it is here.** It is the guard that lets the lookup safely treat an arbitrary string as one of the known codes only after confirming it really is one.

.. CG-EXPLANATION-END id=function:isKnownCode

``function messageForApiCode``
------------------------------

.. CG-BLOCK id=function:messageForApiCode lines=26-34

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 26-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:messageForApiCode

**What this does.** Given a code, returns its translated message, or nothing when the code is missing or unknown; an optional language argument overrides the app's current language.

**Why it is here.** The optional language argument lets tests and previews ask for a specific language rather than whatever the app is set to. Returning nothing for an unknown code is what makes the whole mechanism fall back to the server's own text.

.. CG-EXPLANATION-END id=function:messageForApiCode

``function messageForDetail``
-----------------------------

.. CG-BLOCK id=function:messageForDetail lines=35-44

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/apiCodeMessages.ts
   :language: typescript
   :lines: 35-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:messageForDetail

**What this does.** Chooses the best message for a whole server ``detail``: if the detail is plain text, use it; if it is an object with a known code, use the translation; otherwise use the object's own ``message``; and if none of those fit, use the fallback text the caller supplied.

**Why it is here.** This is the single entry point the shared ``request`` core (on the ``desktop.renderer.src.api.clients.shared`` page) calls to build a failure message, so every refusal is shown translated when a key exists and in the server's words otherwise — the presentation-boundary rule applied in one place.

.. CG-EXPLANATION-END id=function:messageForDetail

