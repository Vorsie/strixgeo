groundmodel.api.schemas.project.geotech_band_edit.merge_geotech_bands_request
=============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/merge_geotech_bands_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/merge_geotech_bands_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/merge_geotech_bands_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, ``model_validator`` (a hook that checks the whole body after the fields are parsed), and the strict base model.

**Why it is here.** A *request schema* declares and validates what the desktop may send; extending ``StrictRequestModel`` (introduced on its own page) makes the body reject unknown fields and non-finite numbers, so a client typo fails loudly with a ``422`` instead of being silently ignored.

.. CG-EXPLANATION-END id=module-header

Class ``MergeGeotechBandsRequest`` — header
-------------------------------------------

.. CG-BLOCK id=class:MergeGeotechBandsRequest lines=12-42

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/merge_geotech_bands_request.py
   :language: python
   :lines: 12-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeGeotechBandsRequest

**What this does.** The body of the merge and merge-preview endpoints. It accepts exactly one of two shapes: a PAIR (an upper and a lower band id) or a RUN (a list of two or more contiguous band ids). Order does not matter — the server normalises by depth.

**Why it is here.** The two shapes serve the ordinary adjacent-pair merge and the small-lens absorb (host plus lens plus host, unioned in one atomic call with one preview and one undo step), as the docstring explains.

.. CG-EXPLANATION-END id=class:MergeGeotechBandsRequest

Method ``MergeGeotechBandsRequest``. ``def _exactly_one_form``
--------------------------------------------------------------

.. CG-BLOCK id=method:MergeGeotechBandsRequest._exactly_one_form lines=43-53

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/merge_geotech_bands_request.py
   :language: python
   :lines: 43-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:MergeGeotechBandsRequest._exactly_one_form

**What this does.** A validator that runs after parsing and refuses a body that supplies both forms or neither, raising a clear error.

**Why it is here.** Catching the ambiguity at the wire (turning it into a ``422``) is safer than letting an ill-formed request reach the use case; a request that says two different things must be rejected, not guessed at.

.. CG-EXPLANATION-END id=method:MergeGeotechBandsRequest._exactly_one_form

