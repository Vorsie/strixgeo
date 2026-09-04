groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_client
================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the grain-size client's pipeline, then the imports, and it builds the exact server-side filter string that selects only grain-size observations.

**Why it is here.** This client queries the shared observations layer with a filter that narrows it to grain-size tests, then downloads each matching observation's detail XML in parallel for the parser — the same scan-then-download shape as the interpretation client. The filter is folded into the query the way DOV requires, because DOV refuses a request carrying both a rectangle parameter and a filter.

.. CG-EXPLANATION-END id=module-header

Class ``DovGrainSizeClient`` — header
-------------------------------------

.. CG-BLOCK id=class:DovGrainSizeClient lines=70-98

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 70-98
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovGrainSizeClient

**What this does.** Opens the grain-size client, built on the shared WFS base class, and declares its layer, label, and filter as class values.

**Why it is here.** Declaring those as class values lets it inherit the base's count and feature-fetch, with the filter narrowing the shared observations layer to grain-size. Its cache is rooted in an observation sub-folder so keys never clash with the other record types.

.. CG-EXPLANATION-END id=class:DovGrainSizeClient

Method ``DovGrainSizeClient``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient.__init__ lines=99-108

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 99-108
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient.__init__

**What this does.** Passes the HTTP client and rate-limit state up to the base class and stores the cache.

**Why it is here.** Plain wiring on top of the shared base.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient.__init__

Method ``DovGrainSizeClient``. ``async def fetch_bbox_processed``
-----------------------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient.fetch_bbox_processed lines=109-191

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 109-191
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient.fetch_bbox_processed

**What this does.** Runs the whole grain-size import for a rectangle: scan for observations (splitting when dense), optionally keep only those whose parent sample the caller already has, then download and parse each detail XML in parallel.

**Why it is here.** The parent-sample filter avoids downloading observations for samples the caller did not import. The download and parse are handled by the shared parallel helper, so this method mostly wires it up for grain-size.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient.fetch_bbox_processed

Method ``DovGrainSizeClient``. ``def _build_row``
-------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient._build_row lines=192-194

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 192-194
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient._build_row

**What this does.** The base class's required hook: turn one feature's properties into a grain-size row by calling the module-level builder.

**Why it is here.** It is the one-line bridge the base class calls per feature; the real work is in the pure function below so it is easy to test.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient._build_row

Method ``DovGrainSizeClient``. ``def _init_skip_state``
-------------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient._init_skip_state lines=195-198

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 195-198
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient._init_skip_state

**What this does.** Starts the skip counter as two separate counts: observations with no detail URL, and observations with no parent link.

**Why it is here.** Counting the two reasons apart makes the eventual warning say exactly which gap was hit.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient._init_skip_state

Method ``DovGrainSizeClient``. ``def _on_skipped_feature``
----------------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient._on_skipped_feature lines=199-205

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 199-205
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient._on_skipped_feature

**What this does.** For a skipped observation, decides which of the two counters to bump.

**Why it is here.** So the warning reports the real reason each was dropped.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient._on_skipped_feature

Method ``DovGrainSizeClient``. ``def _emit_skip_warning``
---------------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeClient._emit_skip_warning lines=206-221

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 206-221
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeClient._emit_skip_warning

**What this does.** When any observations were skipped, logs one warning with both counts and the available property names.

**Why it is here.** The property list points at a DOV field rename as the likely cause.

.. CG-EXPLANATION-END id=method:DovGrainSizeClient._emit_skip_warning

Function ``def _build_row``
---------------------------

.. CG-BLOCK id=function:_build_row lines=222-257

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py
   :language: python
   :lines: 222-257
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_row

**What this does.** A pure builder that turns one grain-size feature's properties into a row — its key, its parent sample key, the record URLs (with the direct proxy URL), and the method — returning "nothing" when the detail URL or the parent link is missing.

**Why it is here.** Both are mandatory: without the URL there is no XML to fetch, without the parent link the observation cannot attach to a sample. The comment records a real quirk — the detail URL is under a differently-named property on this layer than on the borehole layers, confirmed against the live schema.

.. CG-EXPLANATION-END id=function:_build_row

