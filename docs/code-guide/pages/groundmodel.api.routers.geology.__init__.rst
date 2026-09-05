groundmodel.api.routers.geology
===============================

.. CG-PAGE source=src/groundmodel/api/routers/geology/__init__.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/__init__.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the geology folder as a package and assembles it. It imports the thirteen sub-router modules (formations, models, contacts, litho, bodies, geotech, and the rest), makes one parent router carrying the shared web-path prefix ``/projects/{project_id}/geology``, and mounts every sub-router onto it.

**Why it is here.** A *router* is a labelled group of related web addresses. The geology feature used to be one 1,100-line file; it was split into focused modules (debt #40), but every final web address must stay byte-identical so nothing else has to change. Mounting all thirteen sub-routers on one parent that owns the shared prefix and tag achieves that: each sub-module keeps a bare router with no prefix of its own, and this file is the single place the ``/projects/{project_id}/geology`` prefix is attached. The application still includes just ``geology.router``, which is now this aggregate.

.. CG-EXPLANATION-END id=module-header

