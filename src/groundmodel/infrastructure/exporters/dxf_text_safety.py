"""Line-break sanitisation shared by the DXF exporters.

A DXF file is line-oriented — a group code on one line, its value on the next —
so a raw carriage-return or line-feed embedded in a string value splits the
record and corrupts the file. ezdxf backstops this with a plain
``assert "\\n" not in value`` at export time (``lldxf`` group-code writer). That
assertion is stripped by ``python -O``, so a packaged / optimised build would
silently emit a corrupt DXF instead of failing. We strip CR/LF ourselves,
BEFORE ezdxf sees the value, so the guard never depends on assertions being
enabled — for both layer names and TEXT content.
"""

from __future__ import annotations


def strip_dxf_line_breaks(text: str) -> str:
    """Return *text* with all carriage-returns and line-feeds removed.

    Parameters
    ----------
    text : str
        A string bound for a DXF layer name or TEXT value.

    Returns
    -------
    str
        The same string with every ``\\r`` and ``\\n`` deleted. Byte-identical
        for any string that carries no line break, so it is a no-op on the
        overwhelming-majority of real formation / investigation names.
    """
    return text.replace("\r", "").replace("\n", "")
