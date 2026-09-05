desktop.renderer.src.utils.launchPrototypeTypes
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/launchPrototypeTypes.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/launchPrototypeTypes.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. This file declares the TypeScript data shapes for the information the licensing/activation and auto-updater prototypes hand to the renderer — the window that draws the app. A "DTO" is a data-transfer object: the declared shape of a bundle of data that crosses a boundary between two parts of the program.

**Why it is here.** The comment records that these shapes MIRROR the ones in the main process but are re-declared here on purpose: the renderer is not allowed to import code from the main process, so the contract between them is written out on both sides of the boundary — the same pattern the preload layer uses for recent projects and recovery descriptors — and when a main-process shape changes, this file must change in step. The activation and updater layer is a reviewable prototype (docs/design/onboarding-activation-updater-proto.md), not yet a finished feature.

.. CG-EXPLANATION-END id=module-header

``type LicenceStateDto``
------------------------

.. CG-BLOCK id=type:LicenceStateDto lines=13-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 13-22
   :lineno-match:

.. CG-EXPLANATION-START id=type:LicenceStateDto

**What this does.** A union — a fixed list of the only allowed text values — naming the possible licence states: unactivated, trial, active, grace, expired, clock-rollback, and device-mismatch.

**Why it is here.** The comment records that it mirrors ``LicenceState`` in the main process; the grace, clock-rollback and device-mismatch states reflect the activation design (a 30-day offline grace, a guard against turning the clock back, and one device per Solo seat).

.. CG-EXPLANATION-END id=type:LicenceStateDto

``type LicenceTierDto``
-----------------------

.. CG-BLOCK id=type:LicenceTierDto lines=23-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 23-25
   :lineno-match:

.. CG-EXPLANATION-START id=type:LicenceTierDto

**What this does.** A union of the three commercial tiers: solo, pro, and studio.

**Why it is here.** The comment records that it mirrors ``LicenceTier`` in the main process; these are the subscription tiers the product sells.

.. CG-EXPLANATION-END id=type:LicenceTierDto

``interface ActivationVerdictDto``
----------------------------------

.. CG-BLOCK id=interface:ActivationVerdictDto lines=26-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 26-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationVerdictDto

**What this does.** An interface — a declared record shape — for the evaluated licence verdict: the state, whether the app is blocked, the tier, whether this is a trial, the days and grace-days remaining, the expiry and grace-end moments as millisecond timestamps, and a plain reason string.

**Why it is here.** The comment records that it mirrors ``ActivationVerdict``. Several fields can be null because they only apply in some states — there is no day count or tier before a licence is activated.

.. CG-EXPLANATION-END id=interface:ActivationVerdictDto

``interface ActivationStatusDto``
---------------------------------

.. CG-BLOCK id=interface:ActivationStatusDto lines=39-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 39-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationStatusDto

**What this does.** The shape the licensing screen draws from: the verdict above, a human-readable device label, a masked licence key (or nothing), and a trial flag.

**Why it is here.** The comment records that it mirrors ``ActivationStatus``; the key travels already masked so the full licence key is never shown on screen.

.. CG-EXPLANATION-END id=interface:ActivationStatusDto

``type IssueFailureCodeDto``
----------------------------

.. CG-BLOCK id=type:IssueFailureCodeDto lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:IssueFailureCodeDto

**What this does.** A union of the reasons an activate or trial request can fail: an unknown key, the device limit reached, an already-used trial, or the server being unreachable.

**Why it is here.** The comment records that it mirrors ``IssueFailureCode`` in the main process.

.. CG-EXPLANATION-END id=type:IssueFailureCodeDto

``type ActivationActionResultDto``
----------------------------------

.. CG-BLOCK id=type:ActivationActionResultDto lines=50-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 50-54
   :lineno-match:

.. CG-EXPLANATION-START id=type:ActivationActionResultDto

**What this does.** The result of an activate / trial / deactivate call: either success carrying the new status, or failure carrying one of the failure codes above plus a message.

**Why it is here.** The comment records that it mirrors ``ActivationActionResult``; being a two-shape union forces a caller to check the success flag before reading the rest.

.. CG-EXPLANATION-END id=type:ActivationActionResultDto

``type UpdaterPhaseDto``
------------------------

.. CG-BLOCK id=type:UpdaterPhaseDto lines=55-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 55-65
   :lineno-match:

.. CG-EXPLANATION-START id=type:UpdaterPhaseDto

**What this does.** A union of the auto-updater's lifecycle phases: idle, checking, available, not-available, downloading, downloaded, error, and disabled.

**Why it is here.** The comment records that it mirrors ``UpdaterPhase`` in the main process.

.. CG-EXPLANATION-END id=type:UpdaterPhaseDto

``interface UpdateNoticeDto``
-----------------------------

.. CG-BLOCK id=interface:UpdateNoticeDto lines=66-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 66-72
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpdateNoticeDto

**What this does.** A renderer-safe summary of an available update: its version, an optional release name, and optional release notes.

**Why it is here.** The comment records that it mirrors ``UpdateAvailableNotice`` in the main process.

.. CG-EXPLANATION-END id=interface:UpdateNoticeDto

``interface UpdaterEventDto``
-----------------------------

.. CG-BLOCK id=interface:UpdaterEventDto lines=73-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/launchPrototypeTypes.ts
   :language: typescript
   :lines: 73-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpdaterEventDto

**What this does.** One updater state change pushed from the main process to the window: the new phase, plus optional update details, a progress percentage, and a message.

**Why it is here.** The comment records that it mirrors ``UpdaterEvent`` in the main process.

.. CG-EXPLANATION-END id=interface:UpdaterEventDto

