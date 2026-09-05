groundmodel.application.packing_class_key_loader
================================================

.. CG-PAGE source=src/groundmodel/application/packing_class_key_loader.py complete=true

*Source file:* ``src/groundmodel/application/packing_class_key_loader.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/application/packing_class_key_loader.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the packing-class-key loader. It imports the pure key builder and the formation row, and its docstring explains the paint-versus-identity divergence.

**Why it is here.** The geotech model keeps one formation row per packing class, litho parent and geological parent, so the same class exists under several row ids where a litho unit spans a geological boundary (debt #278). The 3-D paint build compares the class, not the row, so two same-class masses paint as one body (owner 2026-08-21: one mass one body), while the body-identity recompute went permanently granular and keys on the raw row (owner 2026-09-01). The divergence is a decided ruling; this loader keeps the query and projection in one home, handing the domain plain triples so the domain never sees a database type.

.. CG-EXPLANATION-END id=module-header

Function ``async def load_packing_class_key``
---------------------------------------------

.. CG-BLOCK id=function:load_packing_class_key lines=39-67

.. literalinclude:: ../../../src/groundmodel/application/packing_class_key_loader.py
   :language: python
   :lines: 39-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_packing_class_key

**What this does.** Reads a project's formations and builds the function mapping a formation id to its class key — soil plus NAD class when both are present, and the id unchanged otherwise.

**Why it is here.** A litho model's rows carry no NAD class, so the key is the identity there and a caller is byte-identical to a plain row-keyed merge; the geotech rows collapse to the shared class key.

.. CG-EXPLANATION-END id=function:load_packing_class_key

