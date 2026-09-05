groundmodel.api.unhandled_error_handler
=======================================

.. CG-PAGE source=src/groundmodel/api/unhandled_error_handler.py complete=true

*Source file:* ``src/groundmodel/api/unhandled_error_handler.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/api/unhandled_error_handler.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring explaining the problem this file solves, then the imports it needs: the request and status types, the JSON reply types, a helper that recognises a database lock timeout, the custom contention exception, and the shared logger.

**Why it is here.** When an error escapes a route unhandled, the web framework turns it into a ``500`` (the status code for "the server hit an unexpected error") in a layer that sits OUTSIDE the cross-origin headers, so the reply reaches the browser without them and the browser hides it — the app's console then shows what looks like a cross-origin (CORS) misconfiguration and says nothing about the real error. The docstring records that this is exactly how a 15 August 2026 dogfeed report arrived: a body-partition race surfaced to the owner as a CORS failure. The underlying race was fixed at its source; this file fixes the *reporting* so the next unexpected error is legible. Nothing is swallowed — the error is still logged with its full traceback and the status stays 500.

.. CG-EXPLANATION-END id=module-header

Function ``def make_unhandled_error_handler``
---------------------------------------------

.. CG-BLOCK id=function:make_unhandled_error_handler lines=37-96

.. literalinclude:: ../../../src/groundmodel/api/unhandled_error_handler.py
   :language: python
   :lines: 37-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:make_unhandled_error_handler

**What this does.** A factory: given the exact origins the cross-origin policy accepts, it builds and returns the actual error handler. The returned handler decides the status and message for an escaped error, then, if the request's origin is one the API accepts, re-attaches the ``Access-Control-Allow-Origin`` header so the browser will surface the reply.

**Why it is here.** The list of accepted origins is passed in rather than re-declared here so this error path can never accidentally accept an origin the real policy rejects — the docstring notes the origin pinning in ``api/main.py`` is a deliberate defence against other browser tabs reading the local API, and a looser error path would quietly undo it. A *factory* (a function that builds another function) is used because the accepted origins are only known when the app is assembled.

.. CG-EXPLANATION-END id=function:make_unhandled_error_handler

Function ``def _classify``
--------------------------

.. CG-BLOCK id=function:_classify lines=97-150

.. literalinclude:: ../../../src/groundmodel/api/unhandled_error_handler.py
   :language: python
   :lines: 97-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:_classify

**What this does.** Decides the status code and message for an escaped error. A body-partition contention becomes a ``409`` (the status for "the resource is busy / in conflict") naming the waiting operation; any other database lock timeout also becomes a ``409`` with a generic "try again" message; everything else is logged with its full traceback and answered ``500``.

**Why it is here.** Two kinds of escaped error are not server bugs but a busy resource — two writes contending for the same data — and telling the engineer "try again in a moment" is the honest, useful answer, so they are separated out as 409s. For the genuine 500, the message deliberately says the outcome is *unknown* ("may or may not have been applied — reload to see") rather than "not applied", because the handler can run after a route already committed its write, so a flat "not applied" would be a lie in exactly the case where the engineer most needs the truth.

.. CG-EXPLANATION-END id=function:_classify

