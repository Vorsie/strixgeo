desktop.main.buildStampGlobals.d
================================

.. CG-PAGE source=desktop/src/main/buildStampGlobals.d.ts complete=true

*Source file:* ``desktop/src/main/buildStampGlobals.d.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/main/buildStampGlobals.d.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file (the ``.d.ts`` ending marks it as a *declarations*
file — it describes shapes for the type-checker but contains no running code) is a
note to TypeScript listing the build-time settings the main program is allowed to
read. Its opening comment explains that the build tool exposes any environment
variable whose name starts with ``MAIN_VITE_`` to the main process, physically
replacing each spelled-out ``import.meta.env.MAIN_VITE_X`` in the code with the
value that was present when the build ran. That is the exact mechanism the beta
expiry stamp rides on, described in ``buildStamp.ts``.

**Why it is here.** Without this declarations file the type-checker would complain
that these settings are unknown. The comment also preserves the hard-won warning:
do not switch to the build tool's ``define`` feature, because the main process is
built in a mode (server-side-rendering) where ``define`` substitution silently
does nothing — the config is accepted, the output is unchanged, and the expiry
stamp never lands. This was proven on 27 August 2026 by building with the
variables set and searching the output for the date.

.. CG-EXPLANATION-END id=module-header

``interface ImportMetaEnv``
---------------------------

.. CG-BLOCK id=interface:ImportMetaEnv lines=18-30

.. literalinclude:: ../../../desktop/src/main/buildStampGlobals.d.ts
   :language: typescript
   :lines: 18-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ImportMetaEnv

**What this does.** Lists the five build-time settings by name and says each is an
optional piece of text: the three beta-expiry values (build label, build time,
expiry time) and the two provenance values (the commit id and build time). Marking
them ``readonly`` says the code may read them but never change them.

**Why it is here.** This is the actual list the type-checker consults, so a typo
like ``MAIN_VITE_STRIX_BETA_EXPIRE`` is caught at compile time instead of silently
reading as nothing. Each is optional because a development build sets none of them.

.. CG-EXPLANATION-END id=interface:ImportMetaEnv

``interface ImportMeta``
------------------------

.. CG-BLOCK id=interface:ImportMeta lines=31-33

.. literalinclude:: ../../../desktop/src/main/buildStampGlobals.d.ts
   :language: typescript
   :lines: 31-33
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ImportMeta

**What this does.** Attaches the list above onto ``import.meta`` — the standard
built-in object where a module finds facts about itself — by saying its ``env``
member has exactly the shape described above.

**Why it is here.** This is the wiring that lets the code write
``import.meta.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT`` and have the type-checker know
it is a valid, spelled-out setting. It completes the declaration so the real code
in ``buildStamp.ts`` type-checks cleanly.

.. CG-EXPLANATION-END id=interface:ImportMeta

