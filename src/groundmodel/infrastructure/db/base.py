"""SQLAlchemy declarative base shared by all ORM models."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Project-wide declarative base — all ORM models inherit from this.

    No abstract methods are defined here because SQLAlchemy enforces the contract
    through its own metaclass machinery: every subclass *must* declare a
    ``__tablename__: str`` and at least one ``Mapped[...]`` primary-key column, or
    SQLAlchemy raises ``InvalidRequestError`` at class-definition time.  Adding a
    Python ABC on top would conflict with that metaclass.
    """
