desktop.renderer.src.utils.apiFailureMessage
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/apiFailureMessage.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/apiFailureMessage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/apiFailureMessage.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment explains what sentence to show the engineer when an API call fails. It notes that the app's request helper throws an error carrying the engine's own ``detail`` text, so on a refusal (a 422 response) that message already names what was refused and where to fix it. The comment warns that replacing it with a generic house sentence turns a precise refusal into "something went wrong", and gives a real example where that hid the reason a contact drag was refused.

**Why it is here.** The comment records the lesson from that incident: the engine's refusal text is the most useful thing the app can show, so this helper prefers it and only falls back to a house sentence for the shapes that carry no message of their own — a network failure, a thrown non-error, or an empty detail. It keeps the frontend honest about why the API said no, in the spirit of the frontend-always-goes-through-the-API contract.

.. CG-EXPLANATION-END id=module-header

``function apiFailureMessage``
------------------------------

.. CG-BLOCK id=function:apiFailureMessage lines=18-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/apiFailureMessage.ts
   :language: typescript
   :lines: 18-21
   :lineno-match:

.. CG-EXPLANATION-START id=function:apiFailureMessage

**What this does.** Takes whatever the failed call threw plus a fallback sentence. If the thrown thing is a real error with non-blank text, it returns that text; otherwise it returns the fallback.

**Why it is here.** The docstring records the rule: show the engine's own message when there is one (so a refusal reads as a refusal), and use the fallback only when the error genuinely carries no text.

.. CG-EXPLANATION-END id=function:apiFailureMessage

