desktop.renderer.src.shell.stages.lithology.LithoCommittedPill
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoCommittedPill.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoCommittedPill.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoCommittedPill.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: a trash-can icon, the type describing a formation-contact record from the engine, and the translator type. The comment says this is the committed-contacts pill (debt #94), lifted out of the big ``LithologyInspector`` file unchanged.

**Why it is here.** This piece was split off ``LithologyInspector.tsx`` during the god-component decomposition round (debt #201) — the parent file had grown too large, so its self-contained panel sections were moved into sibling files. The comment records that this pill is presentational only: it draws the count summary and the Clear affordance, while the parent decides when to show it, holds the "a clear is running" flag, and owns the confirm dialog.

.. CG-EXPLANATION-END id=module-header

``interface LithoCommittedPillProps``
-------------------------------------

.. CG-BLOCK id=interface:LithoCommittedPillProps lines=14-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoCommittedPill.tsx
   :language: tsx
   :lines: 14-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoCommittedPillProps

**What this does.** Describes the inputs the pill expects: ``lithoContacts`` (all contacts in the active litho model, which drive the count summary), a ``wiping`` flag that is true while a clear is running, an ``onWipe`` callback that opens the clear-model confirm dialog, and the translator ``t``. It carries a docstring explaining each input and when the parent mounts the pill.

**Why it is here.** ``props`` are the inputs a parent hands a component. The docstring records the reason the pill exists: it surfaces the persistent state so the engineer understands why there are already polylines on a section before he has pressed Suggest. It also records that the parent mounts it whenever contacts exist OR litho formations exist — so the Clear button stays reachable even in the broken "orphan units, zero contacts" state a previous contact-only wipe could leave behind. The comment stresses ``onWipe`` opens a dialog rather than clearing directly, because a clear is irreversible.

.. CG-EXPLANATION-END id=interface:LithoCommittedPillProps

``function LithoCommittedPill``
-------------------------------

.. CG-BLOCK id=function:LithoCommittedPill lines=52-102

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoCommittedPill.tsx
   :language: tsx
   :lines: 52-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoCommittedPill

**What this does.** Draws the pill: a small sunken box with a sentence summarising how many contacts and how many distinct units this model holds, and a Clear button that calls ``onWipe`` (disabled, and reading "Clearing…", while a clear is running). The unit count is computed as the number of distinct ``formation_id`` values among this model's contacts.

**Why it is here.** Counting distinct ``formation_id`` over THIS model's contacts is deliberate (debt #147): the older code counted the project-wide litho vocabulary, which includes orphan and shared units kept by the delete cascade, and so wrongly read "this model has 30 units" even on a freshly created empty model. Counting only units that actually have a contact placed here makes the pill and the roster tell the same story. The Clear button opens a confirmation dialog rather than clearing on the spot, because wiping the model's committed contacts is irreversible (see ``docs/ux.md``).

.. CG-EXPLANATION-END id=function:LithoCommittedPill

