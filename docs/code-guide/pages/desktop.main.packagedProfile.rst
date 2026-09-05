desktop.main.packagedProfile
============================

.. CG-PAGE source=desktop/src/main/packagedProfile.ts complete=true

*Source file:* ``desktop/src/main/packagedProfile.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/main/packagedProfile.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This block is the file's opening comment — a plain-English note for whoever reads the code. It explains that a shipped (*packaged*) build must claim its own per-user data folder. Electron (this desktop app's framework) works out that folder — called the ``userData`` profile, where the app keeps its database, settings and recent files — from the developer name in ``package.json`` (``ground-model-desktop``), which is the very SAME folder the development app uses, because renaming the product for release does not move the profile. A packaged build therefore deliberately moves its profile to ``%APPDATA%\StrixGeo`` instead.

**Why it is here.** Three problems follow from a shipped build and the dev app sharing one profile. The installed build's database storage would land right beside the developer's live recovery and recent-projects files. The *single-instance lock* — the marker that keeps only one copy of the app running at a time — lives in that profile, so sharing it would stop the dev app and an installed build from ever running at the same time. And the profile folder name becomes permanent after the first real customer installs (it holds their database), so the internal repository name would be baked into every customer machine and support document forever. Moving to a clean, brand-named folder now, before any customer install exists, costs nothing and fixes all three. The comment stresses this file MUST run before anything else reads the profile location, because the lock, the crash-recovery store, the beta-expiry record, the diagnostics store and the embedded database all resolve their paths from it.

.. CG-EXPLANATION-END id=module-header

``const PACKAGED_PROFILE_DIR_NAME``
-----------------------------------

.. CG-BLOCK id=const:PACKAGED_PROFILE_DIR_NAME lines=25-27

.. literalinclude:: ../../../desktop/src/main/packagedProfile.ts
   :language: typescript
   :lines: 25-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:PACKAGED_PROFILE_DIR_NAME

**What this does.** Defines the folder name a packaged build uses under the Windows application-data area — ``StrixGeo``, the product's brand name.

**Why it is here.** This name becomes unchangeable once a customer's database lives inside it, so it is fixed as a single named value that must be the correct brand name from the very first install.

.. CG-EXPLANATION-END id=const:PACKAGED_PROFILE_DIR_NAME

``interface ProfileApp``
------------------------

.. CG-BLOCK id=interface:ProfileApp lines=28-62

.. literalinclude:: ../../../desktop/src/main/packagedProfile.ts
   :language: typescript
   :lines: 28-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProfileApp

**What this does.** Describes the small slice of Electron's ``app`` this file needs: ``isPackaged`` (is this a shipped build), ``getPath`` and ``setPath`` (read and change where a named folder lives), and ``commandLine.hasSwitch`` (was a given command-line option passed). An *interface* is a written description of the members a value must provide.

**Why it is here.** Depending on only this handful of members, rather than the whole Electron ``app``, lets the profile move be unit-tested by passing in a tiny stand-in that records which folders were reassigned — no real Electron needed.

.. CG-EXPLANATION-END id=interface:ProfileApp

``function applyPackagedProfile``
---------------------------------

.. CG-BLOCK id=function:applyPackagedProfile lines=63-81

.. literalinclude:: ../../../desktop/src/main/packagedProfile.ts
   :language: typescript
   :lines: 63-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyPackagedProfile

**What this does.** Moves a packaged build's profile to the brand-named folder, and leaves development untouched. It does nothing in a development build, and also does nothing if the launch was given an explicit ``--user-data-dir`` option. Otherwise it points both the ``userData`` and ``sessionData`` folders at ``%APPDATA%\StrixGeo`` and, when the machine-local area is known, moves the ``logs`` folder under it too. It reports back whether it actually moved anything.

**Why it is here.** The ``sessionData`` folder (Chromium's caches) is set explicitly rather than trusted to follow ``userData``, because its default is derived separately and a future change could quietly split the profile in two. An explicit ``--user-data-dir`` is honoured as a deliberate request to run in isolation (used by test launches); overriding it would silently point a supposedly isolated run at the real future-install profile. And the logs are moved to the machine-local area because a large, churny, machine-specific store should never travel on a Roaming profile that a company might sync to a network share — but only when that area is resolvable, so the app never crashes over it.

.. CG-EXPLANATION-END id=function:applyPackagedProfile

