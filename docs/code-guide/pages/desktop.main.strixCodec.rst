desktop.main.strixCodec
=======================

.. CG-PAGE source=desktop/src/main/strixCodec.ts complete=true

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

**What this does.** The long comment at the top is the file's docstring — a note for whoever reads it. It says this file is the reader and writer for the ``.strix`` save file. A saved project used to be plain, human-readable JSON text on disk; this file wraps that same text in a small binary container so a customer cannot open a project in Notepad and read or copy the interpreted data. It sets out the pipeline in steps: take the plaintext JSON, shrink it with gzip (a standard compression step), scramble the result with a simple reversible byte transform driven by a per-save random number, and put a short fixed header in front. The two ``import`` lines pull in Node's built-in ``zlib`` (gzip plus a CRC-32 checksum — a short fingerprint of the data) and ``crypto`` (for a random number). Nothing from Electron is imported.

**Why it is here.** The owner directed (1 September 2026) that saved interpretation must not sit in plaintext that a customer can lift out by eye. The docstring is emphatic about the exact tier: this is OPACITY, deliberately NOT cryptography and NOT the native-compilation protection the compiled engine has. The seed has to sit in the header because decoding needs it, and the payload is gzip whose signature is publicly known, so anyone who reads this format can reverse any file — that is the accepted "good enough" tier, and it must never be marketed as or relied on as encryption. Importing only Node built-ins, never Electron, is deliberate so the whole codec can be tested on any machine.

.. CG-EXPLANATION-END id=module-header

``const STRIX_MAGIC``
---------------------

.. CG-BLOCK id=const:STRIX_MAGIC lines=58-64

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 58-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_MAGIC

**What this does.** Defines ``STRIX_MAGIC`` — seven fixed ASCII bytes spelling ``STRIXB1`` that open every binary ``.strix`` file. A "magic" is a short signature at the very start of a file that lets a reader recognise the format at a glance.

**Why it is here.** The version is baked INTO the magic on purpose: a future, incompatible container would be ``STRIXB2``, so an old build sees "this is a StrixGeo file but newer" and refuses cleanly, instead of mis-reading it as the current format.

.. CG-EXPLANATION-END id=const:STRIX_MAGIC

``const STRIX_CODEC_VERSION``
-----------------------------

.. CG-BLOCK id=const:STRIX_CODEC_VERSION lines=65-75

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 65-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_CODEC_VERSION

**What this does.** Sets ``STRIX_CODEC_VERSION`` to 1 — a single version byte stored just after the magic. This build reads exactly this version.

**Why it is here.** It is bumped only for a small change to the transform or header that the ``STRIXB1`` magic still describes; a genuinely incompatible container gets a new magic instead. The byte separates "same format, tiny tweak" from "different format".

.. CG-EXPLANATION-END id=const:STRIX_CODEC_VERSION

``const STRIX_HEADER_SIZE``
---------------------------

.. CG-BLOCK id=const:STRIX_HEADER_SIZE lines=76-77

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 76-77
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_HEADER_SIZE

**What this does.** Fixes the header length at 20 bytes. The comment tallies it: 7 for the magic, 1 for the version byte, 4 for the random seed, 4 for the checksum, and 4 for the plaintext length.

**Why it is here.** The header is a fixed-size block at the front of the file carrying everything the reader needs before the scrambled payload begins; writing its size once, as a named number, keeps the read and write code in step.

.. CG-EXPLANATION-END id=const:STRIX_HEADER_SIZE

``const OFFSET_VERSION``
------------------------

.. CG-BLOCK id=const:OFFSET_VERSION lines=78-78

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 78-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_VERSION

**What this does.** Records that the version byte sits at position 7 in the file — right after the seven magic bytes.

**Why it is here.** Naming each header field's position once, instead of scattering bare numbers through the code, stops a wrong offset from silently misreading the header.

.. CG-EXPLANATION-END id=const:OFFSET_VERSION

``const OFFSET_SEED``
---------------------

.. CG-BLOCK id=const:OFFSET_SEED lines=79-79

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 79-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_SEED

**What this does.** Records that the four-byte random seed sits at position 8 in the header.

**Why it is here.** One named position for the seed, so the writer and reader can never disagree about where it lives.

.. CG-EXPLANATION-END id=const:OFFSET_SEED

``const OFFSET_CRC``
--------------------

.. CG-BLOCK id=const:OFFSET_CRC lines=80-80

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 80-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_CRC

**What this does.** Records that the four-byte checksum sits at position 12 in the header.

**Why it is here.** One named position for the checksum, for the same reason as the other offsets.

.. CG-EXPLANATION-END id=const:OFFSET_CRC

``const OFFSET_PLAINTEXT_LEN``
------------------------------

.. CG-BLOCK id=const:OFFSET_PLAINTEXT_LEN lines=81-88

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 81-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:OFFSET_PLAINTEXT_LEN

**What this does.** Records that the four-byte plaintext length sits at position 16 in the header.

**Why it is here.** One named position for the stored length, used later as a sanity check that the decoded size matches what the writer recorded.

.. CG-EXPLANATION-END id=const:OFFSET_PLAINTEXT_LEN

``const STRIX_KEYSTREAM_SEED_FALLBACK``
---------------------------------------

.. CG-BLOCK id=const:STRIX_KEYSTREAM_SEED_FALLBACK lines=89-91

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 89-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_KEYSTREAM_SEED_FALLBACK

**What this does.** Defines a fixed non-zero number (the "golden-ratio scramble", two-to-the-32 divided by the golden ratio) to use in place of a seed of zero.

**Why it is here.** The comment records a real trap: the little random-number generator used below, if seeded with 0, emits nothing but zeros forever — which would leave the data unscrambled and pass the gzip signature through in the clear. Swapping a 0 seed for this constant closes that hole.

.. CG-EXPLANATION-END id=const:STRIX_KEYSTREAM_SEED_FALLBACK

``const STRIX_CORRUPT_MESSAGE``
-------------------------------

.. CG-BLOCK id=const:STRIX_CORRUPT_MESSAGE lines=92-98

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 92-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_CORRUPT_MESSAGE

**What this does.** The exact wording shown to the user when a file fails its integrity check: it explains the file is damaged, most likely corrupted on disk, and suggests re-saving from a still-open copy or restoring an earlier one.

**Why it is here.** An honest, specific message matters on this machine, whose memory corruption has scrambled a save mid-write; a vague "parse error" would hide what really happened.

.. CG-EXPLANATION-END id=const:STRIX_CORRUPT_MESSAGE

``const STRIX_TRUNCATED_MESSAGE``
---------------------------------

.. CG-BLOCK id=const:STRIX_TRUNCATED_MESSAGE lines=99-105

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 99-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_TRUNCATED_MESSAGE

**What this does.** The user wording for a file that ends before its contents were fully written — a partial or interrupted save.

**Why it is here.** Same honesty principle: naming the specific failure (truncated) tells the user it was an interrupted save, not a bug.

.. CG-EXPLANATION-END id=const:STRIX_TRUNCATED_MESSAGE

``const STRIX_UNKNOWN_FORMAT_MESSAGE``
--------------------------------------

.. CG-BLOCK id=const:STRIX_UNKNOWN_FORMAT_MESSAGE lines=106-115

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 106-115
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIX_UNKNOWN_FORMAT_MESSAGE

**What this does.** The user wording for a file written by a newer, unreadable build — it tells the user to update StrixGeo and try again.

**Why it is here.** Same principle again, and this one points the user straight at the fix (update).

.. CG-EXPLANATION-END id=const:STRIX_UNKNOWN_FORMAT_MESSAGE

``class StrixDecodeError``
--------------------------

.. CG-BLOCK id=class:StrixDecodeError lines=116-121

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 116-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixDecodeError

**What this does.** The shared base for every kind of decode failure. A "class" here is a labelled kind of error object; "abstract" means it is never thrown on its own, only its specific subclasses are. It requires each subclass to carry a stable ``code`` string (like ``strix-corrupt``).

**Why it is here.** Callers branch on the stable ``code``, never on the message text, so the wording can be reworded any time without breaking the code that reacts to a failure.

.. CG-EXPLANATION-END id=class:StrixDecodeError

``class StrixCorruptError``
---------------------------

.. CG-BLOCK id=class:StrixCorruptError lines=122-135

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 122-135
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixCorruptError

**What this does.** The specific error for a file that decoded but failed its integrity check. Its code is ``strix-corrupt``, and it can carry the underlying cause (for example a decompression failure) purely for the log.

**Why it is here.** The cause is kept for the log but never shown to the user — they see only the honest plain-English message.

.. CG-EXPLANATION-END id=class:StrixCorruptError

``class StrixTruncatedError``
-----------------------------

.. CG-BLOCK id=class:StrixTruncatedError lines=136-145

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 136-145
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixTruncatedError

**What this does.** The specific error for a file shorter than the container it claims to be — a partial write. Its code is ``strix-truncated``.

**Why it is here.** A distinct type lets the caller tell "interrupted save" apart from "damaged" or "too new" and word the message accordingly.

.. CG-EXPLANATION-END id=class:StrixTruncatedError

``class StrixUnknownFormatError``
---------------------------------

.. CG-BLOCK id=class:StrixUnknownFormatError lines=146-164

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 146-164
   :lineno-match:

.. CG-EXPLANATION-START id=class:StrixUnknownFormatError

**What this does.** The specific error for a StrixGeo container from a newer, unreadable version — or a file that is neither legacy JSON nor a StrixGeo container at all. Its code is ``strix-unknown-format``.

**Why it is here.** A distinct type lets the caller tell the user to update the app rather than reporting damage.

.. CG-EXPLANATION-END id=class:StrixUnknownFormatError

``interface StrixReadFailure``
------------------------------

.. CG-BLOCK id=interface:StrixReadFailure lines=165-179

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 165-179
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StrixReadFailure

**What this does.** Describes the shape of a decode failure once it has been flattened into a plain object for travel back to the web page — just a ``code`` and a user-honest ``message``. IPC (inter-process communication) is how the sandboxed web page and the main process exchange messages.

**Why it is here.** A thrown error class does NOT survive Electron's invoke-and-await across the process boundary with its type or code intact — only the message text crosses, wrapped. So the file-reading handler catches the typed error and returns this plain object instead, letting the web page branch on ``code`` and show the specific, honest message.

.. CG-EXPLANATION-END id=interface:StrixReadFailure

``type ProjectReadResult``
--------------------------

.. CG-BLOCK id=type:ProjectReadResult lines=180-192

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 180-192
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectReadResult

**What this does.** The result type of reading a project file across the boundary: either success carrying the plaintext ``json``, or failure carrying a ``StrixReadFailure``. A type that is one-thing-OR-another like this, with an ``ok`` flag saying which, is called a discriminated union.

**Why it is here.** It separates the answers the user needs worded (damaged / truncated / too new) from genuinely exceptional cases: the docstring notes that path-authorisation refusals and real I/O errors still throw, because those are a renderer bug or a vanished file, not a "this file is unreadable" answer.

.. CG-EXPLANATION-END id=type:ProjectReadResult

``function toStrixReadFailure``
-------------------------------

.. CG-BLOCK id=function:toStrixReadFailure lines=193-213

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 193-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:toStrixReadFailure

**What this does.** Turns a caught error into a ``StrixReadFailure`` if it is one of our typed decode errors, and otherwise re-throws it unchanged.

**Why it is here.** Only our own decode errors become a worded failure the user sees; anything else is an unexpected bug and must propagate rather than be silently swallowed.

.. CG-EXPLANATION-END id=function:toStrixReadFailure

``function strixKeystream``
---------------------------

.. CG-BLOCK id=function:strixKeystream lines=214-243

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 214-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:strixKeystream

**What this does.** Produces a run of pseudo-random bytes — a "keystream" — of a requested length from a 32-bit starting number (the "seed"). It uses a tiny, fully documented generator called xorshift32 (a well-known method that shifts and XORs a number to churn out the next one), stepped once per byte, folding the four bytes of its internal state into each output byte. It is pure integer arithmetic, and a seed of 0 falls back to the fixed constant above.

**Why it is here.** This is the keystream for the simple add-the-bytes scramble, NOT a secure random generator — its only jobs are to be deterministic (the same seed always gives the same bytes) and reversible. It is exported on its own so the tests can pin it against fixed, known byte vectors.

.. CG-EXPLANATION-END id=function:strixKeystream

``function applyKeystream``
---------------------------

.. CG-BLOCK id=function:applyKeystream lines=244-267

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 244-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyKeystream

**What this does.** Adds or subtracts the keystream to a block of bytes, one byte at a time, wrapping around at 256. A sign of ``+1`` scrambles (encode), ``-1`` unscrambles (decode).

**Why it is here.** The transform never looks at the data values, only at each byte's position, so subtracting the same keystream perfectly undoes adding it. The ``+ 256`` before the wrap keeps the subtract path from tripping over how JavaScript handles negative numbers.

.. CG-EXPLANATION-END id=function:applyKeystream

``function encodeStrix``
------------------------

.. CG-BLOCK id=function:encodeStrix lines=268-297

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 268-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:encodeStrix

**What this does.** Turns plaintext project JSON into the binary ``.strix`` container. It computes a CRC-32 checksum of the plaintext, gzip-compresses it, draws a fresh random seed (unless one is passed in for tests), fills in the 20-byte header (magic, version, seed, checksum, plaintext length), scrambles the compressed bytes with the keystream, and joins the header and payload into one buffer ready to write to disk.

**Why it is here.** It only WRAPS what the existing writer already produced — it never changes the JSON itself. Drawing a fresh random seed on every save means two saves of identical content look different byte-for-byte on disk, yet both decode back to exactly the same JSON.

.. CG-EXPLANATION-END id=function:encodeStrix

``function looksLikeLegacyJson``
--------------------------------

.. CG-BLOCK id=function:looksLikeLegacyJson lines=298-308

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 298-308
   :lineno-match:

.. CG-EXPLANATION-START id=function:looksLikeLegacyJson

**What this does.** Answers "is this an old plain-JSON file?" by skipping any leading spaces, tabs or newlines and checking whether the first real byte is an opening brace ``{``.

**Why it is here.** Every ``.strix`` and ``.gmproj`` written before this codec is pretty-printed JSON starting with ``{``, and that path must keep opening forever. The comment records a pre-existing limitation — a byte-order mark placed before the brace is not treated as whitespace — that is not a regression, because such a file never opened under the old reader either.

.. CG-EXPLANATION-END id=function:looksLikeLegacyJson

``function startsWith``
-----------------------

.. CG-BLOCK id=function:startsWith lines=309-343

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 309-343
   :lineno-match:

.. CG-EXPLANATION-START id=function:startsWith

**What this does.** A small helper that answers whether a byte array begins with a given prefix of bytes.

**Why it is here.** It factors out the byte-by-byte comparison so the magic-bytes check in the reader below reads as one clear line rather than an inline loop.

.. CG-EXPLANATION-END id=function:startsWith

``function decodeStrix``
------------------------

.. CG-BLOCK id=function:decodeStrix lines=344-404

.. literalinclude:: ../../../desktop/src/main/strixCodec.ts
   :language: typescript
   :lines: 344-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:decodeStrix

**What this does.** The reader. It sniffs the input in order: if it looks like legacy plain JSON, return it verbatim; if it does not start with our magic, throw the unknown-format error; if it is too short to even hold the header, throw the truncated error; if the version byte is one we do not know, throw unknown-format. Otherwise it reads the seed, checksum and length from the header, un-scrambles the payload with the keystream, decompresses it with gzip (optionally refusing to inflate past a size ceiling), and checks the decompressed length and CRC against the header before returning the plaintext JSON.

**Why it is here.** The sniff keeps every old file opening forever while still recognising newer ones cleanly. The optional decompression ceiling defends against a "decompression bomb" — a tiny hostile file that inflates to gigabytes and exhausts memory — because a ``.strix`` is a portable file a colleague can hand you. Every failure is turned into ONE of the typed errors so a caller on the open or restore path can degrade gracefully, and the checksum re-check is exactly what catches this machine's documented memory corruption.

.. CG-EXPLANATION-END id=function:decodeStrix

