groundmodel.api
===============

.. CG-PAGE source=src/groundmodel/api/__init__.py complete=true

*Source file:* ``src/groundmodel/api/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/api/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A single line of documentation naming what lives in this folder: the API layer — the FastAPI application, its routers, and its schemas. The file is otherwise empty.

**Why it is here.** In Python, a folder becomes an importable package only when it holds an ``__init__.py`` file; this one exists to mark the ``api`` folder as a package and to say, in one sentence, what the folder is for. A *router* is a group of related web addresses (URLs); a *schema* is the declared shape of the data that goes in and out. Both are defined in the sub-folders this file heads.

.. CG-EXPLANATION-END id=module-header

