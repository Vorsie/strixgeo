groundmodel.application.validate_borehole_stratigraphy
======================================================

.. CG-PAGE source=src/groundmodel/application/validate_borehole_stratigraphy.py complete=true

*Source file:* ``src/groundmodel/application/validate_borehole_stratigraphy.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/application/validate_borehole_stratigraphy.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the borehole-stratigraphy validator use case. It imports the issue value object, the geology repository (a *repository* is the object that reads and writes a family of database rows so this code never writes raw SQL), and the logger.

**Why it is here.** The docstring records the intent: it routes the editor's "are this borehole's contacts internally consistent?" check through the application layer, adding the standard entry log line and giving the editor one stable hook for future extensions such as batch-validating a whole section before save.

.. CG-EXPLANATION-END id=module-header

Class ``ValidateBoreholeStratigraphy`` — header
-----------------------------------------------

.. CG-BLOCK id=class:ValidateBoreholeStratigraphy lines=26-28

.. literalinclude:: ../../../src/groundmodel/application/validate_borehole_stratigraphy.py
   :language: python
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=class:ValidateBoreholeStratigraphy

**What this does.** Declares the use-case class that runs the no-gaps check for one borehole in one model.

**Why it is here.** Why: recorded in the class + module docstrings — a thin application-layer wrapper over the repository's validator.

.. CG-EXPLANATION-END id=class:ValidateBoreholeStratigraphy

Method ``ValidateBoreholeStratigraphy``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:ValidateBoreholeStratigraphy.__init__ lines=29-33

.. literalinclude:: ../../../src/groundmodel/application/validate_borehole_stratigraphy.py
   :language: python
   :lines: 29-33
   :lineno-match:

.. CG-EXPLANATION-START id=method:ValidateBoreholeStratigraphy.__init__

**What this does.** Builds the geology repository over the given session and names the logger.

**Why it is here.** The repository wraps both the database fetch and the call into the pure validator, so the use case just holds it.

.. CG-EXPLANATION-END id=method:ValidateBoreholeStratigraphy.__init__

Method ``ValidateBoreholeStratigraphy``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:ValidateBoreholeStratigraphy.execute lines=34-44

.. literalinclude:: ../../../src/groundmodel/application/validate_borehole_stratigraphy.py
   :language: python
   :lines: 34-44
   :lineno-match:

.. CG-EXPLANATION-START id=method:ValidateBoreholeStratigraphy.execute

**What this does.** Logs the request, asks the repository for the borehole's gap issues, logs the count, and returns the list.

**Why it is here.** It is read-only and never raises or commits, as the docstring states: an empty list means the contacts form a clean contiguous stratigraphy, and any non-empty list is a soft warning the editor shows inline rather than an error that blocks the engineer.

.. CG-EXPLANATION-END id=method:ValidateBoreholeStratigraphy.execute

