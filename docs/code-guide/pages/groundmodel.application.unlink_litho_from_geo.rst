groundmodel.application.unlink_litho_from_geo
=============================================

.. CG-PAGE source=src/groundmodel/application/unlink_litho_from_geo.py complete=true

*Source file:* ``src/groundmodel/application/unlink_litho_from_geo.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/application/unlink_litho_from_geo.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that breaks the coupling between a litho contact and its geological contact. The docstring explains that it only sets the parent-contact link to nothing and describes the project-scope guard; the imports pull in the contact result value object, the contact and geological-model row types, and the geology repository.

**Why it is here.** The docstring records that the geological contact is never moved or deleted — this is purely removing a relationship, the one safety valve for a wrong auto-link — and that the scope guard mirrors the accept-litho path, loading the contact's model and checking it belongs to the project, so a foreign contact is rejected before any change.

.. CG-EXPLANATION-END id=module-header

Class ``UnlinkLithoFromGeo`` — header
-------------------------------------

.. CG-BLOCK id=class:UnlinkLithoFromGeo lines=29-41

.. literalinclude:: ../../../src/groundmodel/application/unlink_litho_from_geo.py
   :language: python
   :lines: 29-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:UnlinkLithoFromGeo

**What this does.** The use-case class header, inheriting the logger and holding a geology repository.

**Why it is here.** The docstring restates the job (issue #162 task 6): null the coupling label on one contact, touching nothing else, and not rebuilding surfaces because the geometry has not changed — only the label.

.. CG-EXPLANATION-END id=class:UnlinkLithoFromGeo

Method ``UnlinkLithoFromGeo``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:UnlinkLithoFromGeo.__init__ lines=42-47

.. literalinclude:: ../../../src/groundmodel/application/unlink_litho_from_geo.py
   :language: python
   :lines: 42-47
   :lineno-match:

.. CG-EXPLANATION-START id=method:UnlinkLithoFromGeo.__init__

**What this does.** The setup step: stores the session and builds the geology repository.

**Why it is here.** The caller owns the session; the repository gives the reads it needs.

.. CG-EXPLANATION-END id=method:UnlinkLithoFromGeo.__init__

Method ``UnlinkLithoFromGeo``. ``async def execute``
----------------------------------------------------

.. CG-BLOCK id=method:UnlinkLithoFromGeo.execute lines=48-102

.. literalinclude:: ../../../src/groundmodel/application/unlink_litho_from_geo.py
   :language: python
   :lines: 48-102
   :lineno-match:

.. CG-EXPLANATION-START id=method:UnlinkLithoFromGeo.execute

**What this does.** The entry point. It loads the contact by id, loads its model and checks the model belongs to the project, sets the parent-contact link to nothing, commits, refreshes the row and returns it. It returns nothing when the contact does not exist.

**Why it is here.** The scope guard is two separate loads (contact, then model) rather than an eager join, which the docstring notes avoids the eager-load requirement and keeps unit-test mocking simple. A missing contact or a project mismatch raises a value-error before any change. The refresh after commit populates the server-set columns before the snapshot is taken, matching the create-contact pattern.

.. CG-EXPLANATION-END id=method:UnlinkLithoFromGeo.execute

