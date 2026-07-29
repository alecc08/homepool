import copy
import hashlib
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlmodel import Session, SQLModel, select, text
from starlette.middleware.sessions import SessionMiddleware
from passlib.context import CryptContext

from database import engine, get_session
from dosage import compute_recommendations
from models import (
    Action,
    ApiKey,
    AppSetting,
    Installation,
    InstallationShare,
    MaintenanceTask,
    PasswordResetToken,
    Product,
    User,
)
from seeds import insert_seeds
from simulator import simulate_dosage, simulate_heating_energy
from water_params import (
    ON_DEMAND_INTERVAL,
    attach_status,
    compute_task_status,
    default_maintenance_tasks,
    encode_measurement_notes,
    extract_current_conditions,
    extract_history,
    is_measurement_task,
)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
limiter = Limiter(key_func=get_remote_address)

# ── Reference ranges per installation type ─────────────────────────────────

WATER_PARAMS: Dict[Tuple[str, str], Dict] = {
    ("pool", "bromine"): {
        "ph":     {"ideal": (7.2, 7.6), "acceptable": (6.8, 7.8)},
        "br":     {"ideal": (2.0, 5.0), "acceptable": (1.0, 10.0)},
        "tac":    {"ideal": (80, 180),  "acceptable": (60, 200)},
        "temp":   {"ideal": (24, 28),   "acceptable": (15, 35)},
        "hardness": {"ideal": (100, 500), "acceptable": (50, 1000)},
    },
    ("pool", "chlorine"): {
        "ph":     {"ideal": (7.2, 7.6), "acceptable": (6.8, 7.8)},
        "cl":     {"ideal": (1.0, 3.0), "acceptable": (0.5, 4.0)},
        "cc":     {"ideal": (0, 0.2),   "acceptable": (0, 0.5)},
        "tac":    {"ideal": (80, 180),  "acceptable": (60, 200)},
        "temp":   {"ideal": (24, 28),   "acceptable": (15, 35)},
        "hardness": {"ideal": (100, 500), "acceptable": (50, 1000)},
    },
    ("spa", "bromine"): {
        "ph":     {"ideal": (7.2, 7.6), "acceptable": (6.8, 7.8)},
        "br":     {"ideal": (3.0, 6.0), "acceptable": (2.0, 10.0)},
        "tac":    {"ideal": (80, 180),  "acceptable": (60, 200)},
        "temp":   {"ideal": (36, 40),   "acceptable": (30, 42)},
        "hardness": {"ideal": (100, 500), "acceptable": (50, 1000)},
    },
    ("spa", "chlorine"): {
        "ph":     {"ideal": (7.2, 7.6), "acceptable": (6.8, 7.8)},
        "cl":     {"ideal": (3.0, 5.0), "acceptable": (2.0, 6.0)},
        "cc":     {"ideal": (0, 0.2),   "acceptable": (0, 0.5)},
        "tac":    {"ideal": (80, 180),  "acceptable": (60, 200)},
        "temp":   {"ideal": (36, 40),   "acceptable": (30, 42)},
        "hardness": {"ideal": (100, 500), "acceptable": (50, 1000)},
    },
    # CYA and free-chlorine targets follow PoolMath/Trouble Free Pool guidance for
    # salt water generator (SWG) pools: SWG cells run more efficiently -- and lose
    # less chlorine to sunlight -- at a higher CYA (60-80 ppm) than a manually-dosed
    # pool, which in turn means free chlorine needs to sit meaningfully higher than
    # the traditional 1-3 ppm CDC-style band to stay effective at that CYA level.
    # TAC also runs lower than a manually-dosed pool (60-80 ppm vs. 80-180 ppm):
    # SWG cells electrolyze water in a way that steadily raises pH, and a lower
    # total alkalinity slows that rise, so SWG pools are intentionally run leaner
    # on TA rather than being flagged low against a non-SWG band.
    ("pool", "salt"): {
        "ph":     {"ideal": (7.2, 7.6),   "acceptable": (6.8, 7.8)},
        "salt":   {"ideal": (2700, 3400), "acceptable": (2500, 4500)},
        "cya":    {"ideal": (60, 80),     "acceptable": (30, 100)},
        "cl":     {"ideal": (3.0, 5.0),   "acceptable": (2.0, 6.0)},
        "cc":     {"ideal": (0, 0.2),     "acceptable": (0, 0.5)},
        "tac":    {"ideal": (60, 80),     "acceptable": (50, 100)},
        "temp":   {"ideal": (24, 28),     "acceptable": (15, 35)},
        "hardness": {"ideal": (100, 500),   "acceptable": (50, 1000)},
    },
    # Salt spas are far less standardized than salt pools; this band is an
    # approximation pending better field data. TAC follows the same lower SWG
    # band as salt pools, for the same pH-rise reasoning.
    ("spa", "salt"): {
        "ph":     {"ideal": (7.2, 7.6),   "acceptable": (6.8, 7.8)},
        "salt":   {"ideal": (2500, 3200), "acceptable": (2000, 4000)},
        "cya":    {"ideal": (30, 50),     "acceptable": (0, 80)},
        "cl":     {"ideal": (3.0, 5.0),   "acceptable": (2.0, 6.0)},
        "cc":     {"ideal": (0, 0.2),     "acceptable": (0, 0.5)},
        "tac":    {"ideal": (60, 80),     "acceptable": (50, 100)},
        "temp":   {"ideal": (36, 40),     "acceptable": (30, 42)},
        "hardness": {"ideal": (100, 500),   "acceptable": (50, 1000)},
    },
}


# Sane absolute bounds per param, used to validate per-installation range overrides.
# Mirrored (manually — bounds change far less often than ranges) into
# apps/web/src/paramGuidance.ts for instant client-side validation.
PARAM_BOUNDS: Dict[str, Tuple[float, float]] = {
    "ph": (0, 14),
    "cl": (0, 20),
    "br": (0, 20),
    "cc": (0, 10),
    "tac": (0, 500),
    "temp": (0, 50),
    "salt": (0, 10000),
    "cya": (0, 300),
    "hardness": (0, 2000),
}


def _merge_range_overrides(defaults: Dict, overrides: Optional[Dict]) -> Dict:
    """Deep-copies `defaults` (a WATER_PARAMS combo dict) and layers `overrides` on
    top of it. Only replaces a param/band that's already present in `defaults` —
    an override can never invent a new param key for a combo that doesn't have it."""
    merged = copy.deepcopy(defaults)
    if not overrides:
        return merged
    for param, bands in overrides.items():
        if param not in merged:
            continue
        for band, value in bands.items():
            if band not in merged[param]:
                continue
            merged[param][band] = tuple(value)
    return merged


# ── Helpers ────────────────────────────────────────────────────────────────

class AuthError(HTTPException):
    def __init__(self, detail: str = "Not authorized"):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _require_session_secret() -> str:
    secret = os.getenv("SESSION_SECRET")
    if not secret:
        raise RuntimeError("SESSION_SECRET missing")
    return secret


def _get_default_installation(user_id: int, session: Session) -> Optional[Installation]:
    return session.exec(
        select(Installation).where(Installation.user_id == user_id)
    ).first()


# ── Instance settings ──────────────────────────────────────────────────────

SETTING_ALLOW_REGISTRATION = "allow_registration"


def _get_bool_setting(session: Session, key: str, default: bool) -> bool:
    setting = session.get(AppSetting, key)
    if setting is None:
        return default
    return setting.value == "true"


def _set_bool_setting(session: Session, key: str, value: bool) -> None:
    setting = session.get(AppSetting, key)
    if setting is None:
        setting = AppSetting(key=key, value="true" if value else "false")
    else:
        setting.value = "true" if value else "false"
    session.add(setting)
    session.commit()


# ── Migrations ─────────────────────────────────────────────────────────────

def _ensure_user_id_column(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text("ALTER TABLE action ADD COLUMN IF NOT EXISTS user_id INTEGER"))
    session.commit()


def _ensure_first_name_column(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text("ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS first_name VARCHAR NOT NULL DEFAULT ''"))
    session.commit()


def _ensure_is_admin_column(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text(
        "ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    session.commit()


def _ensure_volume_columns(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS volume DOUBLE PRECISION"))
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS volume_unit VARCHAR NOT NULL DEFAULT 'L'"))
    session.commit()


def _ensure_measurement_unit_columns(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS temp_unit VARCHAR NOT NULL DEFAULT 'C'"))
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS salt_unit VARCHAR NOT NULL DEFAULT 'ppm'"))
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS conc_unit VARCHAR NOT NULL DEFAULT 'mg/L'"))
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS hardness_unit VARCHAR NOT NULL DEFAULT 'ppm'"))
    session.commit()


def _ensure_range_overrides_column(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    session.exec(text("ALTER TABLE installation ADD COLUMN IF NOT EXISTS range_overrides JSON"))
    session.commit()


def _ensure_contact_columns(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    for col in ("address", "contact_name", "phone", "email", "notes"):
        session.exec(text(f"ALTER TABLE installation ADD COLUMN IF NOT EXISTS {col} VARCHAR"))
    session.commit()


def _migrate_installations(session: Session) -> None:
    if engine.dialect.name != "postgresql":
        return

    # Add installation_id on action if missing
    session.exec(text("""
        ALTER TABLE action
        ADD COLUMN IF NOT EXISTS installation_id INTEGER
        REFERENCES installation(id)
    """))
    session.commit()

    # Index if missing
    session.exec(text("""
        CREATE INDEX IF NOT EXISTS ix_action_installation_id ON action(installation_id)
    """))
    session.commit()

    # For each user without an installation, create a default one
    users_without = session.exec(text("""
        SELECT u.id FROM "user" u
        WHERE NOT EXISTS (
            SELECT 1 FROM installation i WHERE i.user_id = u.id
        )
    """)).all()

    for row in users_without:
        uid = int(row[0])
        # NOT NULL columns must be listed explicitly: SQLModel Field(default=...) is a
        # Python-side default only, not a DB server_default, so raw SQL bypasses it. On
        # a brand-new database, create_all() creates these columns without a DEFAULT
        # clause (that only gets attached later by the ALTER TABLE migrations below,
        # which are no-ops here since the columns already exist) — omitting a value
        # would violate the NOT NULL constraint.
        session.exec(
            text("""
                INSERT INTO installation
                    (user_id, name, type, sanitizer, volume_unit, temp_unit, salt_unit, conc_unit, hardness_unit, created_at)
                VALUES
                    (:uid, 'My pool', 'pool', 'bromine', 'L', 'C', 'ppm', 'mg/L', 'ppm', NOW())
            """).bindparams(uid=uid)
        )
    if users_without:
        session.commit()

    # Reattach orphaned actions to the first installation of their user
    session.exec(text("""
        UPDATE action a
        SET installation_id = (
            SELECT i.id FROM installation i
            WHERE i.user_id = a.user_id
            LIMIT 1
        )
        WHERE a.installation_id IS NULL
        AND a.user_id IS NOT NULL
    """))
    session.commit()


def _backfill_first_admin(session: Session) -> None:
    """Makes sure an instance that already has accounts ends up with exactly one
    administrator, without anyone having to touch the environment: if nobody is
    flagged yet, the oldest account (lowest id) is promoted.

    This replaces the old ADMIN_EMAIL/ADMIN_PASSWORD bootstrap, which created an
    account on first boot and then silently ignored every later change to those
    variables — a password edited in .env after the first startup never took
    effect, and an edited email quietly produced a second, empty account. New
    instances now get their admin from the first account registered in the UI
    (see the register route).

    Also carries over that bootstrap's one useful side effect: attaching
    pre-multi-user actions (user_id IS NULL) to the admin."""
    admin = session.exec(select(User).where(User.is_admin == True)).first()  # noqa: E712
    if admin is None:
        admin = session.exec(select(User).order_by(User.id)).first()
        if admin is None:
            return  # fresh install — the first registration claims the role
        admin.is_admin = True
        session.add(admin)
        session.commit()
    session.exec(
        text("UPDATE action SET user_id = :user_id WHERE user_id IS NULL").bindparams(
            user_id=admin.id
        )
    )
    session.commit()


def _seed_maintenance_tasks_for_installation(
    session: Session, installation: Installation
) -> bool:
    """Gives a *task-less* installation the default set for its type. Returns
    whether anything was added; the caller commits.

    Only ever seeds when the installation has no tasks at all. There is no
    built-in/custom split any more — the seeded tasks are ordinary rows the owner
    can rename, retime, re-icon or delete — so "this key is missing" cannot be
    told apart from "the user deleted it", and topping up would resurrect
    deletions. The trade-off is deliberate: a default added in a future release
    reaches new installations only."""
    existing = session.exec(
        select(MaintenanceTask).where(
            MaintenanceTask.installation_id == installation.id
        )
    ).all()
    if existing:
        return False
    for sort_order, spec in enumerate(default_maintenance_tasks(installation.type)):
        session.add(
            MaintenanceTask(
                installation_id=installation.id,
                builtin_key=spec["builtin_key"],
                label=spec["label"],
                action_types=spec["action_types"],
                interval_days=spec["interval_days"],
                icon=spec["icon"],
                enabled=True,
                sort_order=sort_order,
            )
        )
    return True


def _seed_maintenance_tasks(session: Session) -> None:
    """Boot backfill: gives any installation that has no maintenance tasks the
    defaults for its type.

    Since issue #51 the maintenance tasks are the only taxonomy of loggable
    actions, so this is what gives databases created before that change a usable
    entry picker. It never touches an installation that already has tasks."""
    seeded = False
    for installation in session.exec(select(Installation)).all():
        seeded |= _seed_maintenance_tasks_for_installation(session, installation)
    if seeded:
        session.commit()


# ── Lifespan ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        _ensure_user_id_column(session)
        _ensure_first_name_column(session)
        _ensure_is_admin_column(session)
        _ensure_volume_columns(session)
        _ensure_measurement_unit_columns(session)
        _ensure_range_overrides_column(session)
        _ensure_contact_columns(session)
        insert_seeds(session)
        _backfill_first_admin(session)
        _migrate_installations(session)
        _seed_maintenance_tasks(session)
    yield


# ── App ────────────────────────────────────────────────────────────────────

# VERSION is written by release.yml on every release, in lockstep with the HA
# integration and web app — never hand-edit it.
_VERSION = (Path(__file__).parent / "VERSION").read_text().strip()

app = FastAPI(title="homepool API", version=_VERSION, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    lambda req, exc: JSONResponse({"detail": "Too many attempts, please try again later."}, status_code=429),
)

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8090")

_allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:8090"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.add_middleware(
    SessionMiddleware,
    secret_key=_require_session_secret(),
    same_site="strict",
    https_only=False,  # TODO: set True when HTTPS is configured
)


# ── Pydantic schemas ────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    first_name: str = ""
    is_admin: bool = False
    created_at: datetime


class AdminUserOut(BaseModel):
    id: int
    email: EmailStr
    first_name: str = ""
    is_admin: bool = False
    installation_count: int = 0
    created_at: datetime


class AdminUserPatchIn(BaseModel):
    is_admin: bool


class AdminSettingsOut(BaseModel):
    allow_registration: bool


class AdminSettingsPatchIn(BaseModel):
    allow_registration: Optional[bool] = None


class RegistrationStatusOut(BaseModel):
    # `first_run` lets the login page tell a brand-new instance apart from a
    # closed one: on an empty database registration is always allowed and the
    # account created claims the administrator role.
    open: bool
    first_run: bool


class RegisterIn(BaseModel):
    first_name: str
    email: EmailStr
    password: str


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    password: str


class UpdateProfileIn(BaseModel):
    first_name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class InstallationIn(BaseModel):
    name: str = "My pool"
    type: str = "pool"
    sanitizer: str = "bromine"
    volume: Optional[float] = None
    volume_unit: str = "L"
    temp_unit: str = "C"
    salt_unit: str = "ppm"
    conc_unit: str = "mg/L"
    hardness_unit: str = "ppm"
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class InstallationPatchIn(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    sanitizer: Optional[str] = None
    volume: Optional[float] = None
    volume_unit: Optional[str] = None
    temp_unit: Optional[str] = None
    salt_unit: Optional[str] = None
    conc_unit: Optional[str] = None
    hardness_unit: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class InstallationOut(BaseModel):
    id: int
    name: str
    type: str
    sanitizer: str
    # Defaults suit the create/patch routes, which only ever return an
    # installation to its own owner; the list route fills them in per row.
    role: str = "owner"
    owner_name: Optional[str] = None
    volume: Optional[float] = None
    volume_unit: str = "L"
    temp_unit: str = "C"
    salt_unit: str = "ppm"
    conc_unit: str = "mg/L"
    hardness_unit: str = "ppm"
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


# A field named `date` that also has a default cannot annotate itself as `date`:
# Python binds the class attribute (`date = None`) *before* evaluating the
# annotation, so `Optional[date]` silently resolves to Optional[None] and the
# field then rejects every value it is given. Annotate those with this alias.
DateT = date


class ActionIn(BaseModel):
    date: date
    action_type: str
    installation_id: Optional[int] = None
    product_id: Optional[int] = None
    qty: str = ""
    unit: str = ""
    notes: str = ""


class ParamValueOut(BaseModel):
    value: float
    date: date
    unit: Optional[str] = None
    # Added for the Home Assistant card's status dots/rails. Omitted (None) for
    # combos with no known range for that field — older API clients and the
    # HA card both tolerate their absence and fall back to a neutral display.
    status: Optional[str] = None  # "ok" | "warn" | "danger"
    ideal_min: Optional[float] = None
    ideal_max: Optional[float] = None
    acceptable_min: Optional[float] = None
    acceptable_max: Optional[float] = None


class CurrentConditionsOut(BaseModel):
    ph: Optional[ParamValueOut] = None
    chlorine: Optional[ParamValueOut] = None
    bromine: Optional[ParamValueOut] = None
    tac: Optional[ParamValueOut] = None
    hardness: Optional[ParamValueOut] = None
    salt: Optional[ParamValueOut] = None
    stabilizer: Optional[ParamValueOut] = None
    cc: Optional[ParamValueOut] = None
    temp: Optional[ParamValueOut] = None


class InstallationSummaryOut(BaseModel):
    id: int
    name: str
    type: str
    sanitizer: str


class ShareIn(BaseModel):
    email: EmailStr
    role: str = "viewer"


class SharePatchIn(BaseModel):
    role: str


class ShareOut(BaseModel):
    id: int
    user_id: int
    email: EmailStr
    first_name: str = ""
    role: str
    created_at: datetime


class MaintenanceTaskOut(BaseModel):
    # A maintenance task with its derived due status. `key` is stable across
    # renames (builtin_key or custom_<id>). builtin_key is a hint for localizing
    # an untouched seeded label — it is cleared on rename and confers no other
    # special status; clients translate on it when present and fall back to
    # `label`. days_until_due / last_date are None when the task has never been
    # logged, and days_until_due is always None when interval_days is 0 (an
    # on-demand task: loggable, but never scheduled and never overdue).
    id: int
    key: str
    builtin_key: Optional[str] = None
    label: str
    icon: str
    action_types: List[str]
    interval_days: int
    enabled: bool
    sort_order: int
    days_until_due: Optional[int] = None
    last_date: Optional[date] = None


class MaintenanceTaskIn(BaseModel):
    # Create a task. action_types defaults to [label] when omitted.
    # interval_days=0 creates an on-demand task (loggable, never due).
    label: str
    action_types: Optional[List[str]] = None
    interval_days: int = 7
    icon: str = "mdi:calendar-clock"


class MaintenanceTaskUpdateIn(BaseModel):
    label: Optional[str] = None
    action_types: Optional[List[str]] = None
    interval_days: Optional[int] = None
    icon: Optional[str] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class MaintenanceCompleteIn(BaseModel):
    # `date` backdates the completion — for logging something you did days ago
    # and forgot to record. Omitted means today.
    installation_id: Optional[int] = None
    task_id: int
    date: Optional[DateT] = None
    notes: str = ""


class HistoryEntryOut(BaseModel):
    # One row per logged action, across all three kinds. Measurement rows carry
    # the parsed param fields (ph, chlorine, …); treatment/maintenance rows
    # leave those None and rely on label/qty/unit/notes instead.
    date: date
    kind: str  # "measurement" | "treatment" | "maintenance"
    action_type: str
    label: str
    notes: str = ""
    qty: Optional[str] = None
    unit: Optional[str] = None
    ph: Optional[float] = None
    chlorine: Optional[float] = None
    bromine: Optional[float] = None
    tac: Optional[float] = None
    hardness: Optional[float] = None
    salt: Optional[float] = None
    stabilizer: Optional[float] = None
    cc: Optional[float] = None
    temp: Optional[float] = None


class MeasurementIn(BaseModel):
    date: Optional[DateT] = None
    ph: Optional[float] = None
    chlorine: Optional[float] = None
    bromine: Optional[float] = None
    tac: Optional[float] = None
    hardness: Optional[float] = None
    salt: Optional[float] = None
    stabilizer: Optional[float] = None
    cc: Optional[float] = None
    temp: Optional[float] = None
    notes: str = ""
    installation_id: Optional[int] = None


class MaintenanceIn(BaseModel):
    date: Optional[DateT] = None
    action_type: str
    notes: str = ""
    installation_id: Optional[int] = None


class SimulateDosageIn(BaseModel):
    param: str
    current_value: float
    target_value: float
    volume_L: float
    sanitizer: str = "chlorine"


class SimulateHeatingIn(BaseModel):
    volume_L: float
    current_temp_c: float
    target_temp_c: float
    efficiency: float = 0.9


class ActionOut(BaseModel):
    id: int
    date: date
    action_type: str
    user_id: Optional[int]
    installation_id: Optional[int]
    product_id: Optional[int]
    qty: str
    unit: str
    notes: str
    created_at: datetime


# ── Auth dependency ─────────────────────────────────────────────────────────

def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        is_admin=user.is_admin,
        created_at=user.created_at,
    )


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise AuthError()
    user = session.get(User, user_id)
    if not user:
        raise AuthError()
    return user


def _hash_api_key(key: str) -> str:
    # High-entropy random tokens (secrets.token_urlsafe), not user-chosen passwords —
    # a fast, unsalted hash is fine here and keeps per-request lookups cheap.
    return hashlib.sha256(key.encode()).hexdigest()


def get_current_user_by_api_key(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise AuthError()
    key = auth[len("Bearer "):].strip()
    if not key:
        raise AuthError()
    key_hash = _hash_api_key(key)
    api_key = session.exec(select(ApiKey).where(ApiKey.key_hash == key_hash)).first()
    if not api_key:
        raise AuthError()
    user = session.get(User, api_key.user_id)
    if not user:
        raise AuthError()
    api_key.last_used_at = datetime.now(timezone.utc)
    session.add(api_key)
    session.commit()
    return user


# ── Installation access ────────────────────────────────────────────────────
#
# Three levels, from an installation's owner (Installation.user_id) plus any
# InstallationShare rows pointing at it:
#
#   owner  — everything, including configuration, sharing and deletion
#   editor — read, plus logging measurements/treatments/maintenance
#   viewer — read only
#
# Routes pick their level through _get_installation_for_read /
# _get_installation_for_write / _get_owned_installation rather than comparing
# user ids themselves.

ROLE_OWNER = "owner"
ROLE_EDITOR = "editor"
ROLE_VIEWER = "viewer"
SHARE_ROLES = (ROLE_VIEWER, ROLE_EDITOR)
WRITE_ROLES = (ROLE_OWNER, ROLE_EDITOR)


def _installation_role(
    installation: Installation, user: User, session: Session
) -> Optional[str]:
    """The caller's role on `installation`, or None when they have no access."""
    if installation.user_id == user.id:
        return ROLE_OWNER
    share = session.exec(
        select(InstallationShare).where(
            InstallationShare.installation_id == installation.id,
            InstallationShare.user_id == user.id,
        )
    ).first()
    return share.role if share else None


def _accessible_installations(user: User, session: Session) -> List[Installation]:
    """Owned installations first, then shared ones — the order the installation
    picker shows them in, and the order default-installation resolution uses."""
    owned = session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all()
    shares = session.exec(
        select(InstallationShare).where(InstallationShare.user_id == user.id)
    ).all()
    shared = [
        installation
        for installation in (session.get(Installation, s.installation_id) for s in shares)
        if installation is not None
    ]
    return list(owned) + shared


def _get_installation_for_read(
    installation_id: int, user: User, session: Session
) -> Installation:
    """Fetches an installation the caller owns or has any share on; 404 otherwise."""
    installation = session.get(Installation, installation_id)
    if not installation or _installation_role(installation, user, session) is None:
        raise HTTPException(status_code=404, detail="Installation not found")
    return installation


def _get_installation_for_write(
    installation_id: int, user: User, session: Session
) -> Installation:
    """Fetches an installation the caller may log entries against. A viewer gets
    403 rather than 404 — they can see the installation, they just can't write to
    it, and saying so is more useful than pretending it doesn't exist."""
    installation = _get_installation_for_read(installation_id, user, session)
    if _installation_role(installation, user, session) not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Read-only access to this installation")
    return installation


def _get_owned_installation(
    installation_id: int,
    user: User,
    session: Session,
) -> Installation:
    """Fetches an installation and 404s unless it belongs to `user`. Used by
    everything only an owner may do: settings, target ranges, maintenance task
    configuration, sharing and deletion."""
    installation = session.get(Installation, installation_id)
    if not installation or installation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Installation not found")
    return installation


def _resolve_installation(
    installation_id: Optional[int],
    user: User,
    session: Session,
    require_write: bool = False,
) -> Optional[int]:
    """Resolves the installation a write/read should apply to: the given one if
    the caller has the required access, otherwise their default (owned first,
    then shared)."""
    if installation_id is not None:
        if require_write:
            _get_installation_for_write(installation_id, user, session)
        else:
            _get_installation_for_read(installation_id, user, session)
        return installation_id
    default = _get_default_installation(user.id, session)
    if default is not None:
        return default.id
    accessible = _accessible_installations(user, session)
    return accessible[0].id if accessible else None


# ── Health ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Auth ───────────────────────────────────────────────────────────────────

@app.post("/auth/login")
@limiter.limit("5/minute")
def login(payload: LoginIn, request: Request, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if not user or not _verify_password(payload.password, user.password_hash):
        raise AuthError("Invalid email or password")
    request.session["user_id"] = user.id
    return {"user": _user_out(user)}


@app.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


def _validate_password_strength(password: str) -> None:
    if len(password) < 8 or not any(c.isupper() for c in password) or not any(c.isdigit() for c in password):
        raise HTTPException(status_code=422, detail="Password must contain at least 8 characters, one uppercase letter, and one digit")


@app.get("/auth/registration-status", response_model=RegistrationStatusOut)
def registration_status(session: Session = Depends(get_session)):
    first_run = session.exec(select(User.id)).first() is None
    return RegistrationStatusOut(
        open=first_run or _get_bool_setting(session, SETTING_ALLOW_REGISTRATION, True),
        first_run=first_run,
    )


@app.post("/auth/register")
@limiter.limit("3/minute")
def register(payload: RegisterIn, request: Request, session: Session = Depends(get_session)):
    _validate_password_strength(payload.password)
    # The very first account always gets through, whatever the setting says — an
    # empty instance must never be un-registerable — and it becomes the admin.
    is_first = session.exec(select(User.id)).first() is None
    if not is_first and not _get_bool_setting(session, SETTING_ALLOW_REGISTRATION, True):
        raise HTTPException(status_code=403, detail="Registration is closed on this instance")
    if session.exec(select(User).where(User.email == payload.email)).first():
        raise HTTPException(status_code=409, detail="Email already in use")
    user = User(
        email=payload.email,
        first_name=payload.first_name.strip(),
        password_hash=_hash_password(payload.password),
        is_admin=is_first,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    # Create a default installation for the new user, seeded like any other —
    # otherwise a fresh account has an empty maintenance page (and nothing to
    # log as a maintenance entry) until the next API restart backfills it.
    installation = Installation(user_id=user.id)
    session.add(installation)
    session.commit()
    session.refresh(installation)
    _seed_maintenance_tasks_for_installation(session, installation)
    session.commit()
    request.session["user_id"] = user.id
    return {"user": _user_out(user)}


@app.post("/auth/forgot-password")
@limiter.limit("3/minute")
def forgot_password(payload: ForgotPasswordIn, request: Request, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if user:
        token = str(uuid.uuid4())
        reset = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        session.add(reset)
        session.commit()
        if os.getenv("DEBUG", "").lower() == "true":
            reset_link = f"{APP_BASE_URL}/#reset-password?token={token}"
            logging.debug("[RESET LINK] %s", reset_link)
    return {"ok": True}


@app.post("/auth/reset-password")
def reset_password(payload: ResetPasswordIn, session: Session = Depends(get_session)):
    reset = session.exec(
        select(PasswordResetToken).where(PasswordResetToken.token == payload.token)
    ).first()
    if not reset or reset.used:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    exp = reset.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user = session.get(User, reset.user_id)
    if not user:
        raise HTTPException(status_code=404)
    user.password_hash = _hash_password(payload.password)
    reset.used = True
    session.add(user)
    session.add(reset)
    session.commit()
    return {"ok": True}


# ── Profile ────────────────────────────────────────────────────────────────

@app.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"user": _user_out(user)}


@app.patch("/me")
def update_me(
    payload: UpdateProfileIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if payload.first_name is not None:
        user.first_name = payload.first_name.strip()
    if payload.new_password:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Current password required")
        if not _verify_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        _validate_password_strength(payload.new_password)
        user.password_hash = _hash_password(payload.new_password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"user": _user_out(user)}


@app.get("/me/api-key")
def get_api_key_status(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    existing = session.exec(select(ApiKey).where(ApiKey.user_id == user.id)).first()
    return {"exists": existing is not None}


@app.post("/me/api-key")
def create_api_key(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    existing = session.exec(select(ApiKey).where(ApiKey.user_id == user.id)).all()
    for k in existing:
        session.delete(k)
    session.flush()
    plaintext = secrets.token_urlsafe(32)
    api_key = ApiKey(user_id=user.id, key_hash=_hash_api_key(plaintext))
    session.add(api_key)
    session.commit()
    return {"key": plaintext}


@app.delete("/me/api-key", status_code=204)
def revoke_api_key(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    existing = session.exec(select(ApiKey).where(ApiKey.user_id == user.id)).all()
    for k in existing:
        session.delete(k)
    session.commit()


# ── Administration ─────────────────────────────────────────────────────────
#
# The first account registered through the UI becomes the administrator (see the
# register route); on a pre-existing database the oldest account is promoted at
# boot by _backfill_first_admin. Admins manage accounts and decide whether the
# instance accepts new self-registrations.

def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


def _count_admins(session: Session) -> int:
    return len(session.exec(select(User).where(User.is_admin == True)).all())  # noqa: E712


def _purge_user(session: Session, user: User) -> None:
    """Removes an account and everything hanging off it. There is no ON DELETE
    CASCADE in the schema, so every child row is deleted explicitly, deepest
    first, or the foreign keys would be left dangling."""
    installations = session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all()
    # Shares in both directions: those granted on their installations, and those
    # granted to them on someone else's.
    for share in session.exec(
        select(InstallationShare).where(InstallationShare.user_id == user.id)
    ).all():
        session.delete(share)
    for installation in installations:
        for share in session.exec(
            select(InstallationShare).where(
                InstallationShare.installation_id == installation.id
            )
        ).all():
            session.delete(share)
        for task in session.exec(
            select(MaintenanceTask).where(MaintenanceTask.installation_id == installation.id)
        ).all():
            session.delete(task)
        for action in session.exec(
            select(Action).where(Action.installation_id == installation.id)
        ).all():
            session.delete(action)
    session.flush()
    for installation in installations:
        session.delete(installation)
    # Actions this user logged elsewhere (or legacy rows with no installation).
    for action in session.exec(select(Action).where(Action.user_id == user.id)).all():
        session.delete(action)
    for key in session.exec(select(ApiKey).where(ApiKey.user_id == user.id)).all():
        session.delete(key)
    for token in session.exec(
        select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
    ).all():
        session.delete(token)
    session.delete(user)
    session.commit()


@app.get("/admin/users", response_model=List[AdminUserOut])
def admin_list_users(
    admin: User = Depends(get_current_admin),
    session: Session = Depends(get_session),
):
    users = session.exec(select(User).order_by(User.id)).all()
    return [
        AdminUserOut(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            is_admin=u.is_admin,
            installation_count=len(
                session.exec(select(Installation).where(Installation.user_id == u.id)).all()
            ),
            created_at=u.created_at,
        )
        for u in users
    ]


@app.patch("/admin/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: int,
    payload: AdminUserPatchIn,
    admin: User = Depends(get_current_admin),
    session: Session = Depends(get_session),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin and not payload.is_admin and _count_admins(session) <= 1:
        raise HTTPException(
            status_code=400, detail="The instance must keep at least one administrator."
        )
    target.is_admin = payload.is_admin
    session.add(target)
    session.commit()
    session.refresh(target)
    return AdminUserOut(
        id=target.id,
        email=target.email,
        first_name=target.first_name,
        is_admin=target.is_admin,
        installation_count=len(
            session.exec(select(Installation).where(Installation.user_id == target.id)).all()
        ),
        created_at=target.created_at,
    )


@app.delete("/admin/users/{user_id}", status_code=204)
def admin_delete_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    session: Session = Depends(get_session),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    if target.is_admin and _count_admins(session) <= 1:
        raise HTTPException(
            status_code=400, detail="The instance must keep at least one administrator."
        )
    _purge_user(session, target)


@app.get("/admin/settings", response_model=AdminSettingsOut)
def admin_get_settings(
    admin: User = Depends(get_current_admin),
    session: Session = Depends(get_session),
):
    return AdminSettingsOut(
        allow_registration=_get_bool_setting(session, SETTING_ALLOW_REGISTRATION, True)
    )


@app.patch("/admin/settings", response_model=AdminSettingsOut)
def admin_update_settings(
    payload: AdminSettingsPatchIn,
    admin: User = Depends(get_current_admin),
    session: Session = Depends(get_session),
):
    if payload.allow_registration is not None:
        _set_bool_setting(session, SETTING_ALLOW_REGISTRATION, payload.allow_registration)
    return AdminSettingsOut(
        allow_registration=_get_bool_setting(session, SETTING_ALLOW_REGISTRATION, True)
    )


# ── Products ───────────────────────────────────────────────────────────────

@app.get("/products")
def list_products(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return session.exec(select(Product)).all()


# ── Installations ──────────────────────────────────────────────────────────

def _owner_label(installation: Installation, session: Session) -> Optional[str]:
    owner = session.get(User, installation.user_id)
    if owner is None:
        return None
    return owner.first_name or owner.email


@app.get("/installations", response_model=List[InstallationOut])
def list_installations(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # Owned installations plus any shared with this account. `role` tells the UI
    # which affordances to show; `owner_name` labels shared ones in the picker.
    result: List[InstallationOut] = []
    for installation in _accessible_installations(user, session):
        role = _installation_role(installation, user, session)
        result.append(
            InstallationOut(
                **installation.model_dump(exclude={"user_id", "range_overrides"}),
                role=role,
                owner_name=None if role == ROLE_OWNER else _owner_label(installation, session),
            )
        )
    return result


@app.post("/installations", response_model=InstallationOut)
def create_installation(
    payload: InstallationIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = Installation(
        user_id=user.id,
        name=payload.name,
        type=payload.type,
        sanitizer=payload.sanitizer,
        volume=payload.volume,
        volume_unit=payload.volume_unit,
        temp_unit=payload.temp_unit,
        salt_unit=payload.salt_unit,
        conc_unit=payload.conc_unit,
        hardness_unit=payload.hardness_unit,
        address=payload.address,
        contact_name=payload.contact_name,
        phone=payload.phone,
        email=payload.email,
        notes=payload.notes,
    )
    session.add(installation)
    session.commit()
    session.refresh(installation)
    _seed_maintenance_tasks_for_installation(session, installation)
    session.commit()
    return installation


@app.patch("/installations/{installation_id}", response_model=InstallationOut)
def update_installation(
    installation_id: int,
    payload: InstallationPatchIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_owned_installation(installation_id, user, session)
    if payload.name is not None:
        installation.name = payload.name
    if payload.type is not None:
        installation.type = payload.type
    if payload.sanitizer is not None:
        installation.sanitizer = payload.sanitizer
    if payload.volume is not None:
        installation.volume = payload.volume
    if payload.volume_unit is not None:
        installation.volume_unit = payload.volume_unit
    if payload.temp_unit is not None:
        installation.temp_unit = payload.temp_unit
    if payload.salt_unit is not None:
        installation.salt_unit = payload.salt_unit
    if payload.conc_unit is not None:
        installation.conc_unit = payload.conc_unit
    if payload.hardness_unit is not None:
        installation.hardness_unit = payload.hardness_unit
    if payload.address is not None:
        installation.address = payload.address
    if payload.contact_name is not None:
        installation.contact_name = payload.contact_name
    if payload.phone is not None:
        installation.phone = payload.phone
    if payload.email is not None:
        installation.email = payload.email
    if payload.notes is not None:
        installation.notes = payload.notes
    session.add(installation)
    session.commit()
    session.refresh(installation)
    return installation


@app.delete("/installations/{installation_id}", status_code=204)
def delete_installation(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_owned_installation(installation_id, user, session)
    count = len(session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all())
    if count <= 1:
        raise HTTPException(status_code=400, detail="You must keep at least one installation.")
    # Cascade delete of the shares granted on it
    for share in session.exec(
        select(InstallationShare).where(InstallationShare.installation_id == installation_id)
    ).all():
        session.delete(share)
    # Cascade delete of attached actions
    for action in session.exec(select(Action).where(Action.installation_id == installation_id)).all():
        session.delete(action)
    # Cascade delete of maintenance tasks
    for task in session.exec(
        select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
    ).all():
        session.delete(task)
    session.delete(installation)
    session.commit()


# ── Sharing ────────────────────────────────────────────────────────────────
#
# An owner grants another *existing* account access to one of their installations
# by email — there is no invitation/token flow, which keeps a self-hosted
# instance simple: the person signs up (or already has an account) and the owner
# adds them. Recipients can remove their own share ("leave"), owners can revoke
# any of them.

@app.get("/installations/{installation_id}/shares", response_model=List[ShareOut])
def list_installation_shares(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_owned_installation(installation_id, user, session)
    shares = session.exec(
        select(InstallationShare).where(InstallationShare.installation_id == installation_id)
    ).all()
    result: List[ShareOut] = []
    for share in shares:
        recipient = session.get(User, share.user_id)
        if recipient is None:
            continue
        result.append(ShareOut(
            id=share.id,
            user_id=recipient.id,
            email=recipient.email,
            first_name=recipient.first_name,
            role=share.role,
            created_at=share.created_at,
        ))
    return result


@app.post("/installations/{installation_id}/shares", response_model=ShareOut)
def create_installation_share(
    installation_id: int,
    payload: ShareIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_owned_installation(installation_id, user, session)
    if payload.role not in SHARE_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {list(SHARE_ROLES)}")
    recipient = session.exec(select(User).where(User.email == payload.email)).first()
    if recipient is None:
        raise HTTPException(status_code=404, detail="No account with that email address")
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="You already own this installation")
    existing = session.exec(
        select(InstallationShare).where(
            InstallationShare.installation_id == installation_id,
            InstallationShare.user_id == recipient.id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Already shared with that account")
    share = InstallationShare(
        installation_id=installation_id, user_id=recipient.id, role=payload.role
    )
    session.add(share)
    session.commit()
    session.refresh(share)
    return ShareOut(
        id=share.id,
        user_id=recipient.id,
        email=recipient.email,
        first_name=recipient.first_name,
        role=share.role,
        created_at=share.created_at,
    )


@app.patch("/installations/{installation_id}/shares/{share_id}", response_model=ShareOut)
def update_installation_share(
    installation_id: int,
    share_id: int,
    payload: SharePatchIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_owned_installation(installation_id, user, session)
    if payload.role not in SHARE_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {list(SHARE_ROLES)}")
    share = session.get(InstallationShare, share_id)
    if not share or share.installation_id != installation_id:
        raise HTTPException(status_code=404, detail="Share not found")
    share.role = payload.role
    session.add(share)
    session.commit()
    session.refresh(share)
    recipient = session.get(User, share.user_id)
    return ShareOut(
        id=share.id,
        user_id=share.user_id,
        email=recipient.email,
        first_name=recipient.first_name,
        role=share.role,
        created_at=share.created_at,
    )


# Declared before /shares/{share_id} so "me" is matched by this route rather than
# failing to parse as a share id. Recipients can't list shares, so they have no
# id to pass — this is how they give up their own access.
@app.delete("/installations/{installation_id}/shares/me", status_code=204)
def leave_installation(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    share = session.exec(
        select(InstallationShare).where(
            InstallationShare.installation_id == installation_id,
            InstallationShare.user_id == user.id,
        )
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    session.delete(share)
    session.commit()


@app.delete("/installations/{installation_id}/shares/{share_id}", status_code=204)
def delete_installation_share(
    installation_id: int,
    share_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # The owner revoking a share. Recipients use DELETE .../shares/me instead.
    _get_owned_installation(installation_id, user, session)
    share = session.get(InstallationShare, share_id)
    if not share or share.installation_id != installation_id:
        raise HTTPException(status_code=404, detail="Share not found")
    session.delete(share)
    session.commit()


# Two-layer range model: WATER_PARAMS holds the hardcoded factory defaults per
# (type, sanitizer) combo; Installation.range_overrides holds a sparse, per-installation
# customization layered on top via _merge_range_overrides. GET .../params returns the
# merged ("effective") result — the only shape older/other consumers (InstallationContext)
# need to know about. GET .../params/full and PUT .../params expose the two layers
# separately, for the settings UI.

@app.get("/installations/{installation_id}/params")
def get_installation_params(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_installation_for_read(installation_id, user, session)
    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    return _merge_range_overrides(defaults, installation.range_overrides)


@app.get("/installations/{installation_id}/params/full")
def get_installation_params_full(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_installation_for_read(installation_id, user, session)
    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    overrides = installation.range_overrides or {}
    effective = _merge_range_overrides(defaults, overrides)
    result: Dict[str, Dict] = {}
    for param, bands in defaults.items():
        param_override = overrides.get(param, {})
        result[param] = {
            "default": {band: list(value) for band, value in bands.items()},
            "override": {band: list(value) for band, value in param_override.items()} or None,
            "effective": {band: list(value) for band, value in effective[param].items()},
        }
    return result


@app.get("/installations/{installation_id}/recommendations")
def get_installation_recommendations(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_installation_for_read(installation_id, user, session)
    cutoff = date.today() - timedelta(days=90)
    actions = session.exec(
        select(Action)
        .where(Action.installation_id == installation_id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(500)
    ).all()
    current = extract_current_conditions(actions, installation)
    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    ranges = _merge_range_overrides(defaults, installation.range_overrides)
    return {
        "volume_known": installation.volume is not None,
        "recommendations": compute_recommendations(current, ranges, installation),
    }


@app.post("/simulate/dosage")
def simulate_dosage_endpoint(
    payload: SimulateDosageIn,
    user: User = Depends(get_current_user),
):
    try:
        return simulate_dosage(
            payload.param, payload.current_value, payload.target_value,
            payload.volume_L, payload.sanitizer,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@app.post("/simulate/heating")
def simulate_heating_endpoint(
    payload: SimulateHeatingIn,
    user: User = Depends(get_current_user),
):
    return simulate_heating_energy(
        payload.volume_L, payload.current_temp_c, payload.target_temp_c, payload.efficiency,
    )


def _range_error(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


@app.put("/installations/{installation_id}/params")
def update_installation_params(
    installation_id: int,
    payload: Dict[str, Dict[str, List[float]]] = Body(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_owned_installation(installation_id, user, session)

    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})

    for param, bands in payload.items():
        if param not in defaults:
            raise _range_error(f"Unknown parameter for this installation: {param}")
        bounds = PARAM_BOUNDS.get(param)
        for band, value in bands.items():
            if band not in ("ideal", "acceptable"):
                raise _range_error(f"Unknown band for {param}: {band}")
            if len(value) != 2:
                raise _range_error(f"{param}.{band} must be [min, max]")
            lo, hi = value
            if lo >= hi:
                raise _range_error(f"{param}.{band}: min must be less than max")
            if bounds and (lo < bounds[0] or hi > bounds[1]):
                raise _range_error(f"{param}.{band} is outside allowed bounds {bounds}")

    new_effective = _merge_range_overrides(defaults, payload)
    for param, bands in new_effective.items():
        if "ideal" in bands and "acceptable" in bands:
            i_lo, i_hi = bands["ideal"]
            a_lo, a_hi = bands["acceptable"]
            if i_lo < a_lo or i_hi > a_hi:
                raise _range_error(f"{param}: ideal range must be within the acceptable range")

    installation.range_overrides = {
        param: {band: list(value) for band, value in bands.items()}
        for param, bands in payload.items()
    }
    session.add(installation)
    session.commit()
    session.refresh(installation)
    return _merge_range_overrides(defaults, installation.range_overrides)


# ── Maintenance tasks ──────────────────────────────────────────────────────
#
# Per-installation configurable maintenance. Each installation is seeded with
# its type's defaults (see _seed_maintenance_tasks_for_installation), but there
# is only one kind of task: every one of them — seeded or added later — can be
# enabled/disabled, retimed, relabelled, re-iconed or deleted. "Due" is derived
# from the action log, never stored (see compute_task_status).
#
# Since issue #51 the enabled tasks are also the list of things a client can log
# as a maintenance entry — there is no separate action-type taxonomy — and a
# task with interval_days=0 is "on demand": loggable, but never due.

def _installation_actions_for_status(session: Session, installation_id: int) -> List[Action]:
    cutoff = date.today() - timedelta(days=365)
    return session.exec(
        select(Action)
        .where(Action.installation_id == installation_id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(1000)
    ).all()


def _maintenance_status(session: Session, installation_id: int) -> List[Dict]:
    tasks = session.exec(
        select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
    ).all()
    actions = _installation_actions_for_status(session, installation_id)
    return compute_task_status(tasks, actions)


def _loggable_action_types(session: Session, installation_id: int) -> set:
    """Action types an installation accepts for a maintenance entry: the union of
    its enabled tasks' action_types, minus the measurement ones (logged through
    the measurement endpoint instead). Since issue #51 this is the whole
    taxonomy — there is no separate hardcoded action list any more."""
    tasks = session.exec(
        select(MaintenanceTask).where(
            MaintenanceTask.installation_id == installation_id,
            MaintenanceTask.enabled == True,  # noqa: E712
        )
    ).all()
    return {
        action_type
        for task in tasks
        if not is_measurement_task(task.action_types)
        for action_type in (task.action_types or [])
    }


def _lookup_task(installation_id: int, task_id: int, session: Session) -> MaintenanceTask:
    task = session.get(MaintenanceTask, task_id)
    if not task or task.installation_id != installation_id:
        raise HTTPException(status_code=404, detail="Maintenance task not found")
    return task


def _get_owned_task(
    installation_id: int, task_id: int, user: User, session: Session
) -> MaintenanceTask:
    """For configuring a task — owner only."""
    _get_owned_installation(installation_id, user, session)
    return _lookup_task(installation_id, task_id, session)


def _get_task_for_write(
    installation_id: int, task_id: int, user: User, session: Session
) -> MaintenanceTask:
    """For completing a task — an editor may mark maintenance done even though
    they cannot change how the task is configured."""
    _get_installation_for_write(installation_id, user, session)
    return _lookup_task(installation_id, task_id, session)


def _complete_maintenance_task(
    session: Session,
    user: User,
    task: MaintenanceTask,
    on: Optional[date] = None,
    notes: str = "",
) -> Action:
    """Logs a completion for a task: an Action with the task's primary
    action_type. Shared by the web and /v1 complete routes.

    `on` backdates the completion; the one-click "mark done" surfaces leave it
    None and get today."""
    action_type = (task.action_types or [task.label])[0]
    action = Action(
        date=on or date.today(),
        action_type=action_type,
        user_id=user.id,
        installation_id=task.installation_id,
        notes=notes,
        created_at=datetime.now(timezone.utc),
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action


@app.get("/installations/{installation_id}/maintenance", response_model=List[MaintenanceTaskOut])
def list_maintenance_tasks(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_installation_for_read(installation_id, user, session)
    return [MaintenanceTaskOut(**t) for t in _maintenance_status(session, installation_id)]


@app.post("/installations/{installation_id}/maintenance", response_model=MaintenanceTaskOut)
def create_maintenance_task(
    installation_id: int,
    payload: MaintenanceTaskIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_owned_installation(installation_id, user, session)
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="label is required")
    action_types = payload.action_types or [label]
    if payload.interval_days < ON_DEMAND_INTERVAL:
        raise HTTPException(status_code=422, detail="interval_days cannot be negative")
    max_order = session.exec(
        select(MaintenanceTask.sort_order).where(
            MaintenanceTask.installation_id == installation_id
        )
    ).all()
    task = MaintenanceTask(
        installation_id=installation_id,
        builtin_key=None,
        label=label,
        action_types=action_types,
        interval_days=payload.interval_days,
        icon=payload.icon,
        enabled=True,
        sort_order=(max(max_order) + 1) if max_order else 0,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    status_list = _maintenance_status(session, installation_id)
    match = next(t for t in status_list if t["id"] == task.id)
    return MaintenanceTaskOut(**match)


@app.patch(
    "/installations/{installation_id}/maintenance/{task_id}",
    response_model=MaintenanceTaskOut,
)
def update_maintenance_task(
    installation_id: int,
    task_id: int,
    payload: MaintenanceTaskUpdateIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = _get_owned_task(installation_id, task_id, user, session)
    if payload.label is not None:
        label = payload.label.strip()
        if not label:
            raise HTTPException(status_code=422, detail="label cannot be empty")
        if label != task.label:
            # builtin_key only says "this label is one of ours, translate it".
            # Once renamed, the stored label is what the user wants to see.
            task.builtin_key = None
        task.label = label
    if payload.action_types is not None:
        if not payload.action_types:
            raise HTTPException(status_code=422, detail="action_types cannot be empty")
        task.action_types = payload.action_types
    if payload.interval_days is not None:
        if payload.interval_days < ON_DEMAND_INTERVAL:
            raise HTTPException(status_code=422, detail="interval_days cannot be negative")
        task.interval_days = payload.interval_days
    if payload.icon is not None:
        task.icon = payload.icon
    if payload.enabled is not None:
        task.enabled = payload.enabled
    if payload.sort_order is not None:
        task.sort_order = payload.sort_order
    session.add(task)
    session.commit()
    session.refresh(task)
    status_list = _maintenance_status(session, installation_id)
    match = next(t for t in status_list if t["id"] == task.id)
    return MaintenanceTaskOut(**match)


@app.delete("/installations/{installation_id}/maintenance/{task_id}", status_code=204)
def delete_maintenance_task(
    installation_id: int,
    task_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # Every task is deletable, seeded defaults included — the boot backfill only
    # fills installations with no tasks at all, so a deletion sticks.
    task = _get_owned_task(installation_id, task_id, user, session)
    session.delete(task)
    session.commit()


@app.post(
    "/installations/{installation_id}/maintenance/{task_id}/complete",
    response_model=MaintenanceTaskOut,
)
def complete_maintenance_task(
    installation_id: int,
    task_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = _get_task_for_write(installation_id, task_id, user, session)
    _complete_maintenance_task(session, user, task)
    status_list = _maintenance_status(session, installation_id)
    match = next(t for t in status_list if t["id"] == task.id)
    return MaintenanceTaskOut(**match)


# ── Actions ────────────────────────────────────────────────────────────────

def _get_action_for_write(action_id: int, user: User, session: Session) -> Action:
    """An action can be edited or deleted by anyone with write access to the
    installation it belongs to — so a pool's owner can clean up entries an editor
    logged, and vice versa. Legacy rows with no installation fall back to
    "only the author", which is all the old ownership check could express."""
    action = session.get(Action, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.installation_id is None:
        if action.user_id != user.id:
            raise HTTPException(status_code=404, detail="Action not found")
        return action
    _get_installation_for_write(action.installation_id, user, session)
    return action


@app.get("/actions", response_model=List[ActionOut])
def list_actions(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    installation_id: Optional[int] = None,
    from_date: Optional[str] = None,
    limit: Optional[int] = 500,
):
    cutoff: date = date.fromisoformat(from_date) if from_date else date.today() - timedelta(days=90)

    if installation_id is not None:
        _get_installation_for_read(installation_id, user, session)
        return session.exec(
            select(Action)
            .where(Action.installation_id == installation_id, Action.date >= cutoff)
            .order_by(Action.date.desc())
            .limit(limit)
        ).all()

    # Backward compatibility: filter by user_id if installation_id is absent
    return session.exec(
        select(Action)
        .where(Action.user_id == user.id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(limit)
    ).all()


@app.post("/actions", response_model=ActionOut)
def create_action(
    payload: ActionIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    resolved_installation_id = _resolve_installation(
        payload.installation_id, user, session, require_write=True
    )
    action = Action(
        date=payload.date,
        action_type=payload.action_type,
        user_id=user.id,
        installation_id=resolved_installation_id,
        product_id=payload.product_id,
        qty=payload.qty,
        unit=payload.unit,
        notes=payload.notes,
        created_at=datetime.now(timezone.utc),
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action


@app.patch("/actions/{action_id}", response_model=ActionOut)
def update_action(
    action_id: int,
    payload: ActionIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    action = _get_action_for_write(action_id, user, session)
    action.date = payload.date
    action.action_type = payload.action_type
    action.product_id = payload.product_id
    action.qty = payload.qty
    action.unit = payload.unit
    action.notes = payload.notes
    if payload.installation_id is not None:
        resolved = _resolve_installation(
            payload.installation_id, user, session, require_write=True
        )
        action.installation_id = resolved
    session.add(action)
    session.commit()
    session.refresh(action)
    return action


@app.post("/import")
def import_actions(
    actions: List[ActionIn],
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    existing = session.exec(select(Action).where(Action.user_id == user.id)).all()
    for a in existing:
        session.delete(a)
    session.flush()
    default = _get_default_installation(user.id, session)
    default_id = default.id if default else None
    now = datetime.now(timezone.utc)
    for action_in in actions:
        inst_id = action_in.installation_id if action_in.installation_id is not None else default_id
        session.add(Action(
            date=action_in.date,
            action_type=action_in.action_type,
            user_id=user.id,
            installation_id=inst_id,
            product_id=action_in.product_id,
            qty=action_in.qty,
            unit=action_in.unit,
            notes=action_in.notes,
            created_at=now,
        ))
    session.commit()
    return {"imported": len(actions)}


@app.delete("/actions/{action_id}", status_code=204)
def delete_action(
    action_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    action = _get_action_for_write(action_id, user, session)
    session.delete(action)
    session.commit()


# ── Public API (Home Assistant, etc.) ──────────────────────────────────────
#
# Token-authenticated routes for external consumers. The read routes return
# pre-parsed measurement fields (see water_params.py) rather than raw Action
# rows, so callers don't need to understand the internal notes-encoding scheme.
# The write routes (/v1/measurements, /v1/maintenance) take the same
# pre-parsed shape and encode it into an Action server-side, for the same
# reason.

def _resolve_installation_for_api_key(
    installation_id: Optional[int],
    user: User,
    session: Session,
    require_write: bool = False,
) -> int:
    resolved = _resolve_installation(installation_id, user, session, require_write=require_write)
    if resolved is None:
        raise HTTPException(status_code=404, detail="No installation found")
    return resolved


@app.get("/v1/installations", response_model=List[InstallationSummaryOut])
@limiter.limit("60/minute")
def api_installations(
    request: Request,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    # Shared installations are listed too, so the Home Assistant integration of
    # someone a pool was shared with picks them up as devices. Writes through the
    # /v1 routes still respect the role — a viewer gets 403.
    return _accessible_installations(user, session)


@app.get("/v1/current", response_model=CurrentConditionsOut)
@limiter.limit("60/minute")
def api_current_conditions(
    request: Request,
    installation_id: Optional[int] = None,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(installation_id, user, session)
    installation = session.get(Installation, resolved_id)
    cutoff = date.today() - timedelta(days=90)
    actions = session.exec(
        select(Action)
        .where(Action.installation_id == resolved_id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(500)
    ).all()
    conditions = extract_current_conditions(actions, installation)
    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    ranges = _merge_range_overrides(defaults, installation.range_overrides)
    attach_status(conditions, ranges)
    return CurrentConditionsOut(**conditions)


@app.get("/v1/history", response_model=List[HistoryEntryOut])
@limiter.limit("60/minute")
def api_history(
    request: Request,
    installation_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    type: str = "all",  # "all" | "measurement" | "maintenance" | "treatment"
    limit: Optional[int] = 200,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(installation_id, user, session)
    cutoff: date = date.fromisoformat(from_date) if from_date else date.today() - timedelta(days=90)
    query = select(Action).where(
        Action.installation_id == resolved_id, Action.date >= cutoff
    )
    if to_date:
        query = query.where(Action.date <= date.fromisoformat(to_date))
    actions = session.exec(query.order_by(Action.date.desc()).limit(limit)).all()
    product_names = {p.id: p.name for p in session.exec(select(Product)).all()}
    entries = extract_history(actions, product_names)
    if type != "all":
        entries = [e for e in entries if e["kind"] == type]
    return [HistoryEntryOut(**entry) for entry in entries]


@app.get("/v1/todo", response_model=List[MaintenanceTaskOut])
@limiter.limit("60/minute")
def api_todo_status(
    request: Request,
    installation_id: Optional[int] = None,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    # Returns the installation's enabled maintenance tasks with derived due
    # status. The shape changed from the old fixed {ph_measurement,
    # filter_maintenance} object to a self-describing list when maintenance
    # became configurable — the HA integration ships in lockstep and consumes
    # the list directly.
    resolved_id = _resolve_installation_for_api_key(installation_id, user, session)
    status_list = _maintenance_status(session, resolved_id)
    return [MaintenanceTaskOut(**t) for t in status_list if t["enabled"]]


@app.post("/v1/measurements", response_model=ActionOut)
@limiter.limit("60/minute")
def api_create_measurement(
    request: Request,
    payload: MeasurementIn,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(
        payload.installation_id, user, session, require_write=True
    )
    fields = {
        "chlorine": payload.chlorine,
        "bromine": payload.bromine,
        "tac": payload.tac,
        "hardness": payload.hardness,
        "salt": payload.salt,
        "stabilizer": payload.stabilizer,
        "cc": payload.cc,
        "temp": payload.temp,
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    if payload.ph is None and not fields:
        raise HTTPException(status_code=422, detail="At least one measured value is required")

    encoded = encode_measurement_notes(fields)
    full_notes = ". ".join(part for part in [encoded, payload.notes] if part)
    action = Action(
        date=payload.date or date.today(),
        action_type="Measurement",
        user_id=user.id,
        installation_id=resolved_id,
        qty=str(payload.ph) if payload.ph is not None else "",
        unit="",
        notes=full_notes,
        created_at=datetime.now(timezone.utc),
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action


@app.post("/v1/maintenance/complete", response_model=MaintenanceTaskOut)
@limiter.limit("60/minute")
def api_complete_maintenance_task(
    request: Request,
    payload: MaintenanceCompleteIn,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    # "Mark done" for the HA per-task buttons: completes a task by id (logs its
    # primary action_type), so tasks with their own action types work without
    # the caller needing to know the string. Shares the completion path with the
    # web route. The HA `log_maintenance` service uses the same route with an
    # explicit date/notes to record something done days ago.
    resolved_id = _resolve_installation_for_api_key(
        payload.installation_id, user, session, require_write=True
    )
    task = session.get(MaintenanceTask, payload.task_id)
    if not task or task.installation_id != resolved_id:
        raise HTTPException(status_code=404, detail="Maintenance task not found")
    _complete_maintenance_task(session, user, task, on=payload.date, notes=payload.notes)
    status_list = _maintenance_status(session, resolved_id)
    match = next(t for t in status_list if t["id"] == task.id)
    return MaintenanceTaskOut(**match)


@app.post("/v1/maintenance", response_model=ActionOut)
@limiter.limit("60/minute")
def api_create_maintenance(
    request: Request,
    payload: MaintenanceIn,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    # The accepted action types are the installation's own enabled maintenance
    # tasks (issue #51) rather than a hardcoded list, so custom tasks are
    # writable and disabling a task stops accepting it. Measurement tasks are
    # excluded: those go through /v1/measurements, which carries the values.
    resolved_id = _resolve_installation_for_api_key(
        payload.installation_id, user, session, require_write=True
    )
    allowed = _loggable_action_types(session, resolved_id)
    if payload.action_type not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"action_type must be one of {sorted(allowed)}",
        )
    action = Action(
        date=payload.date or date.today(),
        action_type=payload.action_type,
        user_id=user.id,
        installation_id=resolved_id,
        notes=payload.notes,
        created_at=datetime.now(timezone.utc),
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action
