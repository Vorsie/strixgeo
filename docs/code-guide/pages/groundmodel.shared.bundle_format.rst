groundmodel.shared.bundle_format
================================

.. CG-PAGE source=src/groundmodel/shared/bundle_format.py complete=true

*Source file:* ``src/groundmodel/shared/bundle_format.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/shared/bundle_format.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Declares two values that describe the on-disk shape of a saved project file (a ``.gmproj`` / ``.strix`` *bundle* — the one file that holds an entire project). ``BUNDLE_FORMAT_VERSION = 4`` is the *format version*, a stamped number saying which shape new saves use; ``SUPPORTED_BUNDLE_VERSIONS = {3, 4}`` is the set of versions this build can still open. The comment records that v4 nests a ``litho_layers`` array on every geological-model payload.

**Why it is here.** These two numbers sit in ``shared`` — the floor every layer may import — so both the API schema (which stamps the version and rejects old ones on restore) and the infrastructure build/restore path can read them without infrastructure depending on the API layer. See CLAUDE.md "Backwards Compatibility": backwards-compat is suspended pre-ship for now, but once shipped every older version stays in this set forever with an explicit upgrade chain.

.. CG-EXPLANATION-END id=module-header

