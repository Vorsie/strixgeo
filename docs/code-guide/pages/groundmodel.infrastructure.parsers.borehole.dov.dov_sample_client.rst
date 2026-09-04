groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client
=================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing a WFS-only client for soil samples, then the imports — the many sample WFS property names, the sample row type, and the shared WFS helpers.

**Why it is here.** Unlike the borehole and interpretation clients this one downloads no detail XML at all: every field the sample entity needs already lives in the WFS row, so the client stops at the rectangle scan. That also means there is nothing to cache, since the cache stores detail XML bodies and this client fetches none.

.. CG-EXPLANATION-END id=module-header

Class ``DovSampleClient`` — header
----------------------------------

.. CG-BLOCK id=class:DovSampleClient lines=65-81

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 65-81
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovSampleClient

**What this does.** Opens the sample client, built on the shared WFS base class, and declares its layer.

**Why it is here.** Declaring the layer as a class value lets it inherit the base's count and feature-fetch unchanged, since it needs only the scan, not a download phase.

.. CG-EXPLANATION-END id=class:DovSampleClient

Method ``DovSampleClient``. ``async def fetch_bbox``
----------------------------------------------------

.. CG-BLOCK id=method:DovSampleClient.fetch_bbox lines=82-140

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 82-140
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovSampleClient.fetch_bbox

**What this does.** Scans a rectangle for samples (splitting when dense) and returns the rows, optionally keeping only those whose parent borehole the caller already imported.

**Why it is here.** The parent filter lets the orchestrator drop samples belonging to boreholes not in this import — the same idempotency rule the borehole phase uses — so a re-import does not attach samples to boreholes the caller does not have.

.. CG-EXPLANATION-END id=method:DovSampleClient.fetch_bbox

Method ``DovSampleClient``. ``def _build_row``
----------------------------------------------

.. CG-BLOCK id=method:DovSampleClient._build_row lines=141-143

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 141-143
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovSampleClient._build_row

**What this does.** The base class's required hook: turn one feature's properties into a sample row by calling the module-level builder.

**Why it is here.** It is the one-line bridge the base class calls for each feature; the real work is in the pure function below so it can be unit-tested without a client.

.. CG-EXPLANATION-END id=method:DovSampleClient._build_row

Method ``DovSampleClient``. ``def _init_skip_state``
----------------------------------------------------

.. CG-BLOCK id=method:DovSampleClient._init_skip_state lines=144-147

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 144-147
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovSampleClient._init_skip_state

**What this does.** Starts the skip counter as two separate counts: samples with no key of their own, and samples with no parent link.

**Why it is here.** A sample can be skipped for two distinct reasons, and counting them apart makes the eventual warning tell the operator exactly which gap it hit.

.. CG-EXPLANATION-END id=method:DovSampleClient._init_skip_state

Method ``DovSampleClient``. ``def _on_skipped_feature``
-------------------------------------------------------

.. CG-BLOCK id=method:DovSampleClient._on_skipped_feature lines=148-155

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 148-155
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovSampleClient._on_skipped_feature

**What this does.** For a skipped sample, decides which of the two counters to bump by looking at whether the sample's own key is present.

**Why it is here.** So the warning that follows reports the real reason each sample was dropped, not a single lumped total.

.. CG-EXPLANATION-END id=method:DovSampleClient._on_skipped_feature

Method ``DovSampleClient``. ``def _emit_skip_warning``
------------------------------------------------------

.. CG-BLOCK id=method:DovSampleClient._emit_skip_warning lines=156-171

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 156-171
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovSampleClient._emit_skip_warning

**What this does.** When any samples were skipped, logs one warning giving both counts and the available property names.

**Why it is here.** The property list points straight at a DOV field rename as the likely cause of a sudden run of skips.

.. CG-EXPLANATION-END id=method:DovSampleClient._emit_skip_warning

Function ``def _build_row``
---------------------------

.. CG-BLOCK id=function:_build_row lines=172-213

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 172-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_row

**What this does.** A pure builder that turns one sample feature's properties into a sample row: its key, its parent borehole key, the depth interval, and the best-effort metadata. It returns "nothing" when either the sample's own key or its parent link is missing.

**Why it is here.** Both keys are mandatory — without its own key a sample has no stable identity, without a parent link it cannot attach to any borehole. DOV wraps some multi-value fields in pipe characters (a sample can link to several boreholes), so those are unwrapped and the first value taken. It is a plain function, with no logging, so it is easy to test in isolation.

.. CG-EXPLANATION-END id=function:_build_row

Function ``def _first_pipe_segment``
------------------------------------

.. CG-BLOCK id=function:_first_pipe_segment lines=214-229

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py
   :language: python
   :lines: 214-229
   :lineno-match:

.. CG-EXPLANATION-START id=function:_first_pipe_segment

**What this does.** Returns the first real value from a DOV field that wraps several values between pipe characters, or an empty string when there is none.

**Why it is here.** DOV encodes a multi-valued field as pipe-wrapped entries, which leaves empty pieces at the ends when split; this skips those and returns the first genuine entry.

.. CG-EXPLANATION-END id=function:_first_pipe_segment

