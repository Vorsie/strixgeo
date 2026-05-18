"""Typographic normalisation of a stratigraphy description into a merge key.

Pure, no I/O. Lives in ``shared/`` (not ``application/``) so BOTH the
application seeder and the infrastructure DOV-formal-stratigraphy
codelist can import it without an infrastructure→application layer
violation or an import cycle. Relocated here 2026-05-18 when the #59
lexicon (infrastructure) became a second cross-layer consumer — the
"extract on the second copy, never reach across layers" rule.

``auto_populate_contacts_from_stratigraphy`` re-exports this name via
its ``__all__`` so its existing API-/application-/test-layer importers
keep working unchanged (those are all legal dependency directions; the
infra catalog is the one that must import from here directly).
"""

from __future__ import annotations

import re
import unicodedata

# A run of any non-alphanumeric (Unicode-aware) characters — punctuation,
# whitespace, underscores — collapsed to a single space by the normaliser.
_NON_ALNUM_RUN = re.compile(r"[\W_]+", re.UNICODE)


def normalize_formation_key(raw: str) -> str:
    """Canonicalise a stratigraphy description into a dedup / merge key.

    **Typographic-only normalisation** (owner directive, 2026-05-17 reversal).

    The two semantic steps that were present in the prior implementation —
    (a) dropping everything before the last ``:`` and (b) reducing to
    ``lid van <member>`` — have been REMOVED. Reason: both steps caused
    the machine to silently decide that two strings were the same unit when
    they were not, which is exactly the class of decision the owner
    reserved for the user's manual lumping tool.  After the reversal:

      * ``"Formatie van Aalter - Lid van Oedelem"`` and
        ``"Lid van Oedelem"`` are DISTINCT keys.
      * ``"Paleogeen: Formatie van Aalter"`` and
        ``"Tertiair: Formatie van Aalter"`` are DISTINCT keys.

    The only remaining normalisation is typographic — it collapses
    characters that are byte-distinct but visually identical, preventing
    accidental splits between boreholes where the same string was typed
    in two slightly different ways:

      * NFKC — folds NBSP (U+00A0) → regular space, en-dash (U+2013)
        and em-dash (U+2014) → ``-``, fullwidth / ligature forms.
      * ``casefold`` — Unicode-aware lower (handles non-ASCII letters).
      * Collapse every run of non-alphanumeric characters (punctuation,
        whitespace) to a single space; strip.

    Used ONLY as the merge / identity key inside the discover scan and
    the write path.  The raw first-seen description is still the display
    name and the persisted ``name``.

    Parameters
    ----------
    raw : str
        Raw (already ``.strip()``-ed) layer description or regional ref.

    Returns
    -------
    str
        The typographically normalised key.  An empty input returns an
        empty string; callers must guard against empty descriptions before
        calling this function.
    """
    # NFKC folds NBSP, en-dash, em-dash, ligatures, fullwidth chars.
    nfkc = unicodedata.normalize("NFKC", raw)
    # Casefold → Unicode-aware lower.  Collapse non-alnum runs → space.
    return _NON_ALNUM_RUN.sub(" ", nfkc.casefold()).strip()
