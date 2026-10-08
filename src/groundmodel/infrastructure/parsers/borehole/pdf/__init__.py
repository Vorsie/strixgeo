"""Borehole-log PDF digitiser: triage, layout profiles, sheet reading, per-borehole parse.

The sibling of the CPT digitiser (``parsers/cpt/pdf``): it reuses that
package's word, OCR, cache and header helpers by import. Phase 1 is offline
tooling (``borehole_pdf_cli``); see ``docs/parsers-borehole-pdf.md``.
"""
