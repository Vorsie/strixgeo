"""Pure helpers for building an Alembic ``Config`` by hand.

Both places that set a DSN on a programmatically-built Alembic ``Config`` need
the same escaping, and getting it wrong is not a cosmetic bug — it is a crash
on exactly the DSNs the packaged app generates.
"""

from alembic.config import Config


def set_config_option(config: Config, name: str, value: str) -> None:
    """Set an Alembic Config option, escaping ``%`` so ConfigParser cannot choke on it.

    ``Config.set_main_option`` stores into a :class:`configparser.ConfigParser`,
    whose default interpolation treats a bare ``%`` as the start of a
    ``%(name)s`` substitution and raises :class:`ValueError` on anything else --
    including a percent-encoded segment of a URL (``%40``, ``%3A``, ...), which
    is precisely what a generated per-install password produces once it is
    URL-encoded into a DSN.

    Doubling ``%`` here is undone by the same interpolation on read
    (``get_main_option``), so the stored value round-trips byte-for-byte.

    Parameters
    ----------
    config : Config
        The Alembic configuration object to mutate.
    name : str
        Option name, e.g. ``"sqlalchemy.url"`` or ``"script_location"``.
    value : str
        Raw option value. Percent signs are escaped on the caller's behalf.

    Returns
    -------
    None
        The ``config`` is mutated in place.
    """
    config.set_main_option(name, value.replace("%", "%%"))
