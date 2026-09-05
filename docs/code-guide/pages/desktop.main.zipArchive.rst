desktop.main.zipArchive
=======================

.. CG-PAGE source=desktop/src/main/zipArchive.ts complete=false

*Source file:* ``desktop/src/main/zipArchive.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``interface ZipEntry``
----------------------

.. CG-BLOCK id=interface:ZipEntry lines=34-40

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 34-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ZipEntry

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:ZipEntry

``const LOCAL_HEADER_SIGNATURE``
--------------------------------

.. CG-BLOCK id=const:LOCAL_HEADER_SIGNATURE lines=41-41

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 41-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOCAL_HEADER_SIGNATURE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LOCAL_HEADER_SIGNATURE

``const CENTRAL_HEADER_SIGNATURE``
----------------------------------

.. CG-BLOCK id=const:CENTRAL_HEADER_SIGNATURE lines=42-42

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 42-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:CENTRAL_HEADER_SIGNATURE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:CENTRAL_HEADER_SIGNATURE

``const EOCD_SIGNATURE``
------------------------

.. CG-BLOCK id=const:EOCD_SIGNATURE lines=43-45

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 43-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:EOCD_SIGNATURE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:EOCD_SIGNATURE

``const VERSION_NEEDED``
------------------------

.. CG-BLOCK id=const:VERSION_NEEDED lines=46-48

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:VERSION_NEEDED

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:VERSION_NEEDED

``const FLAG_UTF8_NAMES``
-------------------------

.. CG-BLOCK id=const:FLAG_UTF8_NAMES lines=49-50

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 49-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:FLAG_UTF8_NAMES

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:FLAG_UTF8_NAMES

``const METHOD_STORE``
----------------------

.. CG-BLOCK id=const:METHOD_STORE lines=51-51

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:METHOD_STORE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:METHOD_STORE

``const METHOD_DEFLATE``
------------------------

.. CG-BLOCK id=const:METHOD_DEFLATE lines=52-54

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:METHOD_DEFLATE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:METHOD_DEFLATE

``const DOS_EPOCH_YEAR``
------------------------

.. CG-BLOCK id=const:DOS_EPOCH_YEAR lines=55-57

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:DOS_EPOCH_YEAR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DOS_EPOCH_YEAR

``function dosTimestamp``
-------------------------

.. CG-BLOCK id=function:dosTimestamp lines=58-66

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:dosTimestamp

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:dosTimestamp

``function compress``
---------------------

.. CG-BLOCK id=function:compress lines=67-99

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 67-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:compress

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:compress

``function createZipArchive``
-----------------------------

.. CG-BLOCK id=function:createZipArchive lines=100-170

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 100-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:createZipArchive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:createZipArchive

