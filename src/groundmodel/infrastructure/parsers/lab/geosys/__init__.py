"""Parsers for the Geosys lab-software exports (oedometer + triaxial raw data).

Geosys is the program the owner's geotechnical lab runs; it stores each test
in a native file (``.OCT`` oedometer, ``.TRX`` triaxial, ``.ATT`` advanced
triaxial) and renders text exports from it. These parsers read the two text
exports that carry the per-reading measurement series:

* the oedometer control listing (``*-LstSMControleListing``), and
* the triaxial per-point dump (``cd.txt`` / ``cu.txt`` / ``advtx*.txt``).

Both return plain dataclasses and ``ValidationIssue`` findings; no ORM.
"""
