desktop.renderer.src.hooks.useContactCrud
=========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useContactCrud.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useContactCrud.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its imports. It brings in ``useCallback`` and two small TypeScript state-setter types from React, the API client and a duplicate-contact error type, several response and request types, a copy-payload type, the undo-command type, the logger, and the translation helper ``t``.

**Why it is here.** This hook is the create / read / update / delete cluster for geological and litho *contacts* — the points where one formation meets another down a borehole or CPT. CRUD is shorthand for those four kinds of change. The docstring records that it was split out of the larger ``useGeologicalModel`` hook (debt #201) so that the parent stays a thin owner of shared state while this file owns only the change-handlers. It also records a dependency-array convention: the state setter and the toast function are left out of the hooks' dependency lists on purpose, because both are stable references that never go stale, so listing them would only churn identities; the values that really vary are listed.

.. CG-EXPLANATION-END id=module-header

``function formationContactBatchToLayerItem``
---------------------------------------------

.. CG-BLOCK id=function:formationContactBatchToLayerItem lines=43-94

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 43-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationContactBatchToLayerItem

**What this does.** A small pure function (its output depends only on its input, with no side effects) that converts one contact batch-update entry into the layer batch-update shape the litho endpoint expects. It copies the depth, maps the source label from the contact vocabulary to the layer vocabulary, copies the confidence, and copies the anchor pair only when both parts are present.

**Why it is here.** The comment records two constraints. The layer type requires plain numbers, not nullable ones, so null and undefined optional fields are stripped; the engine applies only the fields actually present in the request body. And the anchor pair (borehole id and CPT id) must appear together with exactly one non-null, because the schema rejects a half-set anchor on a cross-column move.

.. CG-EXPLANATION-END id=function:formationContactBatchToLayerItem

``function resolveContactAxis``
-------------------------------

.. CG-BLOCK id=function:resolveContactAxis lines=95-110

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 95-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveContactAxis

**What this does.** A pure helper that takes a contact id and the two contact lists (geological and litho) and returns the matching contact, the id of the model it belongs to, and whether it is a litho contact — or null when the id is in neither list.

**Why it is here.** The docstring records the point of it: because a contact carries its own model id, deriving the model and the target list from the contact itself is what lets every handler work on the litho axis as well as the geological one. Before this, the contact-edit handlers were hard-wired to the geological model, so a litho contact could not be edited (dogfeed 2026-05-22); this preamble was copy-pasted across five handlers until it was pulled out here (audit 2026-07-12).

.. CG-EXPLANATION-END id=function:resolveContactAxis

``interface UseContactCrudParams``
----------------------------------

.. CG-BLOCK id=interface:UseContactCrudParams lines=111-138

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 111-138
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseContactCrudParams

**What this does.** Describes the shared state and helpers the parent passes in: the open project and active geological model; the geological contacts list and its setter; the litho contacts and litho layers; two refetch helpers; a helper to record newly-imported ids; a helper to push an undo command; a helper to mark the project changed; and the toast function.

**Why it is here.** The comments record why these come from the parent rather than being owned here: the shared state lives in the composer so this leaf cluster only holds the change-callbacks. ``setContacts`` supports *optimistic patches* — updating the on-screen list at once on success so the drawing settles without waiting for a refetch. ``markMutated`` marks the project changed after editing a pre-existing row so a close-without-save reverts it (debt #160).

.. CG-EXPLANATION-END id=interface:UseContactCrudParams

``interface UseContactCrudResult``
----------------------------------

.. CG-BLOCK id=interface:UseContactCrudResult lines=139-178

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 139-178
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseContactCrudResult

**What this does.** Lists the seven handlers the hook returns: create a contact, update a contact's depth, batch-create and batch-update contacts, delete a contact, and unlink or link a litho contact to the geological model.

**Why it is here.** Naming the return shape gives the parent one tidy object of actions, each returning a Promise because every one is an asynchronous call to the engine — the frontend always goes through the API (CLAUDE.md), never straight to the database.

.. CG-EXPLANATION-END id=interface:UseContactCrudResult

``function useContactCrud``
---------------------------

.. CG-BLOCK id=function:useContactCrud lines=179-1239

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useContactCrud.ts
   :language: typescript
   :lines: 179-1239
   :lineno-match:

.. CG-EXPLANATION-START id=function:useContactCrud

**What this does.** The hook itself. It unpacks its inputs, then defines the seven handlers, each a cached function. In order: ``handleUpdateContactDepth`` re-picks a contact's depth after a drag, patching the local list optimistically; ``handleCreateContact`` creates a new contact and, if the engine reports a duplicate, recovers by updating the existing one instead; the two batch handlers create or update many contacts in one call; ``handleDeleteContact`` removes a contact; and the two link handlers connect or disconnect a litho contact from the geological model. Each handler resolves which axis the contact is on, sends the change to the engine, updates the on-screen list (litho handlers refetch the litho layers instead), marks the project changed, records an undo command that can replay the change both ways, and logs the outcome — with any failure caught and shown to the user as a translated error message. The hook returns the seven handlers.

**Why it is here.** Every write goes to the engine and every handler works on both the geological and litho axes because the contact carries its own model id (the axis-resolver above). The updates are optimistic — the on-screen list changes immediately on success so a dragged contact settles at its new depth without a refetch round-trip — while litho edits refetch so the layers and their derived contacts settle to the engine's truth. A create that collides with an existing contact is caught as a duplicate error and turned into an update, because the engine's no-overlap rule rejects a second contact at the same place; and a shared boundary between two accepted litho layers is moved through a single atomic two-row endpoint so neither layer overlaps the other, which the database no-overlap constraint would otherwise reject. Every mutation of a pre-existing row calls ``markMutated`` so an unsaved change can be reverted on close (debt #160), and every handler pushes an undo command so the action is reversible. The two stable references (the state setter and the toast) are deliberately kept out of the dependency lists, as the file docstring explains, so the handler identities do not churn.

.. CG-EXPLANATION-END id=function:useContactCrud

