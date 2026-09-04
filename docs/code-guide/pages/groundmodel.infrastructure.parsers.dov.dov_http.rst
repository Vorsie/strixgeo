groundmodel.infrastructure.parsers.dov.dov_http
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_http.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_http.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring recording the HTTP client settings and the reason for each, then the imports, and it builds the module's own logger.

**Why it is here.** Both the CPT and borehole importers open a web client with identical tuning — a generous overall timeout, a short connect timeout, follow-redirects on, and a warm connection pool — so the construction is centralised here. The docstring is candid that the ``http2`` setting is a no-op against the live DOV servers (they only speak HTTP/1.1, confirmed by a live probe) but is kept so a future DOV upgrade would be picked up for free. It also documents the test-only fixture mode, which swaps the real network for on-disk sample files.

.. CG-EXPLANATION-END id=module-header

Class ``_HostAllowlistTransport`` — header
------------------------------------------

.. CG-BLOCK id=class:_HostAllowlistTransport lines=53-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 53-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:_HostAllowlistTransport

**What this does.** A wrapper around the real network layer that refuses any request whose host is not an allow-listed DOV host, before a connection is opened.

**Why it is here.** Following redirects is needed for a legitimate same-host hop DOV uses, but on its own "follow redirects" would chase a redirect to *any* host. Because every redirect hop is routed back through this wrapper, an off-host hop is caught and refused here — the guard the plain client lacks against a hostile response steering the app off-host.

.. CG-EXPLANATION-END id=class:_HostAllowlistTransport

Method ``_HostAllowlistTransport``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:_HostAllowlistTransport.__init__ lines=72-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 72-74
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HostAllowlistTransport.__init__

**What this does.** Stores the real network layer it wraps.

**Why it is here.** So that, once a request clears the host check, it can be handed to the real layer to do the actual work.

.. CG-EXPLANATION-END id=method:_HostAllowlistTransport.__init__

Method ``_HostAllowlistTransport``. ``async def handle_async_request``
----------------------------------------------------------------------

.. CG-BLOCK id=method:_HostAllowlistTransport.handle_async_request lines=75-96

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 75-96
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HostAllowlistTransport.handle_async_request

**What this does.** For each request, either passes it through to the real network layer, or — if its host is not allow-listed — logs a warning and raises a connection error.

**Why it is here.** The error it raises is deliberately the kind the download helper already catches per-row, so an off-host redirect fails just that one download rather than the whole import.

.. CG-EXPLANATION-END id=method:_HostAllowlistTransport.handle_async_request

Method ``_HostAllowlistTransport``. ``async def aclose``
--------------------------------------------------------

.. CG-BLOCK id=method:_HostAllowlistTransport.aclose lines=97-101

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 97-101
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HostAllowlistTransport.aclose

**What this does.** Closes the wrapped network layer.

**Why it is here.** So shutting down the wrapper cleanly shuts down the real layer underneath it.

.. CG-EXPLANATION-END id=method:_HostAllowlistTransport.aclose

Function ``def make_dov_async_client``
--------------------------------------

.. CG-BLOCK id=function:make_dov_async_client lines=102-147

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http.py
   :language: python
   :lines: 102-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:make_dov_async_client

**What this does.** Builds and returns a fresh web client tuned for DOV. In normal use it wraps the real network layer in the host-allow-list guard; in test fixture mode it wraps an in-process mock that serves on-disk sample files instead.

**Why it is here.** Centralising the client build means the timeout, redirect, and pool settings live in one place, and the fixture-mode switch lets the end-to-end tests run fully offline and deterministically while production behaviour is byte-for-byte unchanged.

.. CG-EXPLANATION-END id=function:make_dov_async_client

