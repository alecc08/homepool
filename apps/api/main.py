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
from models import Action, ApiKey, Installation, PasswordResetToken, Product, User
from seeds import insert_seeds
from simulator import simulate_dosage, simulate_heating_energy
from water_params import (
    MAINTENANCE_ACTION_TYPES,
    attach_status,
    compute_todo_status,
    encode_measurement_notes,
    extract_current_conditions,
    extract_history,
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


def _ensure_admin_user(session: Session) -> None:
    email = os.getenv("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD")
    if not email or not password:
        return
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        user = existing
    else:
        user = User(email=email, password_hash=_hash_password(password))
        session.add(user)
        session.commit()
        session.refresh(user)
    session.exec(
        text("UPDATE action SET user_id = :user_id WHERE user_id IS NULL").bindparams(
            user_id=user.id
        )
    )
    session.commit()


# ── Lifespan ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        _ensure_user_id_column(session)
        _ensure_first_name_column(session)
        _ensure_volume_columns(session)
        _ensure_measurement_unit_columns(session)
        _ensure_range_overrides_column(session)
        insert_seeds(session)
        _ensure_admin_user(session)
        _migrate_installations(session)
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
    created_at: datetime


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


class InstallationOut(BaseModel):
    id: int
    name: str
    type: str
    sanitizer: str
    volume: Optional[float] = None
    volume_unit: str = "L"
    temp_unit: str = "C"
    salt_unit: str = "ppm"
    conc_unit: str = "mg/L"
    hardness_unit: str = "ppm"
    created_at: datetime


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


class TodoItemOut(BaseModel):
    days_until_due: Optional[int] = None
    last_date: Optional[date] = None


class TodoStatusOut(BaseModel):
    ph_measurement: TodoItemOut
    filter_maintenance: TodoItemOut


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
    date: Optional[date] = None
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
    date: Optional[date] = None
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


def _resolve_installation(
    installation_id: Optional[int],
    user: User,
    session: Session,
) -> Optional[int]:
    """Checks ownership if installation_id is provided, otherwise returns the default installation."""
    if installation_id is not None:
        inst = session.get(Installation, installation_id)
        if not inst or inst.user_id != user.id:
            raise HTTPException(status_code=403, detail="Installation not found")
        return installation_id
    default = _get_default_installation(user.id, session)
    return default.id if default else None


def _get_owned_installation(
    installation_id: int,
    user: User,
    session: Session,
) -> Installation:
    """Fetches an installation and 404s unless it belongs to `user`."""
    installation = session.get(Installation, installation_id)
    if not installation or installation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Installation not found")
    return installation


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
    return {"user": UserOut(id=user.id, email=user.email, first_name=user.first_name, created_at=user.created_at)}


@app.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


def _validate_password_strength(password: str) -> None:
    if len(password) < 8 or not any(c.isupper() for c in password) or not any(c.isdigit() for c in password):
        raise HTTPException(status_code=422, detail="Password must contain at least 8 characters, one uppercase letter, and one digit")


@app.post("/auth/register")
@limiter.limit("3/minute")
def register(payload: RegisterIn, request: Request, session: Session = Depends(get_session)):
    _validate_password_strength(payload.password)
    if session.exec(select(User).where(User.email == payload.email)).first():
        raise HTTPException(status_code=409, detail="Email already in use")
    user = User(
        email=payload.email,
        first_name=payload.first_name.strip(),
        password_hash=_hash_password(payload.password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    # Create a default installation for the new user
    installation = Installation(user_id=user.id)
    session.add(installation)
    session.commit()
    request.session["user_id"] = user.id
    return {"user": UserOut(id=user.id, email=user.email, first_name=user.first_name, created_at=user.created_at)}


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
    return {"user": UserOut(id=user.id, email=user.email, first_name=user.first_name, created_at=user.created_at)}


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
    return {"user": UserOut(id=user.id, email=user.email, first_name=user.first_name, created_at=user.created_at)}


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


# ── Products ───────────────────────────────────────────────────────────────

@app.get("/products")
def list_products(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return session.exec(select(Product)).all()


# ── Installations ──────────────────────────────────────────────────────────

@app.get("/installations", response_model=List[InstallationOut])
def list_installations(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all()


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
    )
    session.add(installation)
    session.commit()
    session.refresh(installation)
    return installation


@app.patch("/installations/{installation_id}", response_model=InstallationOut)
def update_installation(
    installation_id: int,
    payload: InstallationPatchIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = session.get(Installation, installation_id)
    if not installation or installation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Installation not found")
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
    installation = session.get(Installation, installation_id)
    if not installation or installation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Installation not found")
    count = len(session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all())
    if count <= 1:
        raise HTTPException(status_code=400, detail="You must keep at least one installation.")
    # Cascade delete of attached actions
    for action in session.exec(select(Action).where(Action.installation_id == installation_id)).all():
        session.delete(action)
    session.delete(installation)
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
    installation = _get_owned_installation(installation_id, user, session)
    defaults = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    return _merge_range_overrides(defaults, installation.range_overrides)


@app.get("/installations/{installation_id}/params/full")
def get_installation_params_full(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = _get_owned_installation(installation_id, user, session)
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
    installation = _get_owned_installation(installation_id, user, session)
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


# ── Actions ────────────────────────────────────────────────────────────────

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
        installation = session.get(Installation, installation_id)
        if not installation or installation.user_id != user.id:
            raise HTTPException(status_code=403, detail="Installation not found")
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
    resolved_installation_id = _resolve_installation(payload.installation_id, user, session)
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
    action = session.get(Action, action_id)
    if not action or action.user_id != user.id:
        raise HTTPException(status_code=404, detail="Action not found")
    action.date = payload.date
    action.action_type = payload.action_type
    action.product_id = payload.product_id
    action.qty = payload.qty
    action.unit = payload.unit
    action.notes = payload.notes
    if payload.installation_id is not None:
        resolved = _resolve_installation(payload.installation_id, user, session)
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
    action = session.get(Action, action_id)
    if not action or action.user_id != user.id:
        raise HTTPException(status_code=404, detail="Action not found")
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
) -> int:
    resolved = _resolve_installation(installation_id, user, session)
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
    installations = session.exec(
        select(Installation).where(Installation.user_id == user.id)
    ).all()
    return installations


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


@app.get("/v1/todo", response_model=TodoStatusOut)
@limiter.limit("60/minute")
def api_todo_status(
    request: Request,
    installation_id: Optional[int] = None,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(installation_id, user, session)
    cutoff = date.today() - timedelta(days=90)
    actions = session.exec(
        select(Action)
        .where(Action.installation_id == resolved_id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(500)
    ).all()
    return TodoStatusOut(**compute_todo_status(actions))


@app.post("/v1/measurements", response_model=ActionOut)
@limiter.limit("60/minute")
def api_create_measurement(
    request: Request,
    payload: MeasurementIn,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(payload.installation_id, user, session)
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


@app.post("/v1/maintenance", response_model=ActionOut)
@limiter.limit("60/minute")
def api_create_maintenance(
    request: Request,
    payload: MaintenanceIn,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    if payload.action_type not in MAINTENANCE_ACTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"action_type must be one of {sorted(MAINTENANCE_ACTION_TYPES)}",
        )
    resolved_id = _resolve_installation_for_api_key(payload.installation_id, user, session)
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
