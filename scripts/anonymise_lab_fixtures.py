"""Strip personal and client names from the raw lab-export fixtures (repeatable).

Owner ruling 2026-09-29: "yeah remove all names". The lab exports carry the
client contact the report is for ("Rapport bij"), the site / client reference
("Herkomst en kenmerk", also glued onto the oedometer listing's title line) and
the usernames of the lab staff who created or last modified the native file
("Aangemaakt door <user> op ...", "Aangepast door <user> op ...").

This script replaces each of those VALUES with a neutral placeholder and
leaves every other byte alone: same encoding, same line ends, same delimiters,
same column layout, so the parsers read the anonymised files exactly as they
read the originals. The rules are generic (label-driven), never a list of the
names themselves: a list of names in the repository would defeat the point.

Run it again on a fresh export before adding it as a fixture::

    uv run python scripts/anonymise_lab_fixtures.py tests/fixtures/lab

It is idempotent: a second run changes nothing.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# The placeholders. Neutral, ASCII, obviously not a real person or site.
CONTACT_PLACEHOLDER = "Contact, Placeholder"
SITE_PLACEHOLDER = "Site placeholder"
USER_PLACEHOLDER = "labuser"

# (compiled pattern, replacement) pairs applied line by line. Each keeps the
# label and its separator run (group 1) and swaps only the value.
_LINE_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    # Triaxial dump: "Rapport bij:<TAB><TAB>Name, First" (report addressee).
    (re.compile(r"^(Rapport bij\s*:?[\t; ]*)(\S.*?)(\s*)$"), rf"\g<1>{CONTACT_PLACEHOLDER}\g<3>"),
    # Every export: "Herkomst en kenmerk :;<site>" / "...:<TABs><site>" (origin
    # and client reference of the sample).
    (
        re.compile(r"^(Herkomst en kenmerk\s*:?[\t; ]*)(\S.*?)(\s*)$"),
        rf"\g<1>{SITE_PLACEHOLDER}\g<3>",
    ),
    # Oedometer listing title: "Controlelisting... - 20/0568-B7A/N002<site>, "
    # (the site is glued onto the sequence number).
    (
        re.compile(r"^(Controlelisting\S*\s*-\s*\d+/\d+-[^/]+/N\d+)(\S.*?)(\s*)$"),
        rf"\g<1>{SITE_PLACEHOLDER}\g<3>",
    ),
    # Lab staff usernames in the creation / modification stamps.
    (
        re.compile(r"(Aangemaakt door |Aangepast door )(\S+)( op )"),
        rf"\g<1>{USER_PLACEHOLDER}\g<3>",
    ),
)


def _encoding_of(raw: bytes) -> tuple[str, bytes]:
    """Return (codec, BOM) for a raw lab export.

    The control listings and point dumps are ISO-8859-1; the newer oedometer module writes
    UTF-8 with a byte-order mark. The BOM is returned so it is written back.
    """
    if raw.startswith(b"\xef\xbb\xbf"):
        return "utf-8", b"\xef\xbb\xbf"
    return "latin-1", b""


def anonymise_text(text: str) -> str:
    """Apply every rule to every line; line ends are preserved verbatim.

    Parameters
    ----------
    text : str
        The decoded file text.

    Returns
    -------
    str
        The text with names replaced by placeholders.
    """
    out: list[str] = []
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        ending = line[len(body) :]
        for pattern, replacement in _LINE_RULES:
            body = pattern.sub(replacement, body)
        out.append(body + ending)
    return "".join(out)


def anonymise_file(path: Path) -> bool:
    """Anonymise one file in place.

    Parameters
    ----------
    path : pathlib.Path
        A raw lab export.

    Returns
    -------
    bool
        True when the file changed.
    """
    raw = path.read_bytes()
    codec, bom = _encoding_of(raw)
    text = raw[len(bom) :].decode(codec)
    new = anonymise_text(text)
    if new == text:
        return False
    path.write_bytes(bom + new.encode(codec))
    return True


def main(argv: list[str]) -> int:
    """Anonymise every ``.txt`` / ``.csv`` file under the given folders.

    Parameters
    ----------
    argv : list[str]
        Folder paths (default: ``tests/fixtures/lab``).

    Returns
    -------
    int
        Process exit code (0).
    """
    roots = [Path(a) for a in argv] or [Path("tests/fixtures/lab")]
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.suffix.lower() not in {".txt", ".csv"} or not path.is_file():
                continue
            changed = anonymise_file(path)
            print(f"{'anonymised' if changed else 'unchanged '}  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
