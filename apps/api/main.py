import hashlib
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Request, status
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
from models import Action, ApiKey, Installation, PasswordResetToken, Product, User
from seeds import insert_seeds
from water_params import extract_current_conditions, extract_history

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
    ("pool", "salt"): {
        "ph":     {"ideal": (7.2, 7.6),   "acceptable": (6.8, 7.8)},
        "salt":   {"ideal": (2700, 3400), "acceptable": (2500, 4500)},
        "cya":    {"ideal": (60, 80),     "acceptable": (30, 100)},
        "cl":     {"ideal": (3.0, 5.0),   "acceptable": (2.0, 6.0)},
        "cc":     {"ideal": (0, 0.2),     "acceptable": (0, 0.5)},
        "tac":    {"ideal": (80, 180),    "acceptable": (60, 200)},
        "temp":   {"ideal": (24, 28),     "acceptable": (15, 35)},
        "hardness": {"ideal": (100, 500),   "acceptable": (50, 1000)},
    },
    # Salt spas are far less standardized than salt pools; this band is an
    # approximation pending better field data.
    ("spa", "salt"): {
        "ph":     {"ideal": (7.2, 7.6),   "acceptable": (6.8, 7.8)},
        "salt":   {"ideal": (2500, 3200), "acceptable": (2000, 4000)},
        "cya":    {"ideal": (30, 50),     "acceptable": (0, 80)},
        "cl":     {"ideal": (3.0, 5.0),   "acceptable": (2.0, 6.0)},
        "cc":     {"ideal": (0, 0.2),     "acceptable": (0, 0.5)},
        "tac":    {"ideal": (80, 180),    "acceptable": (60, 200)},
        "temp":   {"ideal": (36, 40),     "acceptable": (30, 42)},
        "hardness": {"ideal": (100, 500),   "acceptable": (50, 1000)},
    },
}


def _apply_range_overrides(target: Optional[Dict[Tuple[str, str], Dict]] = None) -> None:
    """Applies RANGE_<TYPE>_<SANITIZER>_<PARAM>_{IDEAL,ACCEPTABLE}_{MIN,MAX} env var
    overrides onto WATER_PARAMS (or an explicit `target` dict, for tests). Only
    overrides (type, sanitizer, param) combos that already exist in the dict — never
    invents new param keys for a combo that doesn't have them."""
    params = WATER_PARAMS if target is None else target
    applied: List[str] = []
    for (inst_type, sanitizer), params_for_combo in params.items():
        for param, ranges in params_for_combo.items():
            for band in ("ideal", "acceptable"):
                lo, hi = ranges[band]
                prefix = f"RANGE_{inst_type.upper()}_{sanitizer.upper()}_{param.upper()}_{band.upper()}"
                min_env = os.getenv(f"{prefix}_MIN")
                max_env = os.getenv(f"{prefix}_MAX")
                new_lo = float(min_env) if min_env is not None else lo
                new_hi = float(max_env) if max_env is not None else hi
                if min_env is not None or max_env is not None:
                    applied.append(f"{prefix}=({new_lo}, {new_hi})")
                ranges[band] = (new_lo, new_hi)
    if target is None and applied:
        # Routed through uvicorn's own logger (not the root logger, which uvicorn
        # never configures) so this is guaranteed to reach `docker logs` at the
        # default log level, right alongside uvicorn's own startup lines.
        logging.getLogger("uvicorn.error").info(
            "Water param range overrides applied: %s", ", ".join(applied)
        )


_apply_range_overrides()


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
        insert_seeds(session)
        _ensure_admin_user(session)
        _migrate_installations(session)
    yield


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="Pooly API", lifespan=lifespan)
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


class HistoryEntryOut(BaseModel):
    date: date
    ph: Optional[float] = None
    chlorine: Optional[float] = None
    bromine: Optional[float] = None
    tac: Optional[float] = None
    hardness: Optional[float] = None
    salt: Optional[float] = None
    stabilizer: Optional[float] = None
    cc: Optional[float] = None
    temp: Optional[float] = None


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


@app.get("/installations/{installation_id}/params")
def get_installation_params(
    installation_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    installation = session.get(Installation, installation_id)
    if not installation or installation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Installation not found")
    params = WATER_PARAMS.get((installation.type, installation.sanitizer), {})
    return params


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
# Token-authenticated, read-only routes for external consumers. They return
# pre-parsed measurement fields (see water_params.py) rather than raw Action
# rows, so callers don't need to understand the internal notes-encoding scheme.

def _resolve_installation_for_api_key(
    installation_id: Optional[int],
    user: User,
    session: Session,
) -> int:
    resolved = _resolve_installation(installation_id, user, session)
    if resolved is None:
        raise HTTPException(status_code=404, detail="No installation found")
    return resolved


@app.get("/v1/current", response_model=CurrentConditionsOut)
@limiter.limit("60/minute")
def api_current_conditions(
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
    return CurrentConditionsOut(**extract_current_conditions(actions))


@app.get("/v1/history", response_model=List[HistoryEntryOut])
@limiter.limit("60/minute")
def api_history(
    request: Request,
    installation_id: Optional[int] = None,
    from_date: Optional[str] = None,
    limit: Optional[int] = 200,
    user: User = Depends(get_current_user_by_api_key),
    session: Session = Depends(get_session),
):
    resolved_id = _resolve_installation_for_api_key(installation_id, user, session)
    cutoff: date = date.fromisoformat(from_date) if from_date else date.today() - timedelta(days=90)
    actions = session.exec(
        select(Action)
        .where(Action.installation_id == resolved_id, Action.date >= cutoff)
        .order_by(Action.date.desc())
        .limit(limit)
    ).all()
    return [HistoryEntryOut(**entry) for entry in extract_history(actions)]
