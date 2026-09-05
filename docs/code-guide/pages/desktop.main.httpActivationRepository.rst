desktop.main.httpActivationRepository
=====================================

.. CG-PAGE source=desktop/src/main/httpActivationRepository.ts complete=true

*Source file:* ``desktop/src/main/httpActivationRepository.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment written for whoever reads the code) followed by the list of other files it borrows from (the *imports*). The note explains that this file is the real, production version of the *activation issuer* — the piece that talks over the internet to the strixgeo.com licence server to turn a pasted licence key into a licence. This whole file lives in Electron's *main process* — the part of the desktop app that has full computer access (files, network, launching other programs), as opposed to the *renderer*, the sandboxed web page the engineer actually sees. It talks to the server using *HTTP*: a request is a message sent to a web address and a response is the message that comes back, each carrying a *status code* (a three-digit number where roughly 200 means success and 400/500 numbers mean various failures) and a body of *JSON* (a plain-text way of writing structured data). The note lists what the file does and does not do: it handles only ``activate`` / ``startTrial`` / ``deactivate``; it times every request out; it turns the server's coded errors into the app's own small set of reasons; and it treats any network trouble, timeout, or unreadable reply as the single outcome ``unreachable``. It never writes a full licence key into a log — only the last four characters.

**Why it is here.** The owner's rule was to build activation against a *thin seam* — a fixed list of functions with more than one implementation behind it — so the choice of server engine (ruled to be a MySQL database) could stay hidden; this file knows only "JSON over a secure web connection", and nothing about the database leaks in. Collapsing every network failure to ``unreachable`` is the deliberate design that makes the offline promise work: when the server cannot be reached, the app keeps running on the licence already saved on the disk for its thirty-day grace period (owner ruling 14) rather than locking an engineer out on site. Never logging a key in full protects a secret credential.

.. CG-EXPLANATION-END id=module-header

``const DAY_MS``
----------------

.. CG-BLOCK id=const:DAY_MS lines=44-47

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 44-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:DAY_MS

**What this does.** Defines one fixed number, ``DAY_MS`` — the count of milliseconds in a day (24 hours times 60 minutes times 60 seconds times 1000). Computers measure time in milliseconds; the server sends the grace window as a whole number of days.

**Why it is here.** The server sends grace as a count of days, but the rest of the app keeps time windows in milliseconds, so the day-to-milliseconds conversion is written once, in one named place, rather than retyped as a mystery number each time it is needed.

.. CG-EXPLANATION-END id=const:DAY_MS

``const DEFAULT_TIMEOUT_MS``
----------------------------

.. CG-BLOCK id=const:DEFAULT_TIMEOUT_MS lines=48-60

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 48-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_TIMEOUT_MS

**What this does.** Sets ``DEFAULT_TIMEOUT_MS`` to ten thousand milliseconds (ten seconds) — how long a single request to the server is allowed to take before the app gives up on it.

**Why it is here.** Ten seconds is long enough to tolerate a genuinely slow internet link, but short enough that a dead or unresponsive server does not leave the engineer staring at a frozen "activating…" screen. When the timeout fires the request is treated as ``unreachable``, and the app falls back to the licence already stored on disk.

.. CG-EXPLANATION-END id=const:DEFAULT_TIMEOUT_MS

``const WIRE_ERROR_TO_CODE``
----------------------------

.. CG-BLOCK id=const:WIRE_ERROR_TO_CODE lines=61-68

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 61-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:WIRE_ERROR_TO_CODE

**What this does.** A small lookup table that translates the error names the server sends over the wire into the app's own short list of reasons. ``key_unknown`` becomes ``unknown_key``; both ``key_bound_elsewhere`` and ``seat_exhausted`` become the single reason ``device_limit``; ``trial_already_used`` becomes ``already_trialled``. Anything not in this table — an unrecognised name, a server crash, a network failure — is turned into ``unreachable`` elsewhere.

**Why it is here.** The server distinguishes "this key is tied to another computer" from "every seat on a multi-seat key is taken", but the engineer sees one and the same message either way ("deactivate a device to transfer"), so the two are deliberately folded into one reason. Mapping every unknown or server-side failure to ``unreachable`` is the conservative choice: rather than trusting a reply it does not understand or wiping a good licence, the app keeps running on what it already has.

.. CG-EXPLANATION-END id=const:WIRE_ERROR_TO_CODE

``interface HttpActivationRepositoryConfig``
--------------------------------------------

.. CG-BLOCK id=interface:HttpActivationRepositoryConfig lines=69-99

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 69-99
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HttpActivationRepositoryConfig

**What this does.** Describes the shape of the settings this file needs to be handed when it is created. An *interface* is simply a written description of the fields a value must carry. The required field is ``baseUrl`` (the web address of the activation service, with no trailing slash). The optional fields are ``appVersion`` (this build's version number, sent so the server can tell clients apart), ``fetchImpl`` (the web-request function to use — normally the computer's built-in one, but a fake one can be swapped in during testing), ``timeoutMs`` (how long each request may take), and ``onDebug`` (a place to send debug lines, which only ever receives a masked key).

**Why it is here.** Gathering every adjustable setting into one clearly-described bundle keeps the file's behaviour explicit and, crucially, testable: because the web-request function and the clock-like timeout are passed in rather than hard-wired, the automated tests can feed the file a fake server and check every branch without touching the real internet. The note that ``onDebug`` only ever receives a masked key repeats the file's rule that a full key never reaches a log.

.. CG-EXPLANATION-END id=interface:HttpActivationRepositoryConfig

``function maskLicenceKey``
---------------------------

.. CG-BLOCK id=function:maskLicenceKey lines=100-106

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 100-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:maskLicenceKey

**What this does.** A tiny helper that hides a licence key for safe logging. It trims spaces, and for a key longer than four characters returns four bullet dots followed by the last four characters (so a key ending ``ABCD`` shows as ``••••ABCD``); a key of four or fewer characters shows as just ``••••``.

**Why it is here.** A licence key is a secret credential, so a log line must never carry it in full. Keeping the last four characters is enough for a person to tell two keys apart when matching up a support report, while revealing nothing an attacker could use.

.. CG-EXPLANATION-END id=function:maskLicenceKey

``type Transport``
------------------

.. CG-BLOCK id=type:Transport lines=107-109

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 107-109
   :lineno-match:

.. CG-EXPLANATION-START id=type:Transport

**What this does.** Gives a short local nickname, ``Transport``, for the result of one finished web round-trip (the ``HttpPostResult`` shape defined in the shared ``httpPostJson.ts`` helper). That result is either "a reply came back, here is its status code and body" or "no answer came back at all".

**Why it is here.** The word "transport" reads more naturally than the imported type name at the places below where the file inspects what came back from the server, and naming it once means the shape is written in a single place.

.. CG-EXPLANATION-END id=type:Transport

``function isObject``
---------------------

.. CG-BLOCK id=function:isObject lines=110-114

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 110-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:isObject

**What this does.** A yes/no helper that answers "is this value a plain JSON object?" — that is, a bundle of named fields, and specifically not a list and not the empty value ``null``.

**Why it is here.** The bodies that come back from the server are untrusted text that has been parsed into some value; before reading fields off that value the file must first confirm it really is an object with fields, so a malformed or hostile reply cannot crash the code that inspects it.

.. CG-EXPLANATION-END id=function:isObject

``function isFiniteNumber``
---------------------------

.. CG-BLOCK id=function:isFiniteNumber lines=115-119

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 115-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:isFiniteNumber

**What this does.** A yes/no helper that answers "is this value a real, finite number?" — rejecting things that are not numbers at all, and rejecting the special "not-a-number" and "infinity" values.

**Why it is here.** The timestamps in a licence (when it was issued, when it expires) arrive as untrusted values from the network. Confirming each is a usable finite number before doing any date arithmetic on it stops a garbage value from producing a nonsensical licence.

.. CG-EXPLANATION-END id=function:isFiniteNumber

``class HttpActivationRepository``
----------------------------------

.. CG-BLOCK id=class:HttpActivationRepository lines=120-263

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 120-263
   :lineno-match:

.. CG-EXPLANATION-START id=class:HttpActivationRepository

**What this does.** The main body of the file — the object that actually performs activation over the network. A *class* is a template that bundles data together with the functions that act on it. When created it is handed the settings bundle, strips any trailing slash off the base address, and remembers the web-request function and timeout. It offers four *async* methods (an ``async`` function is one that can pause and hand back a *promise* — a value that arrives later — while other work runs): ``activate`` (send a key plus the device asking, get a licence back), ``startTrial`` (ask for a free time-limited trial licence for this device), ``refresh`` (silently re-check a still-bound device and get a licence with a fresh expiry date), and ``deactivate`` (release this device's seat so the licence can move to another machine). Underneath, two private helpers do the shared work: ``send`` joins the path onto the base address and does one timed POST that never crashes, and ``issue`` takes what came back and shapes it into the app's success-or-failure answer.

**Why it is here.** This is the one place the app reaches the licence server, so every network subtlety is handled here and nowhere else. Activate, start-trial and refresh all funnel through the same ``issue`` helper so the "success means a valid licence, anything else means a mapped reason or ``unreachable``" rule is written once. ``deactivate`` is the odd one out: because it has no way to hand back a reason code, a failure is *thrown* as a typed error carrying the HTTP status, which lets the layer above tell an "already released" (404) apart from a "keep the seat, do not strand it" failure — an offline deactivate must never half-transfer a seat. A licence key is only ever logged through the masking helper.

.. CG-EXPLANATION-END id=class:HttpActivationRepository

``function mapWireError``
-------------------------

.. CG-BLOCK id=function:mapWireError lines=264-278

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 264-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:mapWireError

**What this does.** Takes the error body the server sent and returns one of the app's short reasons. It looks for the expected shape — an ``error`` object holding a text ``code`` — and, if that code is in the lookup table, returns the matching reason; for anything it does not recognise it returns ``unreachable``.

**Why it is here.** The server's error names are its own vocabulary; the renderer shows the engineer a translated message chosen by the app's short reason, not by the server's raw text. Defaulting an unrecognised or missing error to ``unreachable`` keeps the conservative rule: an answer the app cannot understand is treated as "could not reach the server", so the stored licence is neither trusted-away nor destroyed.

.. CG-EXPLANATION-END id=function:mapWireError

``function failureMessage``
---------------------------

.. CG-BLOCK id=function:failureMessage lines=279-306

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 279-306
   :lineno-match:

.. CG-EXPLANATION-START id=function:failureMessage

**What this does.** Builds a short, key-free line describing a refused request — literally "activation request refused" followed by the HTTP status number.

**Why it is here.** This string is only a fallback and a log line — the engineer normally sees a translated message chosen by the reason code, not this text. It is deliberately built from the status number alone and never repeats the server's own message text, because that text could contain the licence key, which must never reach a log.

.. CG-EXPLANATION-END id=function:failureMessage

``function parseWireLicence``
-----------------------------

.. CG-BLOCK id=function:parseWireLicence lines=307-333

.. literalinclude:: ../../../desktop/src/main/httpActivationRepository.ts
   :language: typescript
   :lines: 307-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseWireLicence

**What this does.** Checks a licence the server sent and, only if every field is valid, converts it into the app's internal licence shape. It confirms the body contains a ``licence`` object; that its key is text; that its tier is one of the three real tiers (solo / pro / studio) and not some made-up value; that the trial flag is a true/false; and that the issued, expiry and grace-days values are all real finite numbers. It fills in the device id and label from the requesting device if the server left them out, and converts the grace window from the whole days the server sends into the milliseconds the app uses. If anything is missing or malformed it returns ``null``.

**Why it is here.** The licence is the most trusted thing the app takes from the network, so it is validated exhaustively before it is believed: a tier the app does not recognise, or a non-numeric date, could otherwise mint a bogus seat or corrupt the date logic. Returning ``null`` on any problem lets the caller treat a garbled licence as ``unreachable`` — fall back to the stored licence — rather than trust it. The extra ``seatId`` the contract carries is checked-if-present but not stored, because the internal licence has no place for it.

.. CG-EXPLANATION-END id=function:parseWireLicence

