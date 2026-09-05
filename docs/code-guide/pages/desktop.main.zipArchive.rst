desktop.main.zipArchive
=======================

.. CG-PAGE source=desktop/src/main/zipArchive.ts complete=true

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

**What this does.** The opening triple-slash comment is the file's docstring — a plain note to whoever reads the code. It explains this file is a tiny ZIP writer running in Electron's main process — the part of the desktop app with full computer access (files, windows, launching other programs), as opposed to the renderer, the sandboxed web page the user sees. A zip archive is a single file that bundles many files together, usually compressed to take less space. The note lists what this writer deliberately does NOT support (only one disk, no huge-file 'ZIP64' mode, no passwords, no folder entries, files kept either raw or compressed) and sketches the byte layout it produces. The one code line, the import, pulls two ready-made tools out of Node's built-in 'zlib' toolbox: 'deflateRawSync' (the DEFLATE compressor) and 'crc32' (a checksum calculator).

**Why it is here.** A crash bundle sent back by a tester should be a real ``.zip`` they can double-click and attach to a support message. Rather than add an outside library just to make zip files — a new thing to install, unpack from the app, and keep audited — this file builds the format by hand out of tools Node already ships. DEFLATE is the standard zip compression method; a checksum is a small number computed from a file's bytes so a reader can tell the file arrived intact, and CRC-32 is the particular 32-bit checksum the zip format uses. The scope is kept to the smallest thing that still produces a valid archive — enough to pack 'a handful of log files' and no more; if a future need outgrows it, the note says take the real dependency instead of growing this. A companion test reads the result back independently, and even has Windows' own unzipper check it, so a writer bug cannot hide behind a matching reader bug.

.. CG-EXPLANATION-END id=module-header

``interface ZipEntry``
----------------------

.. CG-BLOCK id=interface:ZipEntry lines=34-40

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 34-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ZipEntry

**What this does.** Describes the shape of one file to place in the archive: a ``name`` (what the file is called inside the zip, using forward slashes if it sits in a sub-folder) and its ``data`` (the file's content — either text or raw bytes). An interface is just a written description of the fields a value must carry.

**Why it is here.** It gives the rest of the file, and every caller, one agreed vocabulary for 'a file going into the zip', so the packing loop can take a plain list of these and not care where each one came from.

.. CG-EXPLANATION-END id=interface:ZipEntry

``const LOCAL_HEADER_SIGNATURE``
--------------------------------

.. CG-BLOCK id=const:LOCAL_HEADER_SIGNATURE lines=41-41

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 41-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOCAL_HEADER_SIGNATURE

**What this does.** A fixed magic number, ``0x04034b50``, that marks the start of each file's record inside the archive. In this format a signature is a fixed sequence of bytes the ZIP specification requires at the front of a section so a reader knows what follows.

**Why it is here.** The published ZIP file format requires this exact marker before every stored file; writing the agreed number is what makes the output a real zip that any unzip tool recognises.

.. CG-EXPLANATION-END id=const:LOCAL_HEADER_SIGNATURE

``const CENTRAL_HEADER_SIGNATURE``
----------------------------------

.. CG-BLOCK id=const:CENTRAL_HEADER_SIGNATURE lines=42-42

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 42-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:CENTRAL_HEADER_SIGNATURE

**What this does.** The fixed marker, ``0x02014b50``, that begins each file's entry in the archive's 'central directory' — the table of contents near the end of a zip that lists every file it holds.

**Why it is here.** Same reasoning as the other markers: the format mandates this exact value at the head of every catalogue entry, so an unzipper can read the table of contents.

.. CG-EXPLANATION-END id=const:CENTRAL_HEADER_SIGNATURE

``const EOCD_SIGNATURE``
------------------------

.. CG-BLOCK id=const:EOCD_SIGNATURE lines=43-45

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 43-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:EOCD_SIGNATURE

**What this does.** The fixed marker, ``0x06054b50``, that begins the 'end of central directory' record — the very last block of a zip, which records how many files there are and where the table of contents starts.

**Why it is here.** Unzip tools find their bearings by scanning for this end marker first, so it must carry exactly the value the format defines or the archive is unreadable.

.. CG-EXPLANATION-END id=const:EOCD_SIGNATURE

``const VERSION_NEEDED``
------------------------

.. CG-BLOCK id=const:VERSION_NEEDED lines=46-48

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:VERSION_NEEDED

**What this does.** Sets ``VERSION_NEEDED`` to 20, recorded on every entry as 'the lowest ZIP version an unzipper needs to read this file'; 20 stands for version 2.0.

**Why it is here.** Version 2.0 is the earliest that understands DEFLATE compression, which this writer uses, so stating it tells the reader exactly what capability is required — no more, no less.

.. CG-EXPLANATION-END id=const:VERSION_NEEDED

``const FLAG_UTF8_NAMES``
-------------------------

.. CG-BLOCK id=const:FLAG_UTF8_NAMES lines=49-50

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 49-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:FLAG_UTF8_NAMES

**What this does.** Sets ``FLAG_UTF8_NAMES`` to ``0x0800`` — bit 11 of a zip entry's flags, whose meaning is 'this file's name is written in UTF-8'. UTF-8 is the standard way to store text of any language as bytes.

**Why it is here.** File names here are written as UTF-8 bytes, so flipping this flag tells the unzipper to read them that way and a name with accented or non-English characters comes out correct.

.. CG-EXPLANATION-END id=const:FLAG_UTF8_NAMES

``const METHOD_STORE``
----------------------

.. CG-BLOCK id=const:METHOD_STORE lines=51-51

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:METHOD_STORE

**What this does.** The number 0 — the ZIP code for 'stored', meaning a file kept exactly as-is with no compression.

**Why it is here.** The archive records, per file, how it was packed; 0 is the value that means 'just the raw bytes', used when compressing would not actually make the file smaller.

.. CG-EXPLANATION-END id=const:METHOD_STORE

``const METHOD_DEFLATE``
------------------------

.. CG-BLOCK id=const:METHOD_DEFLATE lines=52-54

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:METHOD_DEFLATE

**What this does.** The number 8 — the ZIP code for 'deflated', meaning a file squeezed with the DEFLATE compression method.

**Why it is here.** Same idea as the store code: the writer stamps 8 on any file it actually compressed so the unzipper knows to un-squeeze it on the way out.

.. CG-EXPLANATION-END id=const:METHOD_DEFLATE

``const DOS_EPOCH_YEAR``
------------------------

.. CG-BLOCK id=const:DOS_EPOCH_YEAR lines=55-57

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:DOS_EPOCH_YEAR

**What this does.** Sets ``DOS_EPOCH_YEAR`` to 1980 — the earliest year the zip format's old MS-DOS-style date field can express.

**Why it is here.** ZIP stores each file's timestamp in a cramped layout inherited from MS-DOS that counts years from 1980, so no earlier date fits; naming this floor lets the timestamp helper clamp anything older up to it instead of writing a broken date.

.. CG-EXPLANATION-END id=const:DOS_EPOCH_YEAR

``function dosTimestamp``
-------------------------

.. CG-BLOCK id=function:dosTimestamp lines=58-66

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:dosTimestamp

**What this does.** Turns an ordinary date into the two packed 16-bit numbers the zip format uses for a file's date and time. It clamps the year up to 1980 if older, then bit-packs year, month and day into one number and hours, minutes and (two-second) seconds into another.

**Why it is here.** Every file record must carry its modification date in this exact cramped MS-DOS layout; doing the fiddly bit-packing once in a named helper keeps the two places that write it (the per-file record and the catalogue entry) from each re-deriving it and drifting apart.

.. CG-EXPLANATION-END id=function:dosTimestamp

``function compress``
---------------------

.. CG-BLOCK id=function:compress lines=67-99

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 67-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:compress

**What this does.** Decides how to store one file's bytes. An empty file is kept as-is; otherwise it runs DEFLATE and compares — if the compressed form is genuinely smaller it uses that (method 'deflate'), and if compression did not help it keeps the raw bytes (method 'store').

**Why it is here.** Some inputs (already-compressed data, or just a few bytes) come out bigger after DEFLATE. Picking the smaller of the two per file keeps the archive honest about its own size and never bloats a file by 'compressing' it.

.. CG-EXPLANATION-END id=function:compress

``function createZipArchive``
-----------------------------

.. CG-BLOCK id=function:createZipArchive lines=100-170

.. literalinclude:: ../../../desktop/src/main/zipArchive.ts
   :language: typescript
   :lines: 100-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:createZipArchive

**What this does.** The one public function. It takes the list of files (and an optional timestamp) and returns the finished archive as one block of bytes. For each file it refuses a duplicate name, computes the CRC-32 checksum, picks store-or-deflate, and writes both a local record (header, name, data) and a catalogue entry, tracking byte offsets as it goes. It finishes by writing the central directory and the end-of-directory record, then joins everything into one buffer.

**Why it is here.** This is the whole point of the file — assemble a specification-correct zip in memory, ready to hand back to whatever is building a support bundle. It rejects two files sharing a name because such an archive unpacks differently depending on the tool, which is never what a support bundle wants; and the optional fixed timestamp lets a test get byte-for-byte identical output on every run.

.. CG-EXPLANATION-END id=function:createZipArchive

