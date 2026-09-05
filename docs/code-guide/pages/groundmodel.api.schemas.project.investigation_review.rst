groundmodel.api.schemas.project.investigation_review
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/investigation_review.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/investigation_review.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/investigation_review.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the review surface, then imports of ``datetime``, ``Any`` and ``Literal``, ``UUID``, the Pydantic tools, and the strict base, and two ``Literal`` type aliases pinning the allowed target kinds and review statuses.

**Why it is here.** These schemas carry per-project, per-investigation decisions (status, notes, hidden flag). The docstring records that the target is fixed at create time — moving a decision is a delete-and-recreate, not a patch — and that the allowed values are duplicated here from the repository on purpose, because the API must declare them in its own contract while the repository stays the single source of truth; the integration tests fail loudly if the two drift.

.. CG-EXPLANATION-END id=module-header

Class ``InvestigationReviewUpsertRequest``
------------------------------------------

.. CG-BLOCK id=class:InvestigationReviewUpsertRequest lines=30-46

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/investigation_review.py
   :language: python
   :lines: 30-46
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationReviewUpsertRequest

**What this does.** The body to create-or-update a review decision: an optional status, notes, and hidden flag, each defaulting to absent so only the fields present are written.

**Why it is here.** It uses the strict base and the upsert-by-target pattern (the desktop knows which investigation it is annotating, not the review row's id). Keys left out leave the existing row untouched; new rows take defaults.

.. CG-EXPLANATION-END id=class:InvestigationReviewUpsertRequest

Class ``InvestigationReviewResponse``
-------------------------------------

.. CG-BLOCK id=class:InvestigationReviewResponse lines=47-63

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/investigation_review.py
   :language: python
   :lines: 47-63
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationReviewResponse

**What this does.** The shape every review endpoint returns: the row id, project, target kind and id, status, notes, timestamps, and the hidden flag. ``model_config = ConfigDict(from_attributes=True)`` lets it be built directly from a database row.

**Why it is here.** ``from_attributes`` tells the framework it may read values off a database object's attributes rather than a plain dictionary, so the endpoint can hand it the row straight from the repository. A response schema is kept separate from the row so the web contract is stable.

.. CG-EXPLANATION-END id=class:InvestigationReviewResponse

Class ``ProjectViewStatePatchRequest``
--------------------------------------

.. CG-BLOCK id=class:ProjectViewStatePatchRequest lines=64-101

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/investigation_review.py
   :language: python
   :lines: 64-101
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectViewStatePatchRequest

**What this does.** The body to update a project's view-state: a single free-form dictionary that is *shallow*-merged into the stored one — each top-level key replaces the same key, siblings untouched, and a null value removes a key.

**Why it is here.** The docstring explains the deliberate trade-off: deep merge has surprising behaviour around arrays (replace, append, or de-duplicate?) that the API cannot decide for callers, so shallow-and-explicit is more predictable, and a caller changing one nested field must send the whole subtree. The dictionary is opaque at this layer (stored as schema-less JSON), so adding a new view toggle needs no migration.

.. CG-EXPLANATION-END id=class:ProjectViewStatePatchRequest

