from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import db
from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", frontend_dist=tmp_path / "no-dist", anthropic_api_key=None)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def session(client: TestClient) -> Iterator[Session]:
    """A DB session on a migrated database (the client's lifespan ran the migrations)."""
    gen = db.get_session()
    s = next(gen)
    try:
        yield s
    finally:
        s.close()
