import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine, select
from sqlmodel.pool import StaticPool

import database

os.environ.setdefault("SESSION_SECRET", "test-secret")

from main import app, limiter, _hash_password  # noqa: E402
from models import User  # noqa: E402


def _make_client(seed_admin: bool, enforce_foreign_keys: bool = False) -> TestClient:
    limiter.reset()
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    if enforce_foreign_keys:
        # SQLite ignores foreign keys unless asked, so the default test database
        # happily accepts deletes that Postgres — where this actually runs —
        # rejects. Opting in makes those failures reachable from a test.
        @event.listens_for(test_engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    SQLModel.metadata.create_all(test_engine)

    def get_session_override():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[database.get_session] = get_session_override
    if seed_admin:
        with Session(test_engine) as session:
            existing = session.exec(
                select(User).where(User.email == "admin@example.com")
            ).first()
            if not existing:
                user = User(
                    email="admin@example.com",
                    password_hash=_hash_password("admin123"),
                    is_admin=True,
                )
                session.add(user)
                session.commit()
    client = TestClient(app)
    # Handy for the few tests that need to seed rows the API alone can't produce.
    client.test_engine = test_engine
    return client


@pytest.fixture(name="client")
def client_fixture():
    client = _make_client(seed_admin=True)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(name="fk_client")
def fk_client_fixture():
    """A client whose database enforces foreign keys, the way the Postgres
    deployments do. Use it for anything that deletes a row other rows point at —
    the plain `client` would pass regardless and hide the breakage."""
    client = _make_client(seed_admin=True, enforce_foreign_keys=True)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(name="empty_client")
def empty_client_fixture():
    """A client whose database has no accounts at all — for the first-run
    behaviour (first registration claims the administrator role)."""
    client = _make_client(seed_admin=False)
    yield client
    app.dependency_overrides.clear()
