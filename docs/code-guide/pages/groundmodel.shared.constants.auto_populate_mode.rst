groundmodel.shared.constants.auto_populate_mode
===============================================

.. CG-PAGE source=src/groundmodel/shared/constants/auto_populate_mode.py complete=true

*Source file:* ``src/groundmodel/shared/constants/auto_populate_mode.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/shared/constants/auto_populate_mode.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces an *enum* (a fixed set of named allowed values) for the "fill formations from stratigraphy" write path, and imports ``StrEnum`` (an enum whose members are also plain text).

**Why it is here.** The docstring records a live data-loss incident (2026-08-03): "Fill from boreholes" was meant to ADD one unit but deleted four saved units, because passing a selection implicitly meant "delete everything not in this set". The enum makes that intent explicit at the wire boundary, so an omitted field or an old client can no longer mass-delete a model.

.. CG-EXPLANATION-END id=module-header

Class ``AutoPopulateMode``
--------------------------

.. CG-BLOCK id=class:AutoPopulateMode lines=19-32

.. literalinclude:: ../../../src/groundmodel/shared/constants/auto_populate_mode.py
   :language: python
   :lines: 19-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoPopulateMode

**What this does.** The enum with two values: ``ADD`` (create or update only the selected formations and leave the rest completely alone) and ``OVERWRITE`` (the model becomes exactly the selection — formations not in it are deleted in the same transaction).

**Why it is here.** ``ADD`` is the default everywhere, so the safe behaviour is the one you get by accident or from an old client; ``OVERWRITE`` is only reached when the caller has confirmed the deletion with the user first. This is the reversible-versus-irreversible rule applied at the data boundary.

.. CG-EXPLANATION-END id=class:AutoPopulateMode

