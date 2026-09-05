groundmodel.api.local_client_token_constants
============================================

.. CG-PAGE source=src/groundmodel/api/local_client_token_constants.py complete=true

*Source file:* ``src/groundmodel/api/local_client_token_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/api/local_client_token_constants.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Sets three named text values that the launch-token mechanism shares between two programs. ``LOCAL_CLIENT_TOKEN_ENV_VAR`` is the name of the environment variable (``STRIX_API_TOKEN``) the desktop shell uses to hand the token to the engine. ``LOCAL_CLIENT_TOKEN_HEADER`` is the name of the request header (``X-StrixGeo-Token``) that carries the token on every call. ``NULL_ORIGIN`` is the literal word ``"null"`` that a page loaded from a file reports as its origin.

**Why it is here.** A *header* is a short labelled line of text attached to every web request; an *origin* is the website an in-browser request came from; an *environment variable* is a named value one program can hand to another when it starts it. The docstring explains the contract: the desktop shell mints one random token per launch, passes it to the engine through the environment, and adds it as a header on the app's own requests. Naming both ends in a single file is what stops the two programs drifting apart silently. The comments record two deliberate choices: the mere presence of the environment variable is what turns the check on, so an engine started by hand (a developer shell, the test scripts) has no token and keeps the older open behaviour; and the header is attached deep in the desktop shell rather than in the app's own code, so a hijacked page inside the window cannot read the token back out.

.. CG-EXPLANATION-END id=module-header

