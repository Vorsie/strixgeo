groundmodel.api.schemas.strict_request_model
============================================

.. CG-PAGE source=src/groundmodel/api/schemas/strict_request_model.py complete=true

*Source file:* ``src/groundmodel/api/schemas/strict_request_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/api/schemas/strict_request_model.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring explaining the two rules every inbound write body must obey, then imports of Pydantic's base model and its configuration helper.

**Why it is here.** *Pydantic* is the library that checks incoming JSON against a declared shape; *validation* is that check. This file defines the common base for every schema the API accepts as input, so a schema opts into the rules by inheriting rather than by remembering a settings line. The docstring records both rules and their reasons, and one subtlety: the configuration does NOT reach a model nested inside another, so a nested item model must inherit this base too. It also records the one documented exception: the ``.strix`` bundle-intake schemas deliberately stay lenient so an older saved file carrying a since-renamed key still opens (``docs/backwards-compat.md``).

.. CG-EXPLANATION-END id=module-header

Class ``StrictRequestModel``
----------------------------

.. CG-BLOCK id=class:StrictRequestModel lines=38-46

.. literalinclude:: ../../../src/groundmodel/api/schemas/strict_request_model.py
   :language: python
   :lines: 38-46
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrictRequestModel

**What this does.** The base class itself. Its one line of configuration sets ``extra="forbid"`` (reject any field the schema does not declare) and ``allow_inf_nan=False`` (reject the special float values ``NaN`` and infinity).

**Why it is here.** Rejecting unknown fields turns a client's renamed or mistyped key into a loud ``422`` ("the request was understood but its contents are invalid") instead of a silent success that writes nothing — pure upside on a single-seat local API. Rejecting non-finite numbers keeps the stored model finite by construction: a ``NaN`` depth sorts undefined, an infinite coordinate breaks every spatial query, and neither survives strict JSON, so they are stopped at the door. Response schemas do not inherit this because they are built by us, not validated from client input.

.. CG-EXPLANATION-END id=class:StrictRequestModel

