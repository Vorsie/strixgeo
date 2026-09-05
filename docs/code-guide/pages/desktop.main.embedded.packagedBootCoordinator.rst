desktop.main.embedded.packagedBootCoordinator
=============================================

.. CG-PAGE source=desktop/src/main/embedded/packagedBootCoordinator.ts complete=false

*Source file:* ``desktop/src/main/embedded/packagedBootCoordinator.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/embedded/packagedBootCoordinator.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the small module that fixes the ORDER of the packaged app's startup steps — specifically, it starts the Python engine at the same time as the database instead of one after the other. It imports only a type (``BootFailure``) that describes a failed boot.

**Why it is here.** On a packaged first launch three slow, one-time costs used to run in sequence: about 60 seconds to boot the bundled PostgreSQL, then about 17 seconds for a separate migrate step, then about 48 seconds for the engine's own first-time code load. Two of those — the engine loading its code and the database starting — do not depend on each other, so this coordinator overlaps them: it does the fast preparation, kicks off the database boot WITHOUT waiting for it, and — as soon as the licence check allows — starts the engine so its slow code-load runs while the database is still coming up. The engine then waits for and upgrades the database itself, so there is no separate migrate step. The module is kept deliberately free of Electron, the filesystem and child processes: it fixes only the ordering, which is the one thing that is easy to get wrong and impossible to test inside the big startup file.

.. CG-EXPLANATION-END id=module-header

``type PreparedResult``
-----------------------

.. CG-BLOCK id=type:PreparedResult lines=26-28

.. literalinclude:: ../../../desktop/src/main/embedded/packagedBootCoordinator.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:PreparedResult

**What this does.** Names the outcome of the fast preparation phase: either ``{ ok: true, prep }`` carrying the prepared stack, or ``{ ok: false, failure }`` carrying the step that stopped it. The ``<Prep>`` in the name is a *generic* — a blank left to be filled in with whatever shape the caller uses for its prepared stack.

**Why it is here.** Returning a success-or-failure value (rather than throwing an error) lets the caller handle a preparation failure without losing which step failed — which is exactly what the startup dialog needs to show.

.. CG-EXPLANATION-END id=type:PreparedResult

``interface PackagedBootDeps``
------------------------------

.. CG-BLOCK id=interface:PackagedBootDeps lines=29-53

.. literalinclude:: ../../../desktop/src/main/embedded/packagedBootCoordinator.ts
   :language: typescript
   :lines: 29-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PackagedBootDeps

**What this does.** The checklist of things the coordinator must be handed: ``prepare`` (do the fast work — resolve paths, read secrets, pick a port — without waiting on the database), ``onPrepared`` (publish the prepared stack so other code can read it), ``startCluster`` (begin the database boot, whose result is deliberately not waited on), ``gateAllowsEngine`` (ask whether the licence check permits the engine to start yet), and ``spawnEngine`` (actually launch the engine).

**Why it is here.** Every real action is passed in rather than performed here (dependency injection) so the *ordering* can be unit-tested with simple stand-ins, without booting a real database or launching a real engine. The comments pin the two subtle rules that make the overlap work: ``prepare`` must not block on the database, and ``startCluster``'s promise must not be awaited before the engine is spawned.

.. CG-EXPLANATION-END id=interface:PackagedBootDeps

``interface CoordinatedBoot``
-----------------------------

.. CG-BLOCK id=interface:CoordinatedBoot lines=54-76

.. literalinclude:: ../../../desktop/src/main/embedded/packagedBootCoordinator.ts
   :language: typescript
   :lines: 54-76
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoordinatedBoot

**What this does.** Describes what the coordinator hands back: whether it succeeded, the failure (present only on a preparation failure, so the caller can show the dialog and quit), the prepared stack, the still-pending database-boot promise, and whether the engine was actually started.

**Why it is here.** The caller needs the database-boot promise back so it can attach its own success-or-failure handler — remember the coordinator started that boot but did not wait for it. ``engineSpawned`` is ``false`` when the licence gate deferred the engine, which tells the caller the engine will be started later, once a key is accepted.

.. CG-EXPLANATION-END id=interface:CoordinatedBoot

``function coordinatePackagedBoot``
-----------------------------------

.. CG-BLOCK id=function:coordinatePackagedBoot lines=77-101

.. literalinclude:: ../../../desktop/src/main/embedded/packagedBootCoordinator.ts
   :language: typescript
   :lines: 77-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:coordinatePackagedBoot

**What this does.** The one function that runs the ordering. It waits for the fast preparation; on failure it returns that failure and stops. On success it publishes the prepared stack, kicks off the database boot without waiting for it, and — if the licence gate allows — starts the engine immediately, before the database has finished coming up. It returns the prepared stack together with the still-pending database-boot promise.

**Why it is here.** This is where the overlap actually happens: the line that starts the database boot deliberately does NOT ``await`` it, so the engine's slow first-time code-load runs during the database startup instead of after it. Publishing the prepared stack first matters because the engine reads it, and a launch whose engine was deferred by the licence gate needs it later when a key is accepted. The comments restate the licence rule ("no engine before the gate passes") and the fact that the engine waits for and upgrades the database itself.

.. CG-EXPLANATION-END id=function:coordinatePackagedBoot

