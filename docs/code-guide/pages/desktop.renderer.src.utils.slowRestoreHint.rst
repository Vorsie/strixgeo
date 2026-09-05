desktop.renderer.src.utils.slowRestoreHint
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/slowRestoreHint.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/slowRestoreHint.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/slowRestoreHint.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file provides a way to tell the engineer why a project restore might appear to be sitting still. The comment explains the cause: a restore takes the body-partition lock before its first write, and a running body recompute can hold that lock for up to the backend's 30-second timeout, so from the window a lock wait looks exactly like a slow file parse — the open dialog just sits there.

**Why it is here.** The comment cites the owner ruling of 2026-09-04 ("yeah just add a small toast"): keep waiting rather than failing, but after a short moment say so; a restore that settles before the delay says nothing at all.

.. CG-EXPLANATION-END id=module-header

``const RESTORE_LOCK_HINT_MS``
------------------------------

.. CG-BLOCK id=const:RESTORE_LOCK_HINT_MS lines=13-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/slowRestoreHint.ts
   :language: typescript
   :lines: 13-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:RESTORE_LOCK_HINT_MS

**What this does.** Sets the delay — 2 seconds — that a restore may run silently before the hint fires, and then documents the function below: await the work, and call the "it is slow" callback once if the work is still pending after that delay.

**Why it is here.** Naming the delay once keeps the value in a single place shared by the default and any caller; the docstring records that the timer is cleared however the work settles, so a fast restore or a fast failure never fires the hint.

.. CG-EXPLANATION-END id=const:RESTORE_LOCK_HINT_MS

``function withSlowRestoreHint``
--------------------------------

.. CG-BLOCK id=function:withSlowRestoreHint lines=21-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/slowRestoreHint.ts
   :language: typescript
   :lines: 21-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:withSlowRestoreHint

**What this does.** Takes a *Promise* — a stand-in for a value that arrives later — plus a callback and an optional delay. It starts a timer that will call the callback after the delay, waits for the work to finish (``await`` pauses without blocking the rest of the app), and clears the timer in a ``finally`` block that always runs once the work settles. The ``<T>`` is a *generic type*: a placeholder for whatever kind of value the work produces, so this one helper works for any restore.

**Why it is here.** The docstring records the guarantee: because the timer is cleared however the work settles, the hint only ever fires while the restore is genuinely still running — a fast success or a fast failure cancels it before it shows.

.. CG-EXPLANATION-END id=function:withSlowRestoreHint

