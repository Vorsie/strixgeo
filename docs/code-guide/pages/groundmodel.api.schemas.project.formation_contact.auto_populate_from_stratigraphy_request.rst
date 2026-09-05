groundmodel.api.schemas.project.formation_contact.auto_populate_from_stratigraphy_request
=========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_request.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring, imports (``Annotated``, ``UUID``, Pydantic ``Field``, the strict base, and the auto-populate mode enum), and two size caps for the map and key strings.

**Why it is here.** The comment records why the caps exist: the map and keys come from a saved ``.strix`` file's lumping snapshot, which is untrusted on restore, so bounding them stops a crafted file allocating a huge structure during validation. ``Annotated`` attaches a rule (here a max length) to a type.

.. CG-EXPLANATION-END id=module-header

Class ``AutoPopulateFromStratigraphyRequest``
---------------------------------------------

.. CG-BLOCK id=class:AutoPopulateFromStratigraphyRequest lines=22-112

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_request.py
   :language: python
   :lines: 22-112
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoPopulateFromStratigraphyRequest

**What this does.** The request that seeds contacts from each borehole's stratigraphy: a bounded list of borehole ids (1–500), an optional ``selected_keys`` set, an optional ``manual_map`` for lumping, an optional ``section_id``, a ``create_missing_formations`` flag, and a ``mode`` (add or overwrite).

**Why it is here.** The docstring is dense with load-bearing rules: the run is idempotent (each contact carries its source layer and already-used layers are skipped); ``create_missing_formations`` distinguishes the Fill path (mints formations) from the Sections seed path (never creates — the explicit-content invariant); and ``mode`` defaults to the SAFE ``add`` because on 2026-08-03 a Fill meant to add one unit deleted four saved units, so overwrite now needs an explicit, confirmed choice. When a section is given, the endpoint also unions the created and found contact ids into that section's seeded set. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:AutoPopulateFromStratigraphyRequest

