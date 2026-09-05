desktop.renderer.src.utils.formationDeletionScope
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formationDeletionScope.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formationDeletionScope.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationDeletionScope.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out which formations an "overwrite" Fill run would delete, so the confirmation the engineer sees can name them. It imports two helpers from the neighbouring ``formationKey`` file that turn a formation into its identity key. The comment states the rule it follows, copied exactly from the server's own delete pass: a formation is a *candidate* only if it has at least one contact in the model being filled, and it is *doomed* if its stable key is not among the keys the user chose to keep.

**Why it is here.** The reason is recorded in the comment: telling the engineer "removes 4 units" is not something they can judge, but "removes Boom Klei, Formatie van Diest, …" is, so the confirmation must name the units that will die. This is the platform's rule for irreversible actions — an overwrite that deletes formations cannot be silent, it needs a confirmation the user can actually reason about. The candidate rule mirrors the server exactly because a formation is a project-wide name shared by the geological, litho and geotech sibling models; one that appears only in a sibling model is invisible to the server's delete and so must not be named here either, or the dialog would frighten the user about units that are not really at risk.

.. CG-EXPLANATION-END id=module-header

``interface DoomedFormation``
-----------------------------

.. CG-BLOCK id=interface:DoomedFormation lines=23-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationDeletionScope.ts
   :language: typescript
   :lines: 23-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DoomedFormation

**What this does.** Describes the small record the confirmation dialog needs for each formation that will be deleted: its id (a stable handle used for keys and test checks) and its name (the human-readable text the engineer actually reads).

**Why it is here.** An *interface* is a declared data shape checked before the app runs. Carrying both the id and the name means the dialog has a stable handle to key each row on and the display name to show, without having to look either up again elsewhere.

.. CG-EXPLANATION-END id=interface:DoomedFormation

``function computeDoomedFormations``
------------------------------------

.. CG-BLOCK id=function:computeDoomedFormations lines=41-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationDeletionScope.ts
   :language: typescript
   :lines: 41-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeDoomedFormations

**What this does.** Given every formation in the project, the contacts of the model being filled, and the set of keys the user chose to keep, it returns the formations that would be deleted, in the original list order. It first normalises the kept keys into a set, then builds the set of formation ids that actually appear in this model's contacts, and finally keeps only the formations that are in this model AND whose stable key is not in the kept set — mapping each survivor of that filter down to just its id and name.

**Why it is here.** Comparing through the same normalisation the server uses (via ``formationStableKey`` and ``normaliseFormationKey``) is what keeps the dialog's list identical to what the server will really delete — a divergence here would name the wrong units. Restricting to formations referenced by this model's contacts reproduces the server's own scope exactly. When nothing is doomed the result is empty, which is the caller's signal that the run is a pure addition and can be applied without asking anything — the confirmation only appears when something will actually be lost.

.. CG-EXPLANATION-END id=function:computeDoomedFormations

