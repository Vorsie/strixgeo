groundmodel.api.schemas.project.litho_layer
===========================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/__init__.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/__init__.py
   :language: python
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Re-exports every litho-layer schema (the request bodies, the response shape, and the three fixed value-lists) from this package under one import, and lists them in ``__all__``.

**Why it is here.** Gathering the package's public names in one place lets the rest of the app import them from the package rather than from each file, so a later file move is invisible to callers. ``__all__`` is the explicit list of names the package offers.

.. CG-EXPLANATION-END id=module-header

