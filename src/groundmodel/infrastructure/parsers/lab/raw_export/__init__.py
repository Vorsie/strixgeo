"""Parsers for raw geotechnical lab exports (oedometer + triaxial raw data).

A lab program stores each test in a native file (``.OCT`` oedometer, ``.TRX``
triaxial, ``.ATT`` advanced triaxial) and renders text exports from it. These
parsers read the text exports that carry the per-reading measurement series,
recognised by their CONTENT (never by a program or file name):

* the incremental-loading oedometer control listing
  (``*-LstSMControleListing``),
* the oedometer stage export of the newer compression module, and
* the triaxial raw per-point dump (``cd.txt`` / ``cu.txt`` / ``advtx*.txt``).

A file that is none of these is refused with
``LabFileFormatNotRecognisedError`` (owner ruling 2026-09-30: a generic
importer; an unknown format asks the user to contact the StrixGeo dev team).

Both return plain dataclasses and ``ValidationIssue`` findings; no ORM.
"""
