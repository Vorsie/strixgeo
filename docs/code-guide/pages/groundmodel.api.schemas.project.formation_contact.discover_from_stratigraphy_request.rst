groundmodel.api.schemas.project.formation_contact.discover_from_stratigraphy_request
====================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_request.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring, imports, and the same map/key size caps as the auto-populate request.

**Why it is here.** The comment records the caps mirror the auto-populate request for the same untrusted-restore reason.

.. CG-EXPLANATION-END id=module-header

Class ``DiscoverFromStratigraphyRequest``
-----------------------------------------

.. CG-BLOCK id=class:DiscoverFromStratigraphyRequest lines=20-42

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_request.py
   :language: python
   :lines: 20-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:DiscoverFromStratigraphyRequest

**What this does.** The read-only preview request: a bounded list of borehole ids (1–500) and an optional ``manual_map`` for lumping.

**Why it is here.** The docstring records it has the same validation shape as the auto-populate request but commits nothing — it runs the same scan and returns a preview so the dialog can show what the write path will produce (the ``discover ≡ apply`` invariant). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:DiscoverFromStratigraphyRequest

