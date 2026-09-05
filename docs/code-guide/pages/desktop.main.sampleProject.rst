desktop.main.sampleProject
==========================

.. CG-PAGE source=desktop/src/main/sampleProject.ts complete=true

*Source file:* ``desktop/src/main/sampleProject.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment explains what this file is for: finding where the bundled worked-example project lives, and naming the copy a user makes of it. It notes the file is deliberately pure and free of Electron — the three facts it needs about the running app are handed in from outside rather than read here. The two imports are Node's ``existsSync`` (does a file exist?) and ``join`` (glue path pieces together safely).

**Why it is here.** Onboarding — the first-run experience (debt #93) that greets a brand-new user — is meant to offer a 'Load sample project' button so the user sees a finished ground model immediately. The worked example ships as an installer resource: a read-only file packed alongside the program. Keeping this module free of Electron is a deliberate rule (the same one the recovery store and the packaged-profile helper follow) so the unit test can point it at a real temporary folder and run it as plain code.

.. CG-EXPLANATION-END id=module-header

``const SAMPLE_DIR_NAME``
-------------------------

.. CG-BLOCK id=const:SAMPLE_DIR_NAME lines=18-27

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 18-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_DIR_NAME

**What this does.** Fixes the sub-folder name, ``sample``, that holds the worked example under the app's resource root — the same name whether the app is running in development or from an installed build.

**Why it is here.** Both the dev source tree and the installer put the sample in a folder called ``sample``, so naming it once here keeps the two lookups below in step.

.. CG-EXPLANATION-END id=const:SAMPLE_DIR_NAME

``const SAMPLE_PROJECT_FILE_NAME``
----------------------------------

.. CG-BLOCK id=const:SAMPLE_PROJECT_FILE_NAME lines=28-35

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 28-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_PROJECT_FILE_NAME

**What this does.** Fixes the name of the bundled example project file, ``worked-example.strix``. A ``.strix`` file is StrixGeo's saved-project format — a whole ground model stored in one file.

**Why it is here.** This is the file the owner will author and ship later. Until it actually exists, the resolver below finds nothing and reports 'no sample', so the onboarding screen quietly keeps its empty-project fallback rather than pointing at a missing file.

.. CG-EXPLANATION-END id=const:SAMPLE_PROJECT_FILE_NAME

``const SAMPLE_INSTALL_DEFAULT_FILE_NAME``
------------------------------------------

.. CG-BLOCK id=const:SAMPLE_INSTALL_DEFAULT_FILE_NAME lines=36-38

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_INSTALL_DEFAULT_FILE_NAME

**What this does.** Fixes the friendly, spaced file name — ``StrixGeo worked example.strix`` — offered in the Save dialog when a user installs their own copy of the sample.

**Why it is here.** The bundled resource carries a plain internal name the customer never sees; when they save their own copy they should be offered a readable name, so the two names are kept deliberately separate.

.. CG-EXPLANATION-END id=const:SAMPLE_INSTALL_DEFAULT_FILE_NAME

``interface SampleProjectLocation``
-----------------------------------

.. CG-BLOCK id=interface:SampleProjectLocation lines=39-66

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 39-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleProjectLocation

**What this does.** Describes the three facts about the running app the path resolver needs, passed in rather than read directly: ``isPackaged`` (is this an installed build or a dev run?), ``resourcesPath`` (where an installed build keeps its bundled resources) and ``appPath`` (the app's root folder in development). An interface is a written description of the fields a value must carry.

**Why it is here.** These three values normally come from Electron, but reading them here would tie the file to Electron and break the 'pure, testable' rule; taking them as inputs lets ``index.ts`` supply the real Electron values while a test supplies a temporary folder instead.

.. CG-EXPLANATION-END id=interface:SampleProjectLocation

``function resolveSampleProjectPath``
-------------------------------------

.. CG-BLOCK id=function:resolveSampleProjectPath lines=67-73

.. literalinclude:: ../../../desktop/src/main/sampleProject.ts
   :language: typescript
   :lines: 67-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveSampleProjectPath

**What this does.** Works out the full path to the bundled example ``.strix`` and returns it — or returns nothing (``null``) when the file is not actually on disk. A packaged build looks under its resources folder; a dev run looks under the source tree's ``resources`` folder.

**Why it is here.** It probes for the file's real presence so a build whose sample has not been authored yet returns 'nothing' cleanly, instead of a path that the later copy step would choke on. Returning ``null`` is the signal onboarding uses to fall back to starting with an empty project.

.. CG-EXPLANATION-END id=function:resolveSampleProjectPath

