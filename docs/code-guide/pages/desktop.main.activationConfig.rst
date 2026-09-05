desktop.main.activationConfig
=============================

.. CG-PAGE source=desktop/src/main/activationConfig.ts complete=true

*Source file:* ``desktop/src/main/activationConfig.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports the pieces it chooses between.
This main-process file (the main process is the full-power part of an Electron
app, with file and network access, as opposed to the sandboxed web page the user
sees) is the single place that decides *which* activation issuer the app will
talk to. An "issuer" is whatever hands out and checks licences; there are three
to pick from — a mock one that lives entirely in memory with no network, the
real one that talks to the strixgeo.com server over the web, and an
"unreachable" one that always refuses. It imports all three plus the shared
shape they all follow.

**Why it is here.** Having one config point means the choice — mock, real, or
refuse — is made in exactly one spot from one input, a base web address, rather
than being scattered across the code. The docstring explains the rule: a
development build reads the address from an environment setting (so a developer
can point it at a local test server), a shipped build uses a fixed compiled-in
address, and if neither gives an address the app falls back sensibly. The whole
question of what database the server uses — which the owner deliberately
deferred — hides behind that address; this file only ever knows "an address, or
none".

.. CG-EXPLANATION-END id=module-header

``const ACTIVATION_URL_ENV``
----------------------------

.. CG-BLOCK id=const:ACTIVATION_URL_ENV lines=30-40

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 30-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:ACTIVATION_URL_ENV

**What this does.** Holds the name of the environment setting —
``STRIXGEO_ACTIVATION_URL`` — that a development build reads to find the
activation server's address. (An environment setting is a value handed to a
program from outside when it starts.)

**Why it is here.** Naming it once, in a place other files can import, means a
developer can point the app at a local test server without editing code, and
there is a single source of truth for the setting's exact spelling.

.. CG-EXPLANATION-END id=const:ACTIVATION_URL_ENV

``const PACKAGED_ACTIVATION_URL``
---------------------------------

.. CG-BLOCK id=const:PACKAGED_ACTIVATION_URL lines=41-43

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 41-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:PACKAGED_ACTIVATION_URL

**What this does.** The activation server address a shipped (packaged) build
uses: the ``api/activation`` path on strixgeo.com, reached over encrypted
``https``.

**Why it is here.** A shipped build ignores the development environment setting
entirely and talks only to this one address. The docstring records that the
strixgeo.com service went live on 3 September 2026. If this were ever ``null``,
a packaged build would be sent to the "unreachable" issuer — so it simply could
not activate — and never to the in-memory mock, whose demo keys are public and
would otherwise let anyone in.

.. CG-EXPLANATION-END id=const:PACKAGED_ACTIVATION_URL

``interface ActivationConfigInputs``
------------------------------------

.. CG-BLOCK id=interface:ActivationConfigInputs lines=44-63

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 44-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationConfigInputs

**What this does.** Describes the two facts the address choice depends on: the
environment settings to read, and whether this is a packaged build.

**Why it is here.** Passing these two facts in — rather than reading them from
global state inside the functions — keeps the choosing functions below simple
and testable: a test can hand them a made-up environment and packaged flag and
check the result on any machine.

.. CG-EXPLANATION-END id=interface:ActivationConfigInputs

``function normalizeBaseUrl``
-----------------------------

.. CG-BLOCK id=function:normalizeBaseUrl lines=64-70

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 64-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:normalizeBaseUrl

**What this does.** Tidies up a candidate address: trims surrounding spaces,
strips any trailing slashes, and turns an empty result into ``null`` (nothing).

**Why it is here.** Addresses arrive from humans and settings files with stray
spaces or a trailing slash; cleaning them to one canonical form up front means
the checks and requests that follow never have to worry about those variations,
and a blank value reliably becomes "no address".

.. CG-EXPLANATION-END id=function:normalizeBaseUrl

``function isLoopbackHttp``
---------------------------

.. CG-BLOCK id=function:isLoopbackHttp lines=71-97

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 71-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:isLoopbackHttp

**What this does.** A yes/no test: is this address a plain ``http://`` link to
this same computer — ``127.0.0.1`` or ``localhost``, with any port number? The
long comment that follows it is the instruction manual for the next function.

**Why it is here.** "Loopback" means the address points back at the machine it
is running on, so nothing travels over a real network. This test marks the one
safe exception to the "must be encrypted https" rule below: a developer's local
test server on the same computer.

.. CG-EXPLANATION-END id=function:isLoopbackHttp

``function sanitizeIssuerUrl``
------------------------------

.. CG-BLOCK id=function:sanitizeIssuerUrl lines=98-119

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 98-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:sanitizeIssuerUrl

**What this does.** Cleans up a candidate address and then refuses it unless its
scheme is safe. Anything starting with ``https://`` (encrypted) is allowed. A
plain ``http://`` address is allowed only in a development build and only when
it points back at this same computer (loopback). Everything else becomes
``null`` — no issuer.

**Why it is here.** The licence key is a credential that travels inside the
request, so the address it travels to must be encrypted ``https://``, or the key
could be read in transit. The one carefully-drawn exception is a developer's
local test server, which never leaves the machine. A packaged build allows no
plain ``http://`` at all. This is a security-critical check: it is what
guarantees a key is never sent to an unprotected address.

.. CG-EXPLANATION-END id=function:sanitizeIssuerUrl

``function activationBaseUrl``
------------------------------

.. CG-BLOCK id=function:activationBaseUrl lines=120-128

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 120-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:activationBaseUrl

**What this does.** Produces the final activation address for this build, or
``null`` to mean "use the in-memory mock". A packaged build reads only the
compiled-in constant; a development build reads only the environment setting;
either way the result is passed through the security check above.

**Why it is here.** It ties the two paths together in one function so the rule
is unambiguous: a shipped build can never accidentally read a developer's
setting, and a credential can never travel to an insecure address because both
paths go through the same guard.

.. CG-EXPLANATION-END id=function:activationBaseUrl

``interface ActivationRepositoryInputs``
----------------------------------------

.. CG-BLOCK id=interface:ActivationRepositoryInputs lines=129-150

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 129-150
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationRepositoryInputs

**What this does.** The inputs for building the issuer: everything
``ActivationConfigInputs`` carries, plus the app's version string, which the
real network issuer includes when it activates or starts a trial. The comment
below it is the manual for the next function.

**Why it is here.** The version number is useful to the server (it can tell
which build a customer is running), but only the network issuer needs it, so it
is optional. Building on the smaller input shape rather than repeating its
fields keeps the two in step.

.. CG-EXPLANATION-END id=interface:ActivationRepositoryInputs

``function createActivationRepository``
---------------------------------------

.. CG-BLOCK id=function:createActivationRepository lines=151-161

.. literalinclude:: ../../../desktop/src/main/activationConfig.ts
   :language: typescript
   :lines: 151-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:createActivationRepository

**What this does.** Builds the actual issuer object the rest of the app will
use. If an address is configured it returns the real network issuer pointed at
that address; a *development* build with no address gets the in-memory mock (so
the owner's daily work is unchanged); a *packaged* build with no address gets
the "unreachable" issuer that always refuses.

**Why it is here.** This is the safety rule spelled out: a packaged build must
never fall back to the mock, because the mock accepts the public
``STRIX-*-DEMO`` demo keys — a shipped build "activating" on a key anyone can
read would be worthless. The comment restates the owner's beta rule: a beta
build runs on its build stamp, not on a licence, and a non-beta shipped build
simply cannot activate until the real server address is compiled in.

.. CG-EXPLANATION-END id=function:createActivationRepository

