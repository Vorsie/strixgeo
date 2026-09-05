desktop.main.security
=====================

.. CG-PAGE source=desktop/src/main/security.ts complete=true

*Source file:* ``desktop/src/main/security.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring introduces a set of pure security helpers for the app's main process — the part with full computer access, as opposed to the renderer, the sandboxed web page the user sees. It stresses every function here is a pure transform (given the same input it returns the same answer, touching no files, no windows, nothing outside itself) and names the two main jobs: building the Content-Security-Policy header, and deciding whether a link the page tries to open is safe to hand to the OS browser. The one code line imports two path tools, ``resolve`` and ``sep``.

**Why it is here.** Keeping the security logic here, separate from the big startup file, is what lets it be unit-tested without launching Electron — and this is code where the value lies precisely in the exhaustive tests beside it, because a mistake is a security hole. A Content-Security-Policy is a rule list a browser enforces about where a page may load code and which servers it may connect to; it is a front-line defence against cross-site-scripting (an XSS attack, where malicious script sneaks into the page and runs).

.. CG-EXPLANATION-END id=module-header

``const API_PORT``
------------------

.. CG-BLOCK id=const:API_PORT lines=28-45

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 28-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:API_PORT

**What this does.** Fixes the number 8765 — the local network port the Python engine's web server listens on. (A port is the numbered 'door' on a computer that a particular program's network traffic goes through.)

**Why it is here.** The security policy below must explicitly allow the page to talk to the engine at this address; naming the port once here keeps that allowance and the rest of the app agreeing on the same number.

.. CG-EXPLANATION-END id=const:API_PORT

``function normalizePathForCompare``
------------------------------------

.. CG-BLOCK id=function:normalizePathForCompare lines=46-84

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 46-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:normalizePathForCompare

**What this does.** Cleans a file path into one canonical form for safe comparison: it makes the path absolute (collapsing any ``.`` and ``..`` 'go up a folder' segments), strips a trailing slash, and on Windows lowercases it so the check ignores capitalisation. Anything it cannot make sense of (an empty or non-text value) comes back as nothing.

**Why it is here.** This guards an 'authorised folders' check. It deliberately resolves the ``..`` segments first, because otherwise a renderer could hand over a path that looks safe by plain text-matching but actually points somewhere else entirely — a classic path-traversal trick, where extra ``..`` segments climb out of the allowed folder. Comparing only fully-resolved paths shuts that door.

.. CG-EXPLANATION-END id=function:normalizePathForCompare

``function sanitizeSaveDialogDefault``
--------------------------------------

.. CG-BLOCK id=function:sanitizeSaveDialogDefault lines=85-119

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 85-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:sanitizeSaveDialogDefault

**What this does.** Reduces a page-supplied 'suggested file name' for the Save dialog down to a bare filename: it drops any drive letter, keeps only the part after the last slash (either slash style), and strips leftover separators and control characters. If nothing usable is left it returns nothing.

**Why it is here.** The suggested name comes from the page (a project or section name) and is therefore untrusted. A crafted name could otherwise pre-select a path outside the folder the user expects. Cutting it to a plain filename means the pre-fill is only a suggestion — the real save location is whatever the user actually picks in the dialog, and only that picked path is ever authorised to write. (A control character is an invisible, non-printing byte such as NUL that a crafted name could try to smuggle through.)

.. CG-EXPLANATION-END id=function:sanitizeSaveDialogDefault

``function buildContentSecurityPolicy``
---------------------------------------

.. CG-BLOCK id=function:buildContentSecurityPolicy lines=120-186

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 120-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildContentSecurityPolicy

**What this does.** Builds the Content-Security-Policy text the main process attaches to every page it serves. In a shipped build it is strict: scripts may come only from the app itself (plus a narrow allowance for the 3D viewer's WebAssembly), the page may connect only to the local engine and the specific mapping, DOV and elevation services actually used, images allow the map tiles, and framing, plugin objects and form targets are locked down. In development it loosens the script rule and adds the Vite live-reload connection so the developer's fast-refresh works.

**Why it is here.** This is the front-line XSS defence: even if an attacker managed to inject HTML into the page, these rules stop injected script from running and stop the page from phoning home to an attacker's server. Each relaxation is deliberate and commented — the WebAssembly allowance is needed by the 3D geo viewer and does NOT re-enable general script-eval, so the XSS protection stays intact; the same-origin frame allowance exists only so the app's own PDF sheet preview can render; and the looser dev rules are acceptable only because the dev build never reaches users.

.. CG-EXPLANATION-END id=function:buildContentSecurityPolicy

``interface ExternalOpenDecision``
----------------------------------

.. CG-BLOCK id=interface:ExternalOpenDecision lines=187-191

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 187-191
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ExternalOpenDecision

**What this does.** Describes the answer the 'should this link open externally?' check returns — a single ``external`` true/false meaning 'safe to hand to the OS browser'.

**Why it is here.** The window-open handler needs exactly this yes/no, and the note is explicit that even a 'yes' only ever means 'open in the OS browser', never 'open a new Electron window', because a renderer-opened app window would carry full app powers.

.. CG-EXPLANATION-END id=interface:ExternalOpenDecision

``function decideExternalOpen``
-------------------------------

.. CG-BLOCK id=function:decideExternalOpen lines=192-223

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 192-223
   :lineno-match:

.. CG-EXPLANATION-START id=function:decideExternalOpen

**What this does.** Decides whether a URL the page wants to open is safe to pass to the operating system's browser — it says yes only for ordinary web and email links (``http``, ``https``, ``mailto``) and no for everything else.

**Why it is here.** This is a whitelist: only known-safe schemes pass, everything else is refused by default. ``file:`` and ``javascript:`` links are rejected on purpose — handing a ``file:`` link to the OS could pop an arbitrary local file in some app, and a ``javascript:`` link is a red flag worth shutting down explicitly — so a page compromised by an attacker cannot escalate through this door.

.. CG-EXPLANATION-END id=function:decideExternalOpen

``function isInAppNavigation``
------------------------------

.. CG-BLOCK id=function:isInAppNavigation lines=224-249

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 224-249
   :lineno-match:

.. CG-EXPLANATION-START id=function:isInAppNavigation

**What this does.** Answers whether a navigation the page attempts should be allowed to proceed — allowed only when the target is the app's own page (the dev server address in development, or a location under the shipped page's folder in a packaged build); everything else is denied.

**Why it is here.** This confines the page to itself, so external links go out through the safe OS-browser path instead. A past audit finding (#15) was that the shipped build used to allow ANY ``file://`` address, so a compromised page could navigate to any local file on the computer; the check now parses and resolves the address first, so a ``..`` traversal collapses before the folder-prefix test, closing that hole.

.. CG-EXPLANATION-END id=function:isInAppNavigation

``const RECENT_PROJECT_NAME_MAX_LEN``
-------------------------------------

.. CG-BLOCK id=const:RECENT_PROJECT_NAME_MAX_LEN lines=250-250

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 250-250
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECENT_PROJECT_NAME_MAX_LEN

**What this does.** A length cap — 200 characters — on the ``name`` field of a recent-projects entry.

**Why it is here.** A corrupted or hand-edited recent-projects file could otherwise carry an enormous name and freeze the menu as it rebuilds; 200 is well above any real project name, so honest entries are never affected while a hostile one is rejected.

.. CG-EXPLANATION-END id=const:RECENT_PROJECT_NAME_MAX_LEN

``const RECENT_PROJECT_PATH_MAX_LEN``
-------------------------------------

.. CG-BLOCK id=const:RECENT_PROJECT_PATH_MAX_LEN lines=251-251

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 251-251
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECENT_PROJECT_PATH_MAX_LEN

**What this does.** A length cap — 1024 characters — on the ``path`` field of a recent-projects entry.

**Why it is here.** The same defence as the name cap, sized well above any plausible Windows file path so a real path always fits but a bloated one is refused.

.. CG-EXPLANATION-END id=const:RECENT_PROJECT_PATH_MAX_LEN

``const RECENT_PROJECT_ISO_MAX_LEN``
------------------------------------

.. CG-BLOCK id=const:RECENT_PROJECT_ISO_MAX_LEN lines=252-275

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 252-275
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECENT_PROJECT_ISO_MAX_LEN

**What this does.** A length cap — 64 characters — on the ``lastOpened`` timestamp field of a recent-projects entry.

**Why it is here.** The same defence again, sized comfortably above a normal date-and-time string so a genuine timestamp fits and an oversized value cannot get through.

.. CG-EXPLANATION-END id=const:RECENT_PROJECT_ISO_MAX_LEN

``function rawBackendLogAffordanceEnabled``
-------------------------------------------

.. CG-BLOCK id=function:rawBackendLogAffordanceEnabled lines=276-287

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 276-287
   :lineno-match:

.. CG-EXPLANATION-START id=function:rawBackendLogAffordanceEnabled

**What this does.** Decides whether the 'Show log file…' menu item — which opens the raw, un-redacted ``backend.log`` in the file browser — should exist. It returns yes only in a development build.

**Why it is here.** The raw ``backend.log`` is the engine's own output and carries secrets: the database connection string (a DSN — the address, name and password the app uses to reach its database) and real file paths. The proper support path redacts a copy line by line — blacks out the secret parts — before it can leave the machine; this raw shortcut does not. Offering the raw file to a customer would invite them to send exactly the un-redacted secrets the redaction exists to strip, so only a developer (on their own machine) keeps it.

.. CG-EXPLANATION-END id=function:rawBackendLogAffordanceEnabled

``function isValidRecentProjectEntry``
--------------------------------------

.. CG-BLOCK id=function:isValidRecentProjectEntry lines=288-300

.. literalinclude:: ../../../desktop/src/main/security.ts
   :language: typescript
   :lines: 288-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:isValidRecentProjectEntry

**What this does.** Checks one entry from the recent-projects file and returns whether it is safe to keep: it must be an object with a non-empty text ``path``, a text ``name`` and a text ``lastOpened``, each within its length cap.

**Why it is here.** Beyond confirming the shape is right, enforcing the length caps here is what stops a corrupted file from blowing up the menu render; the caller uses this to filter out bad entries rather than trusting the file wholesale.

.. CG-EXPLANATION-END id=function:isValidRecentProjectEntry

