desktop.main.buildStamp
=======================

.. CG-PAGE source=desktop/src/main/buildStamp.ts complete=true

*Source file:* ``desktop/src/main/buildStamp.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the opening note for the file that answers "does this
build carry an expiry date, and if so what is it?". It lists the three sources in
strict order of trust. First, the date *baked into the program* when it was
built: while the app is compiled, the build tool physically replaces certain
placeholders in the code with the real date strings, so a shipped beta carries its
own expiry inside the binary and reads no settings at run time — this is the *only*
source a real shipped build uses. Second, ordinary environment variables (settings
handed to a program when it starts), honoured *only* when the app is not packaged,
so the whole expiry flow can be rehearsed and tested without cutting a real build.
Third, nothing at all — a build with no stamp simply never expires, which is what
a normal ``npm run dev`` development run gets. The note also gives the exact
command to cut a beta and the exact command to check that the date really landed.

**Why it is here.** The precedence order is the security design: if a packaged
build also honoured environment variables, defeating the expiry would be as easy
as one ``set`` command, so packaging switches that source off. The note carries
two hard-won warnings. Injection failure is *silent* — a build that lost its stamp
looks identical to one that never had one and never expires — so there is a
grep-the-bundle check to run after every beta, plus a runtime backstop that warns
if a packaged build has no stamp. And it forbids switching to the build tool's
``define`` mechanism, because the main process is built in a mode where ``define``
substitution silently does nothing and the expiry would never land (this was how
the first attempt failed, on 27 August 2026).

.. CG-EXPLANATION-END id=module-header

``const BETA_BUILD_ID_ENV_VAR``
-------------------------------

.. CG-BLOCK id=const:BETA_BUILD_ID_ENV_VAR lines=52-53

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 52-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_BUILD_ID_ENV_VAR

**What this does.** Names the environment variable that sets the build's label in
a non-packaged run: ``STRIX_BETA_BUILD_ID``.

**Why it is here.** The name is spelled out once as a constant so the read code
and any script that sets the variable refer to the exact same string.

.. CG-EXPLANATION-END id=const:BETA_BUILD_ID_ENV_VAR

``const BETA_BUILT_AT_ENV_VAR``
-------------------------------

.. CG-BLOCK id=const:BETA_BUILT_AT_ENV_VAR lines=54-55

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 54-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_BUILT_AT_ENV_VAR

**What this does.** Names the environment variable that sets the build's creation
time in a non-packaged run: ``STRIX_BETA_BUILT_AT``.

**Why it is here.** Same reason as the label variable above — one spelled-out name,
shared by the code that reads it and any script that sets it.

.. CG-EXPLANATION-END id=const:BETA_BUILT_AT_ENV_VAR

``const BETA_EXPIRES_AT_ENV_VAR``
---------------------------------

.. CG-BLOCK id=const:BETA_EXPIRES_AT_ENV_VAR lines=56-58

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 56-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_EXPIRES_AT_ENV_VAR

**What this does.** Names the environment variable that sets the build's expiry
time in a non-packaged run: ``STRIX_BETA_EXPIRES_AT``.

**Why it is here.** The third of the three matching names, kept together so the
whole set is easy to find and impossible to mistype in one place without the
mistake being obvious.

.. CG-EXPLANATION-END id=const:BETA_EXPIRES_AT_ENV_VAR

``interface RawBuildStamp``
---------------------------

.. CG-BLOCK id=interface:RawBuildStamp lines=59-68

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 59-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawBuildStamp

**What this does.** Describes the stamp in the form a build script or environment
variable produces it: three optional text fields — ``buildId`` (the label),
``builtAt`` and ``expiresAt`` (dates written as human-readable ISO-8601 text like
``2026-10-11T00:00:00.000Z``).

**Why it is here.** This is the *raw*, as-written shape, kept separate from the
tidied-up shape the expiry rules use (where the dates are plain numbers). Every
field is optional because a build might supply all, some, or none of them, and the
parsing step below decides what to make of whatever arrives.

.. CG-EXPLANATION-END id=interface:RawBuildStamp

``interface BuildStampSource``
------------------------------

.. CG-BLOCK id=interface:BuildStampSource lines=69-78

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 69-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BuildStampSource

**What this does.** Describes everything the resolver below needs to pick a
source: ``isPackaged`` (is this a shipped build?), ``env`` (the environment
settings, or a stand-in supplied by a test), and an optional ``compiled`` stamp
(the date baked in at build time).

**Why it is here.** Gathering the inputs into one described bundle is what keeps
the file a pure calculator — a test can hand it a made-up bundle (say "packaged,
with this baked-in date") and check the answer without a real build and without
touching Electron.

.. CG-EXPLANATION-END id=interface:BuildStampSource

``function instantFrom``
------------------------

.. CG-BLOCK id=function:instantFrom lines=79-101

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 79-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:instantFrom

**What this does.** Turns a written date string into a plain number of
milliseconds, or returns nothing (``null``) when the text is empty or not a
readable date.

**Why it is here.** Dates arrive as human-readable text but the expiry rules
compare plain numbers, so this is the one small converter that bridges the two.
Rejecting empty or unreadable text here means a bad date never sneaks through as a
misleading number.

.. CG-EXPLANATION-END id=function:instantFrom

``function parseBuildStamp``
----------------------------

.. CG-BLOCK id=function:parseBuildStamp lines=102-122

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 102-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseBuildStamp

**What this does.** Takes a raw, as-written stamp and turns it into the tidy shape
the expiry rules consume (dates as plain numbers). It returns nothing (``null``)
if either date is missing or unreadable, or if the expiry date does not come
after the build date. When there is no explicit label, it falls back to using the
build date as the label.

**Why it is here.** This is where a half-written or impossible stamp is quietly
rejected — treated as "no stamp" rather than as an expired build. That matches the
rule stated in ``betaExpiry.ts``: a packaging bug must never present as an expired
build and lock out a legitimate tester.

.. CG-EXPLANATION-END id=function:parseBuildStamp

``function compiledBuildStamp``
-------------------------------

.. CG-BLOCK id=function:compiledBuildStamp lines=123-137

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 123-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:compiledBuildStamp

**What this does.** Reads the three date placeholders that were baked into the
build and returns them as a raw stamp — or returns nothing (``undefined``) in a
build where those placeholders were never filled in.

**Why it is here.** This is the point where the compiled-in date is actually read.
The long comment carries a subtle but critical rule: each placeholder must be
accessed by its literal spelled-out name, never through a computed lookup — because
the build tool can only physically replace the *literal* form; a computed lookup
would silently be left as nothing, and the expiry would never land. That is also
why the file refuses to use the build tool's ``define`` mechanism, as the module
note explains.

.. CG-EXPLANATION-END id=function:compiledBuildStamp

``interface BuildProvenance``
-----------------------------

.. CG-BLOCK id=interface:BuildProvenance lines=138-161

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 138-161
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BuildProvenance

**What this does.** Describes a second, separate stamp baked into a build:
*provenance* — ``sha`` (the exact code commit the build was cut from) and
``builtAt`` (when it was built).

**Why it is here.** Provenance answers "which exact version of the code is this?".
It is unrelated to expiry — it feeds the About dialog and a one-line boot log — but
it rides in through the same baking channel, so it lives beside the expiry stamp.
A production-readiness audit on 2 September 2026 found shipped builds carried no
commit id at all; this is the fix.

.. CG-EXPLANATION-END id=interface:BuildProvenance

``function compiledBuildProvenance``
------------------------------------

.. CG-BLOCK id=function:compiledBuildProvenance lines=162-183

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 162-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:compiledBuildProvenance

**What this does.** Reads the baked-in commit id and build time and returns them —
or nothing (``undefined``) in a development run where they were never set.

**Why it is here.** It is the provenance twin of ``compiledBuildStamp`` above and
follows the same must-be-a-literal rule for the same reason. So that a botched
build cannot ship with no version stamp unnoticed, the packaging step searches the
finished bundle for the commit id and fails the build if it is missing.

.. CG-EXPLANATION-END id=function:compiledBuildProvenance

``function readBuildStamp``
---------------------------

.. CG-BLOCK id=function:readBuildStamp lines=184-196

.. literalinclude:: ../../../desktop/src/main/buildStamp.ts
   :language: typescript
   :lines: 184-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:readBuildStamp

**What this does.** Resolves the one expiry stamp to enforce, applying the
precedence order. If a baked-in stamp parses cleanly, that wins. Otherwise, if the
build is packaged, it returns nothing — a shipped build takes its date from the
binary and nowhere else. Only when the build is *not* packaged does it fall back to
reading the three environment variables.

**Why it is here.** This is the gate that makes the whole mechanism waterproof: a
shipped build can never be talked out of its expiry by an environment variable,
because that branch is only reached when the build is unpackaged. The comment
``A shipped build takes its date from the binary and nowhere else`` marks exactly
where that guarantee is enforced.

.. CG-EXPLANATION-END id=function:readBuildStamp

