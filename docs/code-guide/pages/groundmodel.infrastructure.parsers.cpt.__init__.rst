groundmodel.infrastructure.parsers.cpt
======================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/__init__.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the CPT-parsers folder as a package and, in the same breath, re-exports the handful of names the rest of the program actually reaches for: the CPT-type label, the GEF header, the GEF parse result, the GEF parser itself, and the two validation types. An ``import`` line pulls a name in from another file; ``__all__`` is the public list of names this package hands out.

**Why it is here.** A CPT (Cone Penetration Test) is the push-a-cone-into-the-ground sounding this whole platform is built around. Gathering the CPT names here means a caller writes one short import (``from ...parsers.cpt import GEFParser``) instead of knowing the exact file each class lives in — so the internal file layout can move without breaking callers.

.. CG-EXPLANATION-END id=module-header

