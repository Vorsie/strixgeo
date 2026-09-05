desktop.main.bootFailureMessage
===============================

.. CG-PAGE source=desktop/src/main/bootFailureMessage.ts complete=true

*Source file:* ``desktop/src/main/bootFailureMessage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/main/bootFailureMessage.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains this small, pure file turns one recognisable start-up failure into a clear message that names the actual cause instead of a generic error. The specific case: an older StrixGeo trying to open a database that a NEWER StrixGeo already wrote. The note describes how that case is spotted — the database-upgrade step fails with a 'can't locate revision' complaint — and is honest that this is a best-guess reading of the tool's own wording, not yet a proper machine-readable signal.

**Why it is here.** Without this, that failure shows the generic 'StrixGeo could not prepare the database' line, which reads like the data is corrupt. It is not — the data is intact and the fix is simply to install the current version. The database-upgrade step is a migration (bringing an existing database up to the shape the current app expects); a revision is a labelled point in that upgrade history, and 'can't locate revision' means the database is stamped at a point this older build has never heard of. Because the wrong message would frighten a user into thinking they had lost their work, this file exists to substitute reassuring, actionable wording, and is kept pure and separate from the big startup file so it can be tested on its own.

.. CG-EXPLANATION-END id=module-header

``interface BootFailureDialogCopy``
-----------------------------------

.. CG-BLOCK id=interface:BootFailureDialogCopy lines=24-33

.. literalinclude:: ../../../desktop/src/main/bootFailureMessage.ts
   :language: typescript
   :lines: 24-33
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BootFailureDialogCopy

**What this does.** Describes the two-part text of an error dialog: a ``title`` and a ``detail`` body. (A dialog is the small pop-up box the app shows to tell the user something.)

**Why it is here.** The native error-box call the startup code uses wants exactly a title and a detail, so bundling them in one named shape lets this file hand back a ready-to-show message.

.. CG-EXPLANATION-END id=interface:BootFailureDialogCopy

``const NEWER_DATABASE_SIGNAL``
-------------------------------

.. CG-BLOCK id=const:NEWER_DATABASE_SIGNAL lines=34-49

.. literalinclude:: ../../../desktop/src/main/bootFailureMessage.ts
   :language: typescript
   :lines: 34-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:NEWER_DATABASE_SIGNAL

**What this does.** A text-matching pattern that recognises the database tool's 'can't locate revision' complaint, allowing for the small spelling and capitalisation variations seen in real logs.

**Why it is here.** That exact complaint appears only when the database is stamped at an upgrade point this build has never heard of — which is precisely the fingerprint of a database written by a newer StrixGeo. Matching on it is how the file tells this one recoverable failure apart from every other start-up error.

.. CG-EXPLANATION-END id=const:NEWER_DATABASE_SIGNAL

``function tailoredBootFailureCopy``
------------------------------------

.. CG-BLOCK id=function:tailoredBootFailureCopy lines=50-64

.. literalinclude:: ../../../desktop/src/main/bootFailureMessage.ts
   :language: typescript
   :lines: 50-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:tailoredBootFailureCopy

**What this does.** Takes the failed stage and its raw error message and, if they match the 'newer database' fingerprint, returns the reassuring title-and-detail dialog copy; for anything else it returns nothing, meaning 'use the generic message'.

**Why it is here.** This is the single decision point. It rewrites only the one failure a user can actually act on — telling them plainly their data is safe and to install the current version — and deliberately leaves every other failure to the default wording rather than guessing at causes it cannot recognise.

.. CG-EXPLANATION-END id=function:tailoredBootFailureCopy

