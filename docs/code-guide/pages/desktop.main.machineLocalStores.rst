desktop.main.machineLocalStores
===============================

.. CG-PAGE source=desktop/src/main/machineLocalStores.ts complete=true

*Source file:* ``desktop/src/main/machineLocalStores.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/machineLocalStores.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code) and its two imports. It lives in Electron's *main process* (the part of the desktop app with full computer access). The note explains a Windows storage decision. An installed build keeps the user's profile in the Roaming app-data folder (``%APPDATA%\StrixGeo``), which is right for the SMALL things a person reasonably wants to follow them between office machines — the recent-projects list, recovery files, the database credentials. But it is wrong for the LARGE, machine-specific things: the live PostgreSQL database files, the compile cache, and the logs. In a company network, Roaming is often mirrored to a shared network drive; a running database on a network share is slow at best and corrupt at worst, and the caches and logs are just pointless churn on that mirror. So those large stores are moved instead to the machine-only Local app-data folder (``%LOCALAPPDATA%\StrixGeo``). This file decides when that split applies and where the local folder is.

**Why it is here.** The split protects the database and keeps a company's Roaming sync clean. The note stresses this file is "pure and Electron-free" — it only does the decision, touching nothing — which is what lets the automated tests drive every case (installed, isolated test run, no Local folder) directly, and keeps the same on/off gate the profile logic already uses in one shared place.

.. CG-EXPLANATION-END id=module-header

``interface MachineLocalContext``
---------------------------------

.. CG-BLOCK id=interface:MachineLocalContext lines=26-49

.. literalinclude:: ../../../desktop/src/main/machineLocalStores.ts
   :language: typescript
   :lines: 26-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MachineLocalContext

**What this does.** Describes the three facts the decision below needs about this launch. An *interface* is a written description of the fields a value must carry. The fields are ``packaged`` (is this a real installed build? — a development run keeps its database in Docker and relocates nothing), ``isolated`` (was this run pointed at its own separate profile folder, as the tests do?), and ``localAppData`` (the path of the Windows Local app-data folder, or nothing if it cannot be found).

**Why it is here.** Gathering exactly the inputs the decision depends on into one clearly-described bundle is what makes the decision a *pure* function — it reads only these three values and reaches out to nothing — so a test can hand it any combination and check the answer without a real Windows machine.

.. CG-EXPLANATION-END id=interface:MachineLocalContext

``function resolveMachineLocalStrixDir``
----------------------------------------

.. CG-BLOCK id=function:resolveMachineLocalStrixDir lines=50-57

.. literalinclude:: ../../../desktop/src/main/machineLocalStores.ts
   :language: typescript
   :lines: 50-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveMachineLocalStrixDir

**What this does.** Decides where the large machine-local stores should live, from the launch facts. It returns nothing (``null``) — meaning "do not relocate, leave them in the Roaming profile" — in three cases: a development run, a run pointed at its own isolated profile folder, or a machine with no Local app-data folder. Otherwise it returns the Local ``StrixGeo`` folder path.

**Why it is here.** This is the single gate for the Roaming-versus-Local split. Development is excluded because it uses Docker's database and relocates nothing; an isolated test run is excluded because a machine-wide Local folder would collide across such runs and defeat the isolation; and a machine with no Local folder falls back to Roaming — not ideal, but correct and safe rather than crashing.

.. CG-EXPLANATION-END id=function:resolveMachineLocalStrixDir

