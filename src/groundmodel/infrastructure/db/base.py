"""SQLAlchemy declarative base shared by all ORM models."""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Project-wide declarative base — all ORM models inherit from this."""
