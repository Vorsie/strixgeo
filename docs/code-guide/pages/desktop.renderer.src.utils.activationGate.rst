desktop.renderer.src.utils.activationGate
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/activationGate.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/activationGate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/activationGate.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment describes this file's one job: decide, before a distributed build shows the workspace, whether the launch should be stopped at the licence start screen or allowed through. It lists the rules the decision layers on top of the main process's ``blocked`` flag: a development build and the automated test harness always pass; a beta build passes because it runs on its own expiry stamp rather than a licence; a packaged non-beta build whose licence status could not even be read is stopped (fail closed); and otherwise the main-process ``blocked`` verdict decides.

**Why it is here.** The comment records the owner's ruling (CLAUDE.local.md, the onboarding/activation prototype design note ``docs/design/onboarding-activation-updater-proto.md``): a distributed build must show *"a startscreen with beta key input before the actual app opens."* The rules protect the daily development flow and the test suite from ever being locked out, and the fail-closed rule means a build that cannot confirm it is licensed is treated as unlicensed rather than falling open into the paid workspace.

.. CG-EXPLANATION-END id=module-header

``type GateDecision``
---------------------

.. CG-BLOCK id=type:GateDecision lines=24-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/activationGate.ts
   :language: typescript
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=type:GateDecision

**What this does.** Names a small *type* called ``GateDecision`` that can only ever be one of two pieces of text: ``'block'`` or ``'pass'``. A *type* is a note the tooling checks before the app runs; it fixes the set of allowed values so a stray third value is caught as a mistake.

**Why it is here.** The gate answers exactly one question with exactly one of two answers, so pinning it to those two words makes every place that reads the answer unable to mishandle it.

.. CG-EXPLANATION-END id=type:GateDecision

``interface ActivationGateInputs``
----------------------------------

.. CG-BLOCK id=interface:ActivationGateInputs lines=27-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/activationGate.ts
   :language: typescript
   :lines: 27-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationGateInputs

**What this does.** Describes the four facts the gate weighs, as an *interface* — a declared data shape listing named fields. They are: whether this is a packaged (distributed) build, whether the automated end-to-end test harness is running, whether the licence-status read failed, and the ``blocked`` verdict that came back from the activation status.

**Why it is here.** Each field carries a comment naming where it comes from (the launch flags, or the activation status) so the decision function below can be a *pure function* — a function whose answer depends only on the values handed in, with no hidden reads and no side effects, which makes it safe to test with plain inputs and safe to call repeatedly.

.. CG-EXPLANATION-END id=interface:ActivationGateInputs

``function activationGateDecision``
-----------------------------------

.. CG-BLOCK id=function:activationGateDecision lines=53-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/activationGate.ts
   :language: typescript
   :lines: 53-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:activationGateDecision

**What this does.** The decision itself. It checks the facts in order and returns as soon as one settles the question: a non-packaged (development) build passes; the test harness passes; if the licence status could not be read at all it blocks; otherwise it blocks when the verdict says ``blocked`` and passes when it does not.

**Why it is here.** The inline comments record each rule's reason: development must be untouched so the owner's daily flow keeps working; blocking the test harness would break the whole suite; and the fail-closed read (owner 2026-09-03, *"require Beta-key before API"*) treats an unreadable status as "no licence" so a build can never fall open into the workspace when it cannot prove it is licensed.

.. CG-EXPLANATION-END id=function:activationGateDecision

``function isBetaBuild``
------------------------

.. CG-BLOCK id=function:isBetaBuild lines=85-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/activationGate.ts
   :language: typescript
   :lines: 85-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:isBetaBuild

**What this does.** A small check that answers whether a value returned by the beta-status query describes a beta build. It confirms the value is an object, is not empty, has a text ``state`` field, and that the state is anything other than ``'unstamped'``.

**Why it is here.** The docstring records the reasoning: a build carrying a beta stamp always reports a real state, and an expired or clock-rolled-back beta never reaches this point because the main process refused it first — so "a status whose state is not ``unstamped``" is exactly the test for a beta build. The careful step-by-step shape guarding is because the incoming value's type is unknown, so each assumption is verified before it is used.

.. CG-EXPLANATION-END id=function:isBetaBuild

