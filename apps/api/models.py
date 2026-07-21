# apps/api/models.py
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    first_name: str = Field(default="")
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PasswordResetToken(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    token: str = Field(index=True, unique=True)
    expires_at: datetime
    used: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    type: str  # "seed" | "custom"
    unit_default: str


class Installation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str = Field(default="My pool")
    type: str = Field(default="pool")           # "pool" | "spa"
    sanitizer: str = Field(default="bromine")   # "bromine" | "chlorine" | "salt"
    volume: Optional[float] = Field(default=None)
    volume_unit: str = Field(default="L")       # "L" | "gal"
    temp_unit: str = Field(default="C")         # "C" | "F"
    salt_unit: str = Field(default="ppm")       # "ppm" | "g/L"
    conc_unit: str = Field(default="mg/L")      # "mg/L" | "ppm"
    hardness_unit: str = Field(default="ppm")     # "ppm" | "°dH" | "°f"
    # Optional contact / location info — free-text, used when managing several
    # pools at different addresses. All optional; no format validation.
    address: Optional[str] = Field(default=None)
    contact_name: Optional[str] = Field(default=None)
    phone: Optional[str] = Field(default=None)
    email: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    # Sparse per-installation overrides layered on top of WATER_PARAMS, e.g.
    # {"ph": {"ideal": [7.0, 7.6]}}. NULL/{} = no customization. Values are always
    # stored in canonical/metric units, independent of temp_unit/salt_unit/hardness_unit.
    range_overrides: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.now)


class MaintenanceTask(SQLModel, table=True):
    """A configurable maintenance task for one installation. Completing a task
    means logging an Action whose action_type is one of this task's
    action_types; "due" is derived (interval_days minus days since the last such
    action) and never stored. Built-in tasks carry a builtin_key so clients can
    localize their name; custom tasks (builtin_key=None) use `label` verbatim."""
    id: Optional[int] = Field(default=None, primary_key=True)
    installation_id: int = Field(foreign_key="installation.id", index=True)
    builtin_key: Optional[str] = Field(default=None)  # e.g. "ph_measurement"; None = custom
    label: str = Field(default="")                     # display / fallback label
    # action_types that count as completing this task; action_types[0] is logged
    # on "mark done".
    action_types: list = Field(default_factory=list, sa_column=Column(JSON))
    interval_days: int = Field(default=7)
    icon: str = Field(default="mdi:calendar-clock")
    enabled: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ApiKey(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    key_hash: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: Optional[datetime] = Field(default=None)


class Action(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    action_type: str
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    installation_id: Optional[int] = Field(default=None, foreign_key="installation.id", index=True)
    product_id: Optional[int] = Field(default=None, foreign_key="product.id", index=True)
    qty: str = ""
    unit: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
