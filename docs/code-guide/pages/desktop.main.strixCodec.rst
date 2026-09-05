desktop.main.strixCodec
=======================

.. CG-PAGE source=desktop/src/main/strixCodec.ts complete=false

*Source file:* ``desktop/src/main/strixCodec.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const STRIX_MAGIC``
---------------------

.. CG-BLOCK id=const:STRIX_MAGIC lines=58-64

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 58-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_MAGIC

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_MAGIC

``const STRIX_CODEC_VERSION``
-----------------------------

.. CG-BLOCK id=const:STRIX_CODEC_VERSION lines=65-75

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 65-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_CODEC_VERSION

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_CODEC_VERSION

``const STRIX_HEADER_SIZE``
---------------------------

.. CG-BLOCK id=const:STRIX_HEADER_SIZE lines=76-77

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 76-77
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_HEADER_SIZE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_HEADER_SIZE

``const OFFSET_VERSION``
------------------------

.. CG-BLOCK id=const:OFFSET_VERSION lines=78-78

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 78-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_VERSION

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:OFFSET_VERSION

``const OFFSET_SEED``
---------------------

.. CG-BLOCK id=const:OFFSET_SEED lines=79-79

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 79-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_SEED

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:OFFSET_SEED

``const OFFSET_CRC``
--------------------

.. CG-BLOCK id=const:OFFSET_CRC lines=80-80

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 80-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_CRC

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:OFFSET_CRC

``const OFFSET_PLAINTEXT_LEN``
------------------------------

.. CG-BLOCK id=const:OFFSET_PLAINTEXT_LEN lines=81-88

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 81-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_PLAINTEXT_LEN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:OFFSET_PLAINTEXT_LEN

``const STRIX_KEYSTREAM_SEED_FALLBACK``
---------------------------------------

.. CG-BLOCK id=const:STRIX_KEYSTREAM_SEED_FALLBACK lines=89-91

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 89-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_KEYSTREAM_SEED_FALLBACK

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_KEYSTREAM_SEED_FALLBACK

``const STRIX_CORRUPT_MESSAGE``
-------------------------------

.. CG-BLOCK id=const:STRIX_CORRUPT_MESSAGE lines=92-98

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 92-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_CORRUPT_MESSAGE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_CORRUPT_MESSAGE

``const STRIX_TRUNCATED_MESSAGE``
---------------------------------

.. CG-BLOCK id=const:STRIX_TRUNCATED_MESSAGE lines=99-105

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 99-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_TRUNCATED_MESSAGE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_TRUNCATED_MESSAGE

``const STRIX_UNKNOWN_FORMAT_MESSAGE``
--------------------------------------

.. CG-BLOCK id=const:STRIX_UNKNOWN_FORMAT_MESSAGE lines=106-115

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 106-115
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_UNKNOWN_FORMAT_MESSAGE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:STRIX_UNKNOWN_FORMAT_MESSAGE

``class StrixDecodeError``
--------------------------

.. CG-BLOCK id=class:StrixDecodeError lines=116-121

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 116-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixDecodeError

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=class:StrixDecodeError

``class StrixCorruptError``
---------------------------

.. CG-BLOCK id=class:StrixCorruptError lines=122-135

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 122-135
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixCorruptError

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=class:StrixCorruptError

``class StrixTruncatedError``
-----------------------------

.. CG-BLOCK id=class:StrixTruncatedError lines=136-145

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 136-145
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixTruncatedError

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=class:StrixTruncatedError

``class StrixUnknownFormatError``
---------------------------------

.. CG-BLOCK id=class:StrixUnknownFormatError lines=146-164

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 146-164
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixUnknownFormatError

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=class:StrixUnknownFormatError

``interface StrixReadFailure``
------------------------------

.. CG-BLOCK id=interface:StrixReadFailure lines=165-179

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 165-179
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StrixReadFailure

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:StrixReadFailure

``type ProjectReadResult``
--------------------------

.. CG-BLOCK id=type:ProjectReadResult lines=180-192

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 180-192
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectReadResult

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:ProjectReadResult

``function toStrixReadFailure``
-------------------------------

.. CG-BLOCK id=function:toStrixReadFailure lines=193-213

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 193-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:toStrixReadFailure

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:toStrixReadFailure

``function strixKeystream``
---------------------------

.. CG-BLOCK id=function:strixKeystream lines=214-243

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 214-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:strixKeystream

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:strixKeystream

``function applyKeystream``
---------------------------

.. CG-BLOCK id=function:applyKeystream lines=244-267

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 244-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyKeystream

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:applyKeystream

``function encodeStrix``
------------------------

.. CG-BLOCK id=function:encodeStrix lines=268-297

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 268-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:encodeStrix

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:encodeStrix

``function looksLikeLegacyJson``
--------------------------------

.. CG-BLOCK id=function:looksLikeLegacyJson lines=298-308

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 298-308
   :lineno-match:

.. CG-EXPLANATION-START id=function:looksLikeLegacyJson

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:looksLikeLegacyJson

``function startsWith``
-----------------------

.. CG-BLOCK id=function:startsWith lines=309-343

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 309-343
   :lineno-match:

.. CG-EXPLANATION-START id=function:startsWith

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:startsWith

``function decodeStrix``
------------------------

.. CG-BLOCK id=function:decodeStrix lines=344-404

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 344-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:decodeStrix

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:decodeStrix

