# apps/api/models.py
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    first_name: str = Field(default="")
    password_hash: str
    # The first account created through the UI becomes the instance administrator;
    # existing databases get their oldest user promoted on boot (see
    # _backfill_first_admin). Admins manage accounts and the self-registration switch.
    is_admin: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AppSetting(SQLModel, table=True):
    """Instance-wide settings an admin can flip from the UI. Stored as strings so a
    new setting never needs a schema change; see _get_setting/_set_setting."""
    key: str = Field(primary_key=True)
    value: str


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


class InstallationShare(SQLModel, table=True):
    """Grants a second account access to someone else's installation. The owner
    (Installation.user_id) is never a row here — ownership is implicit and always
    outranks a share. Roles:

    - "viewer": read everything (dashboard, history, recommendations).
    - "editor": read, plus log measurements, treatments and maintenance.

    Configuration — renaming, target ranges, maintenance tasks, sharing itself
    and deletion — stays with the owner in every case."""
    __table_args__ = (UniqueConstraint("installation_id", "user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    installation_id: int = Field(foreign_key="installation.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role: str = Field(default="viewer")  # "viewer" | "editor"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MaintenanceTask(SQLModel, table=True):
    """A maintenance task for one installation. Completing a task means logging
    an Action whose action_type is one of this task's action_types; "due" is
    derived (interval_days minus days since the last such action) and never
    stored.

    There is one kind of task. A new installation is seeded with a default set
    for its type, but those rows are ordinary: rename, retime, re-icon, disable
    or delete any of them. `builtin_key` is only a hint that a label is one of
    the seeded ones and can be translated; it is cleared the moment the label is
    edited, and clients fall back to `label`.

    Since issue #51 these tasks are also the only taxonomy of loggable actions:
    "add entry" offers a measurement or a maintenance entry, and the maintenance
    choices are exactly the installation's enabled tasks.

    interval_days=0 means "on demand" — the task can be logged and its last
    completion is tracked, but it never becomes due (e.g. "Add product")."""
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


class TreatmentProduct(SQLModel, table=True):
    """A product this installation can log a treatment with. Logging a treatment
    means adding something to the water — a sanitizer, a pH adjuster, an
    algaecide — and recording how much.

    Same doctrine as MaintenanceTask: a new installation is seeded with a
    default set for its type and sanitizer, but those rows are ordinary —
    rename, re-icon, re-unit, disable or delete any of them. `builtin_key` is
    only a hint that a label is one of the seeded ones and can be translated;
    it is cleared the moment the label is edited, and clients fall back to
    `label`.

    `param` and `dosage_product_id` are optional links into the chemistry side:
    `param` is the WATER_PARAMS key this product moves (so history can show
    what a treatment was aimed at), and `dosage_product_id` matches an id in
    dosage.TREATMENT_TABLE so a dosing recommendation can offer to log itself.
    Both are None on products with no meaningful link (clarifier, algaecide, …)
    and on custom products unless the user picks one."""
    id: Optional[int] = Field(default=None, primary_key=True)
    installation_id: int = Field(foreign_key="installation.id", index=True)
    builtin_key: Optional[str] = Field(default=None)  # e.g. "ph_increaser"; None = custom
    label: str = Field(default="")                     # display / fallback label
    icon: str = Field(default="mdi:beaker-plus")
    default_unit: str = Field(default="g")
    param: Optional[str] = Field(default=None)
    dosage_product_id: Optional[str] = Field(default=None)
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
    # Legacy read path: treatments logged before the per-installation catalog
    # existed point at the global Product table. Nothing writes it any more —
    # new treatments set treatment_id instead (see extract_history).
    product_id: Optional[int] = Field(default=None, foreign_key="product.id", index=True)
    treatment_id: Optional[int] = Field(default=None, foreign_key="treatmentproduct.id", index=True)
    # Snapshot of the treatment product's label at log time. The live catalog
    # label wins while the product exists (so a rename propagates through
    # history); this is what keeps an entry readable once the product is
    # deleted, which also clears treatment_id.
    treatment_label: str = ""
    qty: str = ""
    unit: str = ""
    # Free-text brand on top of the catalog choice, e.g. product "Algaecide",
    # brand "HTH Super". Only meaningful on treatments.
    brand: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
