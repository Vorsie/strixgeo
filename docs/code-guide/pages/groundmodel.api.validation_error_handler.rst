groundmodel.api.validation_error_handler
========================================

.. CG-PAGE source=src/groundmodel/api/validation_error_handler.py complete=true

*Source file:* ``src/groundmodel/api/validation_error_handler.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/api/validation_error_handler.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the problem, then the imports: the maths helper for testing finite numbers, the request and status types, the framework's JSON encoder, the validation-error type, and the JSON reply types.

**Why it is here.** *Validation* is the framework's automatic check that an incoming request has the right shape and types before any route code runs; a failed check normally produces a ``422`` (the status for "the request was understood but its contents are invalid"). The docstring records the exact bug: the default 422 echoes the offending input back, but the strict JSON writer refuses to render a non-finite number such as ``NaN`` ("not a number"), so the 422 itself raises and the engineer gets a confusing 500 for input the API had *already correctly rejected*. This file rewrites the 422 so it survives such input while keeping the same reply shape callers already read.

.. CG-EXPLANATION-END id=module-header

Function ``def json_safe``
--------------------------

.. CG-BLOCK id=function:json_safe lines=28-56

.. literalinclude:: ../../../src/groundmodel/api/validation_error_handler.py
   :language: python
   :lines: 28-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:json_safe

**What this does.** Walks any JSON-like structure — dictionaries, lists, tuples, and single values — and replaces every non-finite number with its written-out spelling: ``NaN`` becomes the text ``"NaN"`` and infinity becomes ``"Infinity"`` or ``"-Infinity"``. Everything else is returned untouched.

**Why it is here.** A strict JSON writer refuses these special float values, but their spellings are ordinary text it will happily write, so turning them into text is what lets the error reply render at all — and it keeps the bad value visible to the reader rather than hiding it. It recurses through nested structures because the offending value can be buried anywhere inside the echoed input.

.. CG-EXPLANATION-END id=function:json_safe

Function ``async def validation_error_handler``
-----------------------------------------------

.. CG-BLOCK id=function:validation_error_handler lines=57-80

.. literalinclude:: ../../../src/groundmodel/api/validation_error_handler.py
   :language: python
   :lines: 57-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:validation_error_handler

**What this does.** The handler itself: it takes the per-field validation errors, passes them through the framework's JSON encoder and then the non-finite scrub above, and returns a ``422`` with a ``{"detail": [...]}`` body — the same shape the framework produces by default, minus the raw echo of the whole submitted body.

**Why it is here.** Returning the identical ``detail`` shape means existing callers that read which field was wrong keep working unchanged. The raw body echo is dropped because it can carry the same non-finite values that caused the original crash and adds nothing the per-field errors do not already say. The request argument is unused but required by the framework's fixed handler signature.

.. CG-EXPLANATION-END id=function:validation_error_handler

