groundmodel.infrastructure.parsers.lab.dov.dov_scalar_observation_client
========================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-87

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 1-87
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the scalar-observation client and how it differs from the grain-size one, then the imports, and a load-time safety check on the parameter strings.

**Why it is here.** This client reads single-number lab tests — carbonate content, organic carbon, water content, the Atterberg limits — which DOV puts straight on the WFS row, so it fetches no detail XML. It filters on the exact parameter, not just the parameter group, because one group mixes several different measurements. The load-time check confirms none of the configured parameter strings contains a single quote, which would break the filter string the client builds — catching a bad future addition the moment the module loads rather than at query time.

.. CG-EXPLANATION-END id=module-header

Class ``DovScalarObservationClient`` — header
---------------------------------------------

.. CG-BLOCK id=class:DovScalarObservationClient lines=88-103

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 88-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovScalarObservationClient

**What this does.** Opens the scalar-observation client and documents its inputs.

**Why it is here.** Unlike the grain-size client it is not built on the shared base class, because it needs to pass an extra filter argument through the scan; the docstring notes this duplication is accepted for now under the rule to feel the pain before abstracting.

.. CG-EXPLANATION-END id=class:DovScalarObservationClient

Method ``DovScalarObservationClient``. ``def __init__``
-------------------------------------------------------

.. CG-BLOCK id=method:DovScalarObservationClient.__init__ lines=104-109

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 104-109
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovScalarObservationClient.__init__

**What this does.** Stores the HTTP client and the rate-limit state, and registers the logger.

**Why it is here.** Plain wiring of the collaborators it was handed.

.. CG-EXPLANATION-END id=method:DovScalarObservationClient.__init__

Method ``DovScalarObservationClient``. ``async def fetch_bbox``
---------------------------------------------------------------

.. CG-BLOCK id=method:DovScalarObservationClient.fetch_bbox lines=110-180

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 110-180
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovScalarObservationClient.fetch_bbox

**What this does.** Scans a rectangle for scalar observations matching one parameter or a list of parameters (splitting when dense) and returns the rows, optionally keeping only those whose parent sample the caller already has.

**Why it is here.** Accepting either one parameter or a list lets the Atterberg phase fetch its two limits in one query while the single-value tests each pass one. There is no download phase — the rows already carry the values — so the method stops at the scan and the parent filter.

.. CG-EXPLANATION-END id=method:DovScalarObservationClient.fetch_bbox

Method ``DovScalarObservationClient``. ``def _build_cql_filter``
----------------------------------------------------------------

.. CG-BLOCK id=method:DovScalarObservationClient._build_cql_filter lines=181-201

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 181-201
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovScalarObservationClient._build_cql_filter

**What this does.** Builds the filter that selects the wanted parameter(s): an equals test for one, or an "is one of" test for a list.

**Why it is here.** DOV's parameter strings contain spaces and brackets, which the filter language handles inside single quotes; the values are known to contain no single quote themselves, which the module's load-time check enforces. Marking this a static method signals it depends only on its input.

.. CG-EXPLANATION-END id=method:DovScalarObservationClient._build_cql_filter

Method ``DovScalarObservationClient``. ``async def _wfs_count``
---------------------------------------------------------------

.. CG-BLOCK id=method:DovScalarObservationClient._wfs_count lines=202-216

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 202-216
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovScalarObservationClient._wfs_count

**What this does.** Asks how many observations match the filter in a rectangle, via the shared count helper.

**Why it is here.** It takes the filter as an argument because this client counts against a filtered slice of the shared observations layer.

.. CG-EXPLANATION-END id=method:DovScalarObservationClient._wfs_count

Method ``DovScalarObservationClient``. ``async def _wfs_features``
------------------------------------------------------------------

.. CG-BLOCK id=method:DovScalarObservationClient._wfs_features lines=217-260

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 217-260
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovScalarObservationClient._wfs_features

**What this does.** Fetches the matching observations in a rectangle and turns each into a typed row, skipping any with no parent link and warning with the available property names when it does.

**Why it is here.** A row with no parent sample link cannot attach to anything, so it is dropped; naming the properties on a skip makes a DOV schema change diagnosable.

.. CG-EXPLANATION-END id=method:DovScalarObservationClient._wfs_features

Function ``def _build_row``
---------------------------

.. CG-BLOCK id=function:_build_row lines=261-291

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py
   :language: python
   :lines: 261-291
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_row

**What this does.** A pure builder that turns one scalar observation's properties into a row — its key, parent sample key, parameter group and parameter, value, unit, method, date, and detection condition — returning "nothing" when the observation URL or the parent link is missing.

**Why it is here.** Both are needed for a stable identity. A row whose value is blank but whose detection condition is set is deliberately kept, because that blank-with-a-reason is meaningful — for example a not-measurable plastic limit — and the mapper handles it downstream. It is a plain function, with no logging, so it can be unit-tested on its own.

.. CG-EXPLANATION-END id=function:_build_row

